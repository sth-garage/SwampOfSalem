/**
 * @fileoverview gatorBabylon.js — First-person 3D alligator-POV view using Babylon.js + WebGPU.
 *
 * ════════════════════════════════════════════════════════════════════════
 * PURPOSE
 * ════════════════════════════════════════════════════════════════════════
 * This module renders the swamp world from the eye-level perspective of a
 * chosen alligator using the Babylon.js WebGPU engine.  It falls back to
 * WebGL2 automatically if WebGPU is unavailable in the user's browser.
 *
 * ════════════════════════════════════════════════════════════════════════
 * DESIGN PRINCIPLES
 * ════════════════════════════════════════════════════════════════════════
 * • Read-only simulation state: this module READS state.gators[] but never
 *   directly mutates it.  All side-effects (bites, conversations, etc.)
 *   are delegated to simulation.js / agentQueue.js exports.
 *
 * • Decoupled 3D scene: the Babylon scene is a visual mirror of the 2D
 *   canvas — positions are converted from 2D pixel-space to 3D world-space
 *   at every render frame by syncGatorMeshes().
 *
 * • POV switching: the player can jump into any living gator's perspective.
 *   `activeGatorIndex` tracks which gator is currently being viewed.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CAMERA CONTROLS (while in POV mode)
 * ════════════════════════════════════════════════════════════════════════
 * • Right-click + drag up/down/left/right → look up/down/left/right
 * • W / Arrow Up   → move forward
 * • S / Arrow Down → move backward
 * • A / Arrow Left → strafe left
 * • D / Arrow Right → strafe right
 * • Spacebar       → jump (short hop, ~2 ft; gravity brings you down immediately)
 * • Escape         → exit POV mode and release pointer lock
 *
 * After MANUAL_RESUME_MS (4 seconds) of no input the camera re-attaches to
 * the active gator's automatic follow position.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CONTEXT MENU (right-click / tap on another gator mesh)
 * ════════════════════════════════════════════════════════════════════════
 * Clicking another gator while in POV opens a small floating menu:
 *   💬 Start Conversation — fires startPovConversation()
 *   🦷 Attack!            — fires applyBiteEffect(povGator, target) directly
 *   🎯 Make Attack…       — two-step picker: choose an attacker, then a victim;
 *                           fires applyBiteEffect(attacker, victim)
 *   👁 Switch POV         — changes activeGatorIndex to the clicked gator
 *
 * ════════════════════════════════════════════════════════════════════════
 * SCENE CONTENTS
 * ════════════════════════════════════════════════════════════════════════
 * • Green plane     : swamp floor (flat, infinite-looking)
 * • BoxBuilder      : house meshes (one per state.houses[])
 * • Cylinder meshes : tree decorations
 * • TransformNode groups: other alligator body parts (body + head cylinders)
 *
 * @module gatorBabylon
 */

import { state } from './state.js';
import { living } from './gator.js';
import { startPovConversation, cancelPovConversation, applyBiteEffect, commandAttack } from './simulation.js';
import { setPovChoiceHandler } from './agentQueue.js';
import { stageBounds } from './helpers.js';

// ── Constants ──────────────────────────────────────────────────────────────
// SCALE converts 2D canvas pixel distances into Babylon world units.
// The 2D canvas is ~1000 px wide; with SCALE=0.1 that maps to ~100 world-units.
const SCALE  = 0.1;
// Camera eye height in Babylon world units (≈ waist-high on the gator mesh).
const CAM_H  = 2.7;
// House mesh dimensions (world units) — must stay in sync with buildHouses().
const HOUSE_W = 12;
const HOUSE_H = 7;
const HOUSE_D = 12;

// ── Module state ───────────────────────────────────────────────────────────
let engine, scene, camera;
// gatorMeshes maps each living gator's numeric ID to a Babylon TransformNode
// that parents their body and head sub-meshes.
let gatorMeshes  = new Map(); // gatorId → BABYLON.TransformNode (parent)
let houseMeshes  = [];        // One Babylon Mesh per entry in state.houses[].
let initialized  = false;     // Whether initBabylonPOV() has run at least once.
let activeGatorIndex = 0;     // Index into living() array for the POV gator.
let _canvas = null;           // The <canvas> element the Babylon engine draws into.

// ── Free-camera constants ──────────────────────────────────────────────────
// The camera has two modes:
//   AUTO-FOLLOW: camera smoothly tracks the active gator's position.
//   MANUAL:      player is directly controlling look / movement.
// It switches to MANUAL on any keypress or mouse drag and returns to
// AUTO-FOLLOW after MANUAL_RESUME_MS of inactivity (or pressing Escape).
const MANUAL_RESUME_MS  = 4000;    // ms of inactivity before auto-follow resumes
const FREE_CAM_SPEED    = 12;      // world units per second for WASD movement
const MOUSE_SENSITIVITY = 0.0020;  // radians of camera rotation per pixel dragged
const JUMP_FORCE        = 6.0;     // initial upward velocity applied at jump — yields ~2 s airtime
const GRAVITY           = 6.0;     // downward acceleration rate (world units/sec²) — 2×JUMP_FORCE/GRAVITY = 2 s

const _keys = new Set();         // Set of KeyboardEvent.code strings currently held down.
let _manualYaw   = 0;            // Current horizontal camera angle (radians).
let _manualPitch = 0;            // Current vertical camera angle (radians; clamped to ±70°).
let _manualActive   = false;    // true while user is in control
let _manualTimer    = 0;        // setTimeout handle
let _mouseDown      = false;
let _wasDragging    = false;  // true if the right-drag moved enough to suppress the next left-click
let _lastMouseX     = 0;
let _lastMouseY     = 0;
let _jumpY          = 0;        // current extra height from a jump
let _jumpVelocity   = 0;        // current vertical velocity (world units/sec)
let _ctxMenu        = null;     // the active POV right-click context menu DOM node
function _dismissCtxMenu() { if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null; } }
// Attack cooldown: one bite per 5 seconds (shared by context menu and HUD buttons)
let _lastBiteMs         = 0;
const BITE_COOLDOWN_MS  = 5000;

// POV pause — when true, the Babylon render loop still runs but gator positions freeze
let _povPaused = false;

function _enterManual() {
    _manualActive = true;
    clearTimeout(_manualTimer);
    // Manual mode is permanent — the camera never auto-reverts to following the sim gator.
    const hint = document.getElementById('pov-control-hint');
    if (hint) hint.style.opacity = '1';
}

function _exitManual() {
    // No-op: manual mode is now permanent once entered.
    // Keeping this function to avoid breaking any call sites.
}

function _onKeyDown(e) {
    if (!initialized) return;
    const k = e.key.toLowerCase();

    // Spacebar jump
    if (k === ' ') {
        e.preventDefault();
        if (_jumpY === 0 && _jumpVelocity === 0) { // only jump when grounded
            if (camera && !_manualActive) {
                // Seed look direction so the camera doesn't snap on first manual frame
                const fwd = camera.getTarget().subtract(camera.position);
                _manualYaw   = Math.atan2(fwd.x, fwd.z);
                _manualPitch = Math.atan2(fwd.y, Math.sqrt(fwd.x * fwd.x + fwd.z * fwd.z));
            }
            _jumpVelocity = JUMP_FORCE;
            _enterManual();
        }
        return;
    }

    const isMove = ['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k);
    if (!isMove) { if (k === 'escape') _exitManual(); return; }
    e.preventDefault();
    _keys.add(k);
    if (!_manualActive) {
        // Seed yaw from current camera look direction so there is no jump
        if (camera) {
            const fwd = camera.getTarget().subtract(camera.position);
            _manualYaw   = Math.atan2(fwd.x, fwd.z);
            _manualPitch = Math.atan2(fwd.y, Math.sqrt(fwd.x*fwd.x + fwd.z*fwd.z));
        }
    }
    _enterManual();
}

function _onKeyUp(e) {
    _keys.delete(e.key.toLowerCase());
}

function _onMouseDown(e) {
    if (!initialized) return;
    if (e.button !== 2) return; // right-drag to look
    const container = _canvas && _canvas.parentElement;
    if (container && !container.contains(e.target)) return;
    _mouseDown = true;
    _wasDragging = false;  // fresh drag — reset suppression flag
    _lastMouseX = e.clientX;
    _lastMouseY = e.clientY;
    // Seed yaw/pitch from live camera direction so there is no snap
    if (camera) {
        const fwd = camera.getTarget().subtract(camera.position);
        _manualYaw   = Math.atan2(fwd.x, fwd.z);
        _manualPitch = Math.atan2(fwd.y, Math.sqrt(fwd.x * fwd.x + fwd.z * fwd.z));
    }
    _enterManual();
    e.preventDefault();
    // Pointer capture keeps move events coming even when cursor leaves the canvas
    try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
}

function _onMouseUp(e) {
    if (e.button !== 2) return;
    _mouseDown = false;
    // Keep _wasDragging true — it will be consumed and cleared by the click handler
    try { e.target.releasePointerCapture(e.pointerId); } catch (_) {}
}

function _onMouseMove(e) {
    if (!initialized || !_mouseDown) return;
    // Use movementX/Y (pointer event deltas) — always correct even with capture
    const dx = e.movementX ?? (e.clientX - _lastMouseX);
    const dy = e.movementY ?? (e.clientY - _lastMouseY);
    _lastMouseX = e.clientX;
    _lastMouseY = e.clientY;
    if (dx === 0 && dy === 0) return;
    // Any movement > 2px suppresses the next click so gators aren't selected during look-drag
    if (Math.abs(dx) + Math.abs(dy) > 2) _wasDragging = true;
    // drag right → look right (+yaw);  drag up (negative dy) → look up (+pitch)
    _manualYaw   += dx * MOUSE_SENSITIVITY;
    _manualPitch -= dy * MOUSE_SENSITIVITY;
    _manualPitch  = Math.max(-1.3, Math.min(1.3, _manualPitch));
    _enterManual();
    // Keep the POV gator mesh facing the camera look direction during right-drag
    _syncPovGatorFacing();
}

function _onPointerLockChange() {
    // No-op: pointer lock is not used for right-drag look
}

/**
 * When the player right-drags to turn the camera, also rotate the POV gator mesh
 * so the avatar faces the same direction the player is looking.
 * Only applies in manual-camera mode; auto-follow uses movement direction instead.
 */
function _syncPovGatorFacing() {
    const alive = living();
    const gator = alive[activeGatorIndex % Math.max(alive.length, 1)] ?? null;
    if (!gator) return;
    const meshData = gatorMeshes.get(gator.id);
    if (!meshData) return;
    // _manualYaw is the camera look angle in radians; reuse directly for the mesh
    meshData.root.rotation.y = _manualYaw;
}

/**
 * Apply keyboard movement and write camera position/target each frame
 * when manual-control mode is active. Called from the render loop.
 */
function _applyManualCamera(dt) {
    if (!camera) return;
    const sp = FREE_CAM_SPEED * dt;
    const cy = Math.cos(_manualYaw),   sy = Math.sin(_manualYaw);
    const cp = Math.cos(_manualPitch), sp2 = Math.sin(_manualPitch);

    // Forward vector (ignoring pitch for XZ movement so WASD feels grounded)
    const fwdX =  sy, fwdZ =  cy;
    // Right vector
    const rtX  =  cy, rtZ  = -sy;

    let moveX = 0, moveZ = 0;
    if (_keys.has('w') || _keys.has('arrowup'))    { moveX += fwdX; moveZ += fwdZ; }
    if (_keys.has('s') || _keys.has('arrowdown'))  { moveX -= fwdX; moveZ -= fwdZ; }
    if (_keys.has('a') || _keys.has('arrowleft'))  { moveX -= rtX;  moveZ -= rtZ;  }
    if (_keys.has('d') || _keys.has('arrowright')) { moveX += rtX;  moveZ += rtZ;  }

    if (moveX || moveZ) {
        camera.position.x += moveX * sp;
        camera.position.z += moveZ * sp;
        _enterManual(); // keep timer alive while moving

        // Write camera position back to the gator's simulation coordinates so
        // the 2D overlay and other gators track the player's position correctly.
        const alive = living();
        const activeGator = alive[activeGatorIndex % Math.max(alive.length, 1)] ?? null;
        if (activeGator) {
            // Convert Babylon world units → sim pixels (SCALE = 0.1)
            const rawSimX = camera.position.x / SCALE;
            const rawSimZ = camera.position.z / SCALE;
            // Clamp to 200-px radius from town centre
            const { W: sW, H: sH } = stageBounds();
            const tcx = sW * 0.5, tcy = sH * 0.5;
            const MAX_RADIUS = 200;
            const ddx = rawSimX - tcx, ddz = rawSimZ - tcy;
            const dist = Math.sqrt(ddx * ddx + ddz * ddz);
            if (dist > MAX_RADIUS) {
                const scale = MAX_RADIUS / dist;
                activeGator.x = tcx + ddx * scale;
                activeGator.y = tcy + ddz * scale;
            } else {
                activeGator.x = rawSimX;
                activeGator.y = rawSimZ;
            }
            activeGator.targetX = activeGator.x;
            activeGator.targetY = activeGator.y;
            camera.position.x = activeGator.x * SCALE;
            camera.position.z = activeGator.y * SCALE;
        }
    }

    // Build look-at target from yaw + pitch
    const lookX = camera.position.x + sy * cp;
    const lookY = camera.position.y + sp2;
    const lookZ = camera.position.z + cy * cp;
    camera.setTarget(new window.BABYLON.Vector3(lookX, lookY, lookZ));
}

function worldX(px) { return px * SCALE; }
function worldZ(py) { return py * SCALE; }

// ── Scene ──────────────────────────────────────────────────────────────────
function buildScene() {
    const BABYLON = window.BABYLON;

    // Reset obstacle registry for this scene
    state.obstacles = [];

    scene = new BABYLON.Scene(engine);
    // Sky colour — hazy grey-green swamp atmosphere
    scene.clearColor = new BABYLON.Color4(0.22, 0.30, 0.18, 1);
    scene.fogMode    = BABYLON.Scene.FOGMODE_LINEAR;
    scene.fogColor   = new BABYLON.Color3(0.22, 0.30, 0.18);
    scene.fogStart   = 55;
    scene.fogEnd     = 160;

    // ── Lighting ───────────────────────────────────────────────────────────
    const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity    = 0.65;
    hemi.diffuse      = new BABYLON.Color3(0.75, 0.85, 0.60);
    hemi.groundColor  = new BABYLON.Color3(0.20, 0.28, 0.12);

    const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -2.5, -0.8), scene);
    sun.intensity = 1.6;
    sun.diffuse   = new BABYLON.Color3(1, 0.92, 0.65);
    sun.specular  = new BABYLON.Color3(0.4, 0.35, 0.20);

    // Subtle fill from the opposite side to add depth
    const fill = new BABYLON.DirectionalLight('fill', new BABYLON.Vector3(1, -1, 1), scene);
    fill.intensity = 0.25;
    fill.diffuse   = new BABYLON.Color3(0.45, 0.62, 0.55);

    // ── Materials ──────────────────────────────────────────────────────────
    // Deep surrounding swamp water — dark, murky, slightly transparent
    const deepWaterMat = new BABYLON.StandardMaterial('deepWaterMat', scene);
    deepWaterMat.diffuseColor  = new BABYLON.Color3(0.06, 0.14, 0.10);
    deepWaterMat.specularColor = new BABYLON.Color3(0.35, 0.55, 0.40);
    deepWaterMat.specularPower = 64;
    deepWaterMat.alpha         = 0.92;

    // Central dry ground — cracked earth / dead grass base
    const dryMat = new BABYLON.StandardMaterial('dryMat', scene);
    dryMat.diffuseColor  = new BABYLON.Color3(0.41, 0.38, 0.21);
    dryMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.03);

    // Dry-grass patches (lighter, straw coloured)
    const grassMat = new BABYLON.StandardMaterial('grassMat', scene);
    grassMat.diffuseColor  = new BABYLON.Color3(0.52, 0.48, 0.22);

    // Dark mud strips / wet soil near water edge
    const mudMat = new BABYLON.StandardMaterial('mudMat', scene);
    mudMat.diffuseColor  = new BABYLON.Color3(0.24, 0.20, 0.12);
    mudMat.specularColor = new BABYLON.Color3(0.15, 0.12, 0.07);
    mudMat.specularPower = 20;

    // Boggy green-brown near the water's edge
    const bogMat = new BABYLON.StandardMaterial('bogMat', scene);
    bogMat.diffuseColor  = new BABYLON.Color3(0.18, 0.26, 0.14);
    bogMat.specularColor = new BABYLON.Color3(0.08, 0.12, 0.06);

    // Shallow inner water puddles
    const puddleMat = new BABYLON.StandardMaterial('puddleMat', scene);
    puddleMat.diffuseColor  = new BABYLON.Color3(0.09, 0.20, 0.16);
    puddleMat.specularColor = new BABYLON.Color3(0.30, 0.48, 0.35);
    puddleMat.specularPower = 48;
    puddleMat.alpha         = 0.80;

    // ── World coordinate helpers ───────────────────────────────────────────
    // The simulation runs 0–1200 × 0–800 px; SCALE = 0.1 so world = 0–120 × 0–80
    // Island centre ≈ (60, 40); moat ring starts ≈ 8 units from edge

    // ── Deep surrounding swamp (very wide plane beneath everything) ────────
    const swampBase = BABYLON.MeshBuilder.CreateGround('swampBase',
        { width: 600, height: 600, subdivisions: 2 }, scene);
    swampBase.position = new BABYLON.Vector3(60, -0.12, 40);
    swampBase.material = deepWaterMat;

    // ── Island dry ground (central area 0–120 × 0–80) ─────────────────────
    const island = BABYLON.MeshBuilder.CreateGround('island',
        { width: 120, height: 80, subdivisions: 20 }, scene);
    island.position = new BABYLON.Vector3(60, 0, 40);
    island.material = dryMat;

    // ── Ground variation patches (dry-grass, mud, bog) ────────────────────
    // Dry-grass patches scattered around the centre
    const grassPatchDefs = [
        [40, 35, 22, 14], [72, 42, 18, 12], [55, 25, 20, 10],
        [90, 55, 16,  9], [28, 50, 14, 11], [65, 60, 18, 10],
        [48, 14, 12,  8], [82, 20, 14, 10],
    ];
    grassPatchDefs.forEach(([x, z, w, d], i) => {
        const p = BABYLON.MeshBuilder.CreateGround(`grass${i}`, { width: w, height: d }, scene);
        p.position = new BABYLON.Vector3(x, 0.005, z);
        p.material = grassMat;
    });

    // Mud strips — near the water edge, around the perimeter of the island
    const mudDefs = [
        // North edge
        [15, 4, 26, 6], [55, 3, 30, 5], [95, 4, 22, 6],
        // South edge
        [20, 76, 22, 6], [55, 77, 28, 5], [95, 76, 20, 5],
        // West edge
        [3, 20, 6, 22], [3, 50, 6, 20],
        // East edge
        [117, 25, 6, 22], [117, 52, 6, 20],
        // Interior mud channels (water seeps in)
        [35, 42, 10, 5], [78, 35, 10, 4], [55, 55, 8, 6],
    ];
    mudDefs.forEach(([x, z, w, d], i) => {
        const p = BABYLON.MeshBuilder.CreateGround(`mud${i}`, { width: w, height: d }, scene);
        p.position = new BABYLON.Vector3(x, 0.006, z);
        p.material = mudMat;
    });

    // Bog transition ring just inside the island edge
    const bogDefs = [
        [20, 8, 30, 8], [65, 7, 36, 8], [105, 10, 20, 10],
        [12, 40, 8, 30], [8, 65, 20, 12],
        [50, 72, 34, 8], [88, 73, 24, 8],
        [112, 45, 10, 22], [108, 22, 14, 10],
    ];
    bogDefs.forEach(([x, z, w, d], i) => {
        const p = BABYLON.MeshBuilder.CreateGround(`bog${i}`, { width: w, height: d }, scene);
        p.position = new BABYLON.Vector3(x, 0.007, z);
        p.material = bogMat;
    });

    // Small water puddles on the island (surface water / flooding)
    const puddleDefs = [
        [30, 18, 8, 5], [85, 12, 7, 4], [15, 55, 6, 6],
        [95, 62, 9, 5], [52, 68, 7, 4], [70, 42, 6, 4],
        [38, 60, 7, 5], [105, 38, 5, 6],
    ];
    puddleDefs.forEach(([x, z, w, d], i) => {
        const p = BABYLON.MeshBuilder.CreateGround(`puddle${i}`, { width: w, height: d }, scene);
        p.position = new BABYLON.Vector3(x, 0.02, z);
        p.material = puddleMat;
    });

    // ── Surrounding moat — deep water ring beyond the island edge ──────────
    // North moat
    const northMoat = BABYLON.MeshBuilder.CreateGround('moatN', { width: 200, height: 60 }, scene);
    northMoat.position = new BABYLON.Vector3(60, -0.05, -22);
    northMoat.material = deepWaterMat;

    // South moat
    const southMoat = BABYLON.MeshBuilder.CreateGround('moatS', { width: 200, height: 60 }, scene);
    southMoat.position = new BABYLON.Vector3(60, -0.05, 102);
    southMoat.material = deepWaterMat;

    // West moat
    const westMoat = BABYLON.MeshBuilder.CreateGround('moatW', { width: 60, height: 200 }, scene);
    westMoat.position = new BABYLON.Vector3(-22, -0.05, 40);
    westMoat.material = deepWaterMat;

    // East moat
    const eastMoat = BABYLON.MeshBuilder.CreateGround('moatE', { width: 60, height: 200 }, scene);
    eastMoat.position = new BABYLON.Vector3(142, -0.05, 40);
    eastMoat.material = deepWaterMat;

    // ── Lily pads on the moat ─────────────────────────────────────────────
    const lilyMat = new BABYLON.StandardMaterial('lilyMat', scene);
    lilyMat.diffuseColor = new BABYLON.Color3(0.22, 0.52, 0.20);
    const lilyPositions = [
        // North moat
        [-10, -8], [5, -5], [20, -10], [38, -6], [60, -9], [78, -5], [95, -8], [110, -6], [125, -10], [140, -7],
        // South moat
        [-5, 88], [12, 84], [35, 87], [55, 90], [75, 85], [95, 88], [118, 84], [135, 87],
        // West moat
        [-8, 8], [-12, 22], [-7, 36], [-10, 52], [-6, 68],
        // East moat
        [130, 12], [128, 28], [132, 44], [130, 60], [128, 74],
    ];
    lilyPositions.forEach(([x, z], i) => {
        const pad = BABYLON.MeshBuilder.CreateDisc(`lily${i}`, { radius: 0.9 + Math.random() * 0.7, tessellation: 10 }, scene);
        pad.rotation.x = Math.PI / 2;
        pad.position   = new BABYLON.Vector3(x, 0.03, z);
        pad.material   = lilyMat;
    });

    buildReeds();
    buildRocks();
}

// buildSwampBoundary removed — no walls of any form.

// ── Reed clusters along water edges ─────────────────────────────────────────
function buildReeds() {
    const BABYLON = window.BABYLON;
    const reedMat = new BABYLON.StandardMaterial('reedMat', scene);
    reedMat.diffuseColor = new BABYLON.Color3(0.42, 0.38, 0.15);

    const headMat = new BABYLON.StandardMaterial('reedHeadMat', scene);
    headMat.diffuseColor = new BABYLON.Color3(0.25, 0.16, 0.05);

    // Clusters: [cx, cz, count]
    const clusters = [
        [-4, 10, 8], [-4, 30, 7], [-4, 55, 9], [-4, 70, 6],
        [124, 15, 8], [124, 38, 7], [124, 60, 8], [124, 72, 5],
        [15, -4, 9], [40, -4, 8], [70, -4, 10], [95, -4, 7], [115, -4, 8],
        [10, 84, 8], [38, 84, 7], [65, 84, 9], [90, 84, 8], [112, 84, 6],
        // Mid-island reeds near puddles
        [32, 20, 4], [84, 14, 4], [18, 52, 5], [96, 60, 4],
    ];

    clusters.forEach(([cx, cz, count]) => {
        for (let i = 0; i < count; i++) {
            const rx = cx + (Math.random() - 0.5) * 5;
            const rz = cz + (Math.random() - 0.5) * 5;
            const h  = 1.8 + Math.random() * 1.4;
            const reed = BABYLON.MeshBuilder.CreateCylinder(`r_${cx}_${cz}_${i}`,
                { diameterTop: 0.06, diameterBottom: 0.12, height: h, tessellation: 5 }, scene);
            reed.position = new BABYLON.Vector3(rx, h / 2, rz);
            reed.rotation.z = (Math.random() - 0.5) * 0.18;
            reed.material   = reedMat;

            // Bulrush head
            const head = BABYLON.MeshBuilder.CreateCylinder(`rh_${cx}_${cz}_${i}`,
                { diameterTop: 0.14, diameterBottom: 0.18, height: 0.38, tessellation: 8 }, scene);
            head.position = new BABYLON.Vector3(rx, h - 0.10, rz);
            head.material  = headMat;
        }
    });
}

// ── Mossy rocks scattered around the island ──────────────────────────────────
function buildRocks() {
    const BABYLON = window.BABYLON;
    const rockMat = new BABYLON.StandardMaterial('rockMat', scene);
    rockMat.diffuseColor  = new BABYLON.Color3(0.34, 0.32, 0.26);
    rockMat.specularColor = new BABYLON.Color3(0.08, 0.08, 0.06);

    const mossMat = new BABYLON.StandardMaterial('mossMat', scene);
    mossMat.diffuseColor = new BABYLON.Color3(0.22, 0.36, 0.16);

    const rockDefs = [
        [8, 12], [15, 70], [110, 8], [108, 70], [3, 40],
        [118, 42], [35, 5], [82, 75], [55, 38], [72, 18],
        [25, 62], [95, 30], [42, 72], [68, 8],
    ];
    rockDefs.forEach(([x, z], i) => {
        const s  = 0.6 + Math.random() * 1.0;
        const rock = BABYLON.MeshBuilder.CreateBox(`rock${i}`, { width: s * 1.4, height: s * 0.8, depth: s * 1.2 }, scene);
        rock.position = new BABYLON.Vector3(x, s * 0.3, z);
        rock.rotation = new BABYLON.Vector3(
            (Math.random() - 0.5) * 0.3,
            Math.random() * Math.PI,
            (Math.random() - 0.5) * 0.2
        );
        rock.material = rockMat;

        // Small moss cap on top
        const moss = BABYLON.MeshBuilder.CreateBox(`moss${i}`, { width: s * 1.0, height: s * 0.15, depth: s * 0.9 }, scene);
        moss.position = new BABYLON.Vector3(x, s * 0.65, z);
        moss.rotation.y = rock.rotation.y;
        moss.material   = mossMat;

        // Register as obstacle in sim-px (world * 10)
        state.obstacles.push({ x: x * 10, y: z * 10, r: (s * 0.9 + 0.4) * 10, type: 'rock' });
    });
}

// buildTrees removed — trees eliminated per design.
export const ISLAND_TREE_POSITIONS = []; // kept for import compatibility

function buildHouses() {
    const BABYLON = window.BABYLON;
    houseMeshes.forEach(m => m.dispose());
    houseMeshes = [];

    const hueTable = [
        new BABYLON.Color3(0.55, 0.37, 0.24),
        new BABYLON.Color3(0.48, 0.32, 0.19),
        new BABYLON.Color3(0.42, 0.28, 0.16),
        new BABYLON.Color3(0.61, 0.42, 0.25),
        new BABYLON.Color3(0.49, 0.33, 0.21),
        new BABYLON.Color3(0.54, 0.38, 0.25),
    ];

    state.houses.forEach((h, i) => {
        const wallMat = new BABYLON.StandardMaterial(`wallMat${i}`, scene);
        wallMat.diffuseColor = hueTable[i % hueTable.length];
        const roofMat = new BABYLON.StandardMaterial(`roofMat${i}`, scene);
        roofMat.diffuseColor = new BABYLON.Color3(0.23, 0.13, 0.06);

        const cx = worldX(h.x);
        const cz = worldZ(h.y);

        const walls = BABYLON.MeshBuilder.CreateBox(`walls${i}`, { width: HOUSE_W, height: HOUSE_H, depth: HOUSE_D }, scene);
        walls.position = new BABYLON.Vector3(cx, HOUSE_H / 2, cz);
        walls.material = wallMat;
        houseMeshes.push(walls);

        const roof = BABYLON.MeshBuilder.CreateCylinder(`roof${i}`, { diameterTop: 0, diameterBottom: HOUSE_W * 1.5, height: HOUSE_H * 0.6, tessellation: 4 }, scene);
        roof.position = new BABYLON.Vector3(cx, HOUSE_H + HOUSE_H * 0.3, cz);
        roof.rotation.y = Math.PI / 4;
        roof.material = roofMat;
        houseMeshes.push(roof);

        // Door marker
        const doorMat = new BABYLON.StandardMaterial(`doorMat${i}`, scene);
        doorMat.diffuseColor = new BABYLON.Color3(0.80, 0.67, 0.33);
        const door = BABYLON.MeshBuilder.CreateBox(`door${i}`, { width: 1.5, height: 3.0, depth: 0.25 }, scene);
        door.position = new BABYLON.Vector3(worldX(h.doorX), 1.5, worldZ(h.doorY));
        door.material = doorMat;
        houseMeshes.push(door);

        // Register house as circular obstacle in sim-px
        state.obstacles.push({ x: cx * 10, y: cz * 10, r: (Math.hypot(HOUSE_W, HOUSE_D) / 2 + 0.5) * 10, type: 'house' });
    });
}

// ── Gator meshes (upright, bipedal — walks like a human) ─────────────────
function getOrCreateGatorMesh(gator) {
    if (gatorMeshes.has(gator.id)) return gatorMeshes.get(gator.id);

    const BABYLON = window.BABYLON;
    const isDead  = state.deadIds.has(gator.id);

    // Skin
    const skin = isDead ? new BABYLON.Color3(0.33, 0.33, 0.33)
                        : new BABYLON.Color3(0.29, 0.48, 0.19);
    const bodyMat = new BABYLON.StandardMaterial(`bmat${gator.id}`, scene);
    bodyMat.diffuseColor = skin;
    if (isDead) bodyMat.alpha = 0.4;

    const bellyMat = new BABYLON.StandardMaterial(`belmat${gator.id}`, scene);
    bellyMat.diffuseColor = new BABYLON.Color3(0.74, 0.78, 0.50);

    const snoutMat = new BABYLON.StandardMaterial(`smat${gator.id}`, scene);
    snoutMat.diffuseColor = new BABYLON.Color3(0.24, 0.38, 0.15);

    const eyeMat = new BABYLON.StandardMaterial(`emat${gator.id}`, scene);
    eyeMat.diffuseColor  = new BABYLON.Color3(1, 1, 1);
    eyeMat.emissiveColor = new BABYLON.Color3(0.6, 0.6, 0.0);

    const toothMat = new BABYLON.StandardMaterial(`tmat${gator.id}`, scene);
    toothMat.diffuseColor = new BABYLON.Color3(1, 1, 0.92);

    // Per-gator label / shirt accent colour
    const palette = [
        new BABYLON.Color3(1,0.40,0.27), new BABYLON.Color3(0.27,0.67,1),
        new BABYLON.Color3(1,0.80,0.13), new BABYLON.Color3(0.67,0.40,1),
        new BABYLON.Color3(0.27,1,0.67), new BABYLON.Color3(1,0.27,0.67),
        new BABYLON.Color3(0.53,1,0.80), new BABYLON.Color3(1,0.67,0.27),
        new BABYLON.Color3(0.40,0.73,1),
    ];
    const accent = palette[gator.id % palette.length];
    const shirtMat = new BABYLON.StandardMaterial(`shirt${gator.id}`, scene);
    shirtMat.diffuseColor  = accent;
    shirtMat.emissiveColor = accent.scale(0.25);

    const pantsMat = new BABYLON.StandardMaterial(`pants${gator.id}`, scene);
    pantsMat.diffuseColor = new BABYLON.Color3(0.18, 0.22, 0.42);

    const shoeMat = new BABYLON.StandardMaterial(`shoe${gator.id}`, scene);
    shoeMat.diffuseColor = new BABYLON.Color3(0.10, 0.06, 0.04);

    // Root — feet on the ground; whole body sits ~3 units tall
    const root = new BABYLON.TransformNode(`gator${gator.id}`, scene);

    // Torso (shirt)
    const torso = BABYLON.MeshBuilder.CreateBox(`torso${gator.id}`,
        { width: 1.0, height: 1.2, depth: 0.55 }, scene);
    torso.position.y = 1.7;
    torso.material = shirtMat;
    torso.parent = root;

    // Belly accent strip on torso front
    const belly = BABYLON.MeshBuilder.CreateBox(`belly${gator.id}`,
        { width: 0.55, height: 0.9, depth: 0.05 }, scene);
    belly.position = new BABYLON.Vector3(0, 1.65, 0.30);
    belly.material = bellyMat;
    belly.parent = root;

    // Hips (pants top)
    const hips = BABYLON.MeshBuilder.CreateBox(`hips${gator.id}`,
        { width: 1.0, height: 0.35, depth: 0.55 }, scene);
    hips.position.y = 1.0;
    hips.material = pantsMat;
    hips.parent = root;

    // Legs — pivot at hip so we can swing them
    function makeLeg(side) {
        const pivot = new BABYLON.TransformNode(`legPivot${gator.id}_${side}`, scene);
        pivot.position = new BABYLON.Vector3(side * 0.28, 0.85, 0);
        pivot.parent = root;

        const upper = BABYLON.MeshBuilder.CreateBox(`upperLeg${gator.id}_${side}`,
            { width: 0.34, height: 0.85, depth: 0.36 }, scene);
        upper.position.y = -0.425;
        upper.material = pantsMat;
        upper.parent = pivot;

        const shoe = BABYLON.MeshBuilder.CreateBox(`shoe${gator.id}_${side}`,
            { width: 0.40, height: 0.18, depth: 0.62 }, scene);
        shoe.position = new BABYLON.Vector3(0, -0.94, 0.10);
        shoe.material = shoeMat;
        shoe.parent = pivot;
        return pivot;
    }
    const legL = makeLeg(-1);
    const legR = makeLeg(+1);

    // Arms — pivot at shoulder
    function makeArm(side) {
        const pivot = new BABYLON.TransformNode(`armPivot${gator.id}_${side}`, scene);
        pivot.position = new BABYLON.Vector3(side * 0.62, 2.18, 0);
        pivot.parent = root;

        const upper = BABYLON.MeshBuilder.CreateBox(`upperArm${gator.id}_${side}`,
            { width: 0.26, height: 0.95, depth: 0.28 }, scene);
        upper.position.y = -0.475;
        upper.material = bodyMat;
        upper.parent = pivot;

        const hand = BABYLON.MeshBuilder.CreateSphere(`hand${gator.id}_${side}`,
            { diameter: 0.30, segments: 6 }, scene);
        hand.position.y = -1.05;
        hand.material = bodyMat;
        hand.parent = pivot;
        return pivot;
    }
    const armL = makeArm(-1);
    const armR = makeArm(+1);

    // Head — alligator head sits on top of torso, snout points forward (-Z)
    const headPivot = new BABYLON.TransformNode(`headPivot${gator.id}`, scene);
    headPivot.position = new BABYLON.Vector3(0, 2.45, 0);
    headPivot.parent = root;

    const skull = BABYLON.MeshBuilder.CreateBox(`skull${gator.id}`,
        { width: 0.85, height: 0.55, depth: 0.85 }, scene);
    skull.material = bodyMat;
    skull.parent = headPivot;

    const snout = BABYLON.MeshBuilder.CreateBox(`snout${gator.id}`,
        { width: 0.7, height: 0.32, depth: 0.95 }, scene);
    snout.position = new BABYLON.Vector3(0, -0.08, 0.85);
    snout.material = snoutMat;
    snout.parent = headPivot;

    // Teeth row (top + bottom)
    const teethTop = BABYLON.MeshBuilder.CreateBox(`teethT${gator.id}`,
        { width: 0.6, height: 0.05, depth: 0.85 }, scene);
    teethTop.position = new BABYLON.Vector3(0, -0.20, 0.85);
    teethTop.material = toothMat;
    teethTop.parent = headPivot;

    [-0.22, 0.22].forEach((ex, ei) => {
        const eye = BABYLON.MeshBuilder.CreateSphere(`eye${gator.id}_${ei}`,
            { diameter: 0.20, segments: 8 }, scene);
        eye.position = new BABYLON.Vector3(ex, 0.32, 0.10);
        eye.material = eyeMat;
        eye.parent = headPivot;

        // Pupil
        const pupil = BABYLON.MeshBuilder.CreateSphere(`pupil${gator.id}_${ei}`,
            { diameter: 0.09, segments: 6 }, scene);
        pupil.position = new BABYLON.Vector3(ex, 0.30, 0.18);
        const pmat = new BABYLON.StandardMaterial(`pmat${gator.id}_${ei}`, scene);
        pmat.diffuseColor = new BABYLON.Color3(0, 0, 0);
        pupil.material = pmat;
        pupil.parent = headPivot;
    });

    // Tail — stub at the back of the hips (opposite the snout / -Z direction)
    const tail = BABYLON.MeshBuilder.CreateBox(`tail${gator.id}`,
        { width: 0.40, height: 0.30, depth: 0.85 }, scene);
    tail.position = new BABYLON.Vector3(0, 1.0, -0.55);
    tail.rotation.x = 0.35;
    tail.material = bodyMat;
    tail.parent = root;

    // Floating name label (above head) — billboard plane with drawn text
    const labelW = 2.2, labelH = 0.55;
    const label = BABYLON.MeshBuilder.CreatePlane(`label${gator.id}`,
        { width: labelW, height: labelH }, scene);
    label.position = new BABYLON.Vector3(0, 3.55, 0);
    label.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    label.renderingGroupId = 1;   // draw on top of most geometry

    const texW = 256, texH = 64;
    const nameTex = new BABYLON.DynamicTexture(`ntex${gator.id}`, { width: texW, height: texH }, scene, false);
    nameTex.hasAlpha = true;
    const ctx = nameTex.getContext();

    // Background pill — semi-transparent dark
    ctx.clearRect(0, 0, texW, texH);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const r = 14;
    ctx.beginPath();
    ctx.moveTo(r, 0); ctx.lineTo(texW - r, 0);
    ctx.arcTo(texW, 0, texW, r, r);
    ctx.lineTo(texW, texH - r);
    ctx.arcTo(texW, texH, texW - r, texH, r);
    ctx.lineTo(r, texH);
    ctx.arcTo(0, texH, 0, texH - r, r);
    ctx.lineTo(0, r);
    ctx.arcTo(0, 0, r, 0, r);
    ctx.closePath();
    ctx.fill();

    // Name text
    const accentHex = `rgb(${Math.round(accent.r*255)},${Math.round(accent.g*255)},${Math.round(accent.b*255)})`;
    ctx.fillStyle = accentHex;
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(gator.name, texW / 2, texH / 2);
    nameTex.update();

    const labelMat = new BABYLON.StandardMaterial(`lmat${gator.id}`, scene);
    labelMat.diffuseTexture  = nameTex;
    labelMat.emissiveTexture = nameTex;
    labelMat.emissiveColor   = new BABYLON.Color3(1, 1, 1);
    labelMat.disableLighting = true;
    labelMat.useAlphaFromDiffuseTexture = true;
    labelMat.backFaceCulling = false;
    label.material = labelMat;
    label.parent = root;

    const meshData = { root, headPivot, legL, legR, armL, armR, walkPhase: Math.random() * Math.PI * 2, bodyMat };
    gatorMeshes.set(gator.id, meshData);
    return meshData;
}

function syncGatorMeshes(deltaSec) {
    const seen = new Set();
    state.gators.forEach(g => {
        const data = getOrCreateGatorMesh(g);
        const { root, legL, legR, armL, armR } = data;
        seen.add(g.id);

        const gx = worldX(g.x);
        const gz = worldZ(g.y);
        root.position.x = gx;
        root.position.z = gz;
        const dead = state.deadIds.has(g.id);
        root.position.y = dead ? -0.3 : 0;

        const dx = (g.targetX ?? g.x) - g.x;
        const dy = (g.targetY ?? g.y) - g.y;
        const moveDist = Math.sqrt(dx * dx + dy * dy);

        // If talking to someone, face them; otherwise face direction of motion
        if (g.talkingTo != null) {
            const partner = state.gators.find(q => q.id === g.talkingTo);
            if (partner) {
                const fx = partner.x - g.x;
                const fy = partner.y - g.y;
                root.rotation.y = Math.atan2(fx, fy);
            }
        } else if (moveDist > 4) {
            root.rotation.y = Math.atan2(dx, dy);
        }

        // Walk cycle: legs swing opposite, arms swing opposite to legs, torso bobs
        if (!dead) {
            const moving = moveDist > 4;
            const speed = moving ? 8.0 : 0;
            data.walkPhase += deltaSec * speed;
            const swing = moving ? Math.sin(data.walkPhase) * 0.9 : 0;
            legL.rotation.x =  swing;
            legR.rotation.x = -swing;
            armL.rotation.x = -swing * 0.85;
            armR.rotation.x =  swing * 0.85;
            const bob = moving ? Math.abs(Math.sin(data.walkPhase)) * 0.08 : 0;
            root.position.y = bob;
        } else {
            legL.rotation.x = legR.rotation.x = 0;
            armL.rotation.x = armR.rotation.x = 0;
        }
    });

    gatorMeshes.forEach((data, id) => {
        if (!seen.has(id)) {
            data.root.dispose();
            gatorMeshes.delete(id);
        }
    });
}

// ── Camera ─────────────────────────────────────────────────────────────────
// POV_FACE_DIST: how many world units in front of the partner the camera sits
// during a conversation (≈2 world units = ~20 sim-px, which feels like a few feet).
const POV_FACE_DIST = 2.2;

function updateCamera() {
    const alive = living();
    if (!alive.length) return;
    if (activeGatorIndex >= alive.length) activeGatorIndex = 0;
    const gator = alive[activeGatorIndex];

    const label = document.getElementById('babylon-pov-gator-label');
    if (label) label.textContent = `🐊 ${gator.name ?? 'Gator'}`;

    const gx = worldX(gator.x);
    const gz = worldZ(gator.y);

    // If the POV gator is in conversation, position camera face-to-face with the partner
    const partner = gator.talkingTo != null
        ? state.gators.find(q => q.id === gator.talkingTo) ?? null
        : null;

    if (partner) {
        const px = worldX(partner.x);
        const pz = worldZ(partner.y);

        // Direction from partner toward POV gator (i.e. stand on gator's side, look at partner)
        const dx = gx - px;
        const dz = gz - pz;
        const d  = Math.sqrt(dx * dx + dz * dz) || 1;
        const nx = dx / d;
        const nz = dz / d;

        // Place camera POV_FACE_DIST world units in front of the partner
        camera.position.x = px + nx * POV_FACE_DIST;
        camera.position.y = CAM_H;
        camera.position.z = pz + nz * POV_FACE_DIST;

        // Look directly at the partner's eye level
        camera.setTarget(new window.BABYLON.Vector3(px, CAM_H * 0.9, pz));
    } else {
        camera.position.x = gx;
        camera.position.y = CAM_H;
        camera.position.z = gz;

        const dx = (gator.targetX ?? gator.x) - gator.x;
        const dy = (gator.targetY ?? gator.y) - gator.y;
        const moveDist = Math.sqrt(dx * dx + dy * dy);
        let lookX, lookZ;
        if (moveDist > 4) {
            lookX = gx + worldX(dx) * 20;
            lookZ = gz + worldZ(dy) * 20;
        } else {
            lookX = worldX(gator.x + (600 - gator.x) * 0.3);
            lookZ = worldZ(gator.y + (400 - gator.y) * 0.3);
        }
        camera.setTarget(new window.BABYLON.Vector3(lookX, CAM_H * 0.85, lookZ));
    }

    // Hide active gator's own mesh (only disable living gators — dead ones already sit below ground)
    const aliveIds = new Set(living().map(g => g.id));
    gatorMeshes.forEach((data, id) => {
        // Always show dead gators (their meshes sit below ground so they are harmless)
        // Only hide the mesh for the gator whose POV is currently active
        const isDead = !aliveIds.has(id);
        data.root.setEnabled(isDead || id !== gator.id);
    });
}

// ── POV chat bubbles ────────────────────────────────────────────────────────
// Maps gatorId → <div class="pov-bubble"> that is currently in the DOM
const _povBubbleDivs = new Map();

function _projectHead(gatorId) {
    const BABYLON = window.BABYLON;
    const data = gatorMeshes.get(gatorId);
    if (!data || !data.root || !scene || !engine || !camera) return null;
    // Head top is at root.y + ~3.0 (root sits at 0)
    const worldPos = data.root.position.clone();
    worldPos.y += 3.2;
    try {
        const vp = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
        const screen = BABYLON.Vector3.Project(
            worldPos,
            BABYLON.Matrix.Identity(),
            scene.getTransformMatrix(),
            vp
        );
        const dpr = window.devicePixelRatio || 1;
        const cx = screen.x / dpr;
        const cy = screen.y / dpr;
        // Discard if behind camera or off-screen
        if (screen.z < 0 || screen.z > 1) return null;
        if (cx < -60 || cy < -60) return null;
        return { x: cx, y: cy };
    } catch (_) { return null; }
}

function updatePovBubbles(activeGator) {
    const bubbleLayer = document.getElementById('pov-bubble-layer');
    const selfSpeech  = document.getElementById('pov-self-speech');
    const selfName    = document.getElementById('pov-self-name');
    const selfText    = document.getElementById('pov-self-text');
    if (!bubbleLayer || !selfSpeech) return;

    const seenIds = new Set();

    state.gators.forEach(g => {
        if (!g || state.deadIds.has(g.id)) return;
        const hasContent = g.message || g.isWaiting;
        if (!hasContent) return;

        const isSelf = activeGator && g.id === activeGator.id;

        if (isSelf) {
            // ── Self speech bar ───────────────────────────────────────────
            selfSpeech.style.display = 'block';
            selfName.textContent = g.name;
            if (g.isWaiting && !g.message) {
                selfText.innerHTML = '<em>thinking…</em>';
            } else if (g.message) {
                selfText.textContent = g.message;
            }
            return;
        }

        // ── Other gator floating bubble ───────────────────────────────────
        const sp = _projectHead(g.id);
        if (!sp) return; // behind camera / not spawned yet

        seenIds.add(g.id);
        let div = _povBubbleDivs.get(g.id);
        if (!div) {
            div = document.createElement('div');
            div.className = 'pov-bubble';
            div.innerHTML = `<span class="pov-bubble-name"></span><span class="pov-bubble-text"></span>`;
            bubbleLayer.appendChild(div);
            _povBubbleDivs.set(g.id, div);
        }

        div.querySelector('.pov-bubble-name').textContent = g.name;
        const textEl = div.querySelector('.pov-bubble-text');
        if (g.isWaiting && !g.message) {
            textEl.innerHTML = '<em class="pov-bubble-waiting">…</em>';
        } else if (g.message) {
            textEl.textContent = g.message;
        }

        // Position: leave 12px margin above head
        div.style.left = `${sp.x}px`;
        div.style.top  = `${sp.y - 14}px`;
    });

    // Remove bubbles for gators who no longer have anything to say
    _povBubbleDivs.forEach((div, id) => {
        if (!seenIds.has(id)) {
            div.remove();
            _povBubbleDivs.delete(id);
        }
    });

    // Hide self-speech bar if POV gator is not talking
    if (activeGator) {
        const g = activeGator;
        if (!g.message && !g.isWaiting) selfSpeech.style.display = 'none';
    } else {
        selfSpeech.style.display = 'none';
    }
}

// ── Public API ─────────────────────────────────────────────────────────────
export async function initBabylon(container) {
    if (initialized) return;
    initialized = true;
    activeGatorIndex = 0;

    const BABYLON = window.BABYLON;

    // Create canvas
    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'width:100%;height:100%;display:block;';
    container.insertBefore(_canvas, container.firstChild);

    // Prefer WebGPU, fall back to WebGL
    let useWebGPU = false;
    if (BABYLON.WebGPUEngine && await BABYLON.WebGPUEngine.IsSupportedAsync) {
        useWebGPU = true;
    }

    if (useWebGPU) {
        engine = new BABYLON.WebGPUEngine(_canvas, { antialias: true });
        await engine.initAsync();
    } else {
        engine = new BABYLON.Engine(_canvas, true);
    }

    buildScene();

    camera = new BABYLON.FreeCamera('cam', new BABYLON.Vector3(60, CAM_H, 40), scene);
    camera.minZ = 0.1;
    camera.maxZ = 300;

    window.addEventListener('resize',  onResize);
    window.addEventListener('keydown',  _onKeyDown);
    window.addEventListener('keyup',    _onKeyUp);
    // Right-drag look: use pointer events on the canvas so setPointerCapture works
    _canvas.addEventListener('pointerdown', _onMouseDown);
    _canvas.addEventListener('pointerup',   _onMouseUp);
    _canvas.addEventListener('pointermove', _onMouseMove);
    _canvas.addEventListener('pointercancel', e => { _mouseDown = false; });

    // Single-click on the canvas: show context menu for the nearest alligator
    _canvas.addEventListener('click', e => {
        if (!initialized) return;
        // Ignore if a right-drag look-around just finished (suppresses accidental selection)
        if (_wasDragging) { _wasDragging = false; return; }
        if (_mouseDown) return;
        const alive = living();
        if (alive.length < 2) return;
        const curId = alive[activeGatorIndex % alive.length]?.id;
        const rect  = _canvas.getBoundingClientRect();
        const hit   = _pickGatorAtScreen(e.clientX - rect.left, e.clientY - rect.top, 80, curId);
        if (hit) _showCtxMenu(e.clientX, e.clientY, hit.gator, hit.idx);
        // clicking empty space leaves any open menu visible
    });

    // Suppress the browser context menu on right-click so right-drag look works cleanly
    _canvas.addEventListener('contextmenu', e => e.preventDefault());
    // ── POV context menu (vars at module scope so destroyBabylon can dismiss) ──

    /**
     * Project all living (non-POV) gator heads to screen space and return the one
     * closest to (clickX, clickY) in CSS pixels, or null if none within hitRadius.
     */
    function _pickGatorAtScreen(clickX, clickY, hitRadius, curId) {
        const BABYLON = window.BABYLON;
        const alive = living();
        let bestIdx = -1, bestDist = Infinity;
        alive.forEach((g, i) => {
            if (g.id === curId) return;
            const data = gatorMeshes.get(g.id);
            if (!data || !data.root) return;
            const headPos = data.root.position.clone();
            headPos.y += 3.2;
            try {
                const vp = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
                const sp = BABYLON.Vector3.Project(headPos, BABYLON.Matrix.Identity(), scene.getTransformMatrix(), vp);
                if (sp.z < 0 || sp.z > 1) return;
                const dpr = window.devicePixelRatio || 1;
                const sx = sp.x / dpr, sy = sp.y / dpr;
                const d = Math.hypot(sx - clickX, sy - clickY);
                if (d < bestDist && d < hitRadius) { bestDist = d; bestIdx = i; }
            } catch (_) {}
        });
        return bestIdx === -1 ? null : { gator: living()[bestIdx], idx: bestIdx };
    }

    /**
     * Shows the POV interaction context menu near the clicked gator.
     *
     * Called when the user clicks on another gator's mesh while in POV mode.
     * Releases pointer lock so the player can move the mouse to the menu items.
     * The menu is auto-dismissed the next time the user clicks anywhere outside it.
     *
     * MENU ITEMS:
     *   💬 Start Conversation — only enabled when no other AI conversation is running.
     *   🦷 Attack!            — only enabled when outside the bite cooldown window.
     *   🎯 Make Attack…       — same cooldown gate; opens a two-step gator picker.
     *   👁 Switch POV         — always enabled; moves activeGatorIndex to clicked gator.
     *
     * @param {number} clientX      - Mouse X position (relative to viewport).
     * @param {number} clientY      - Mouse Y position (relative to viewport).
     * @param {object} targetGator  - The gator whose mesh was clicked.
     * @param {number} targetIdx    - The index of targetGator in the living() array.
     */
    function _showCtxMenu(clientX, clientY, targetGator, targetIdx) {
        _dismissCtxMenu();
        // Release pointer lock so the user can click menu items
        if (document.pointerLockElement === _canvas) document.exitPointerLock();

        const container = _canvas?.parentElement;
        if (!container) return;

        const alive    = living();
        // Determine which gator the player is currently viewing.
        // We mod by alive.length to guard against index staleness after a death.
        const povGator = alive[activeGatorIndex % Math.max(alive.length, 1)] ?? null;
        // Only allow new conversations when no AI call is already in progress.
        const canConverse = !state.activeConversation && !state.noNewConversations;
        // Only allow attacks once the cooldown period has elapsed.
        const canAttack   = (Date.now() - _lastBiteMs) >= BITE_COOLDOWN_MS;

        const menu = document.createElement('div');
        menu.className = 'pov-context-menu';
        menu.innerHTML = `
            <div class="pov-ctx-title">🐊 ${targetGator.name}</div>
            <button class="pov-ctx-btn" id="pov-ctx-conv"${canConverse ? '' : ' disabled'}>💬 Start Conversation</button>
            <button class="pov-ctx-btn pov-ctx-cancel" id="pov-ctx-cancel-conv" style="display:none">❌ Cancel Conversation</button>
            <button class="pov-ctx-btn pov-ctx-attack" id="pov-ctx-attack"${canAttack ? '' : ' disabled'} title="${canAttack ? 'Bite this gator!' : 'Cooling down…'}">🦷 Attack!</button>
            <button class="pov-ctx-btn pov-ctx-make-attack" id="pov-ctx-make-attack"${canAttack ? '' : ' disabled'} title="${canAttack ? 'Order another gator to attack' : 'Cooling down…'}">🎯 Make Attack…</button>
            <button class="pov-ctx-btn" id="pov-ctx-switch">👁 Switch POV</button>
            <button class="pov-ctx-btn pov-ctx-close" id="pov-ctx-close">✖ Close</button>`;

        // Position near cursor, clamped inside container
        const cRect = container.getBoundingClientRect();
        let left = clientX - cRect.left + 10;
        let top  = clientY - cRect.top  + 10;
        menu.style.cssText = `left:${left}px;top:${top}px;`;
        container.appendChild(menu);
        _ctxMenu = menu;

        // Clamp after render so we know the menu size
        requestAnimationFrame(() => {
            if (!_ctxMenu) return;
            const mRect = menu.getBoundingClientRect();
            const cR    = container.getBoundingClientRect();
            if (mRect.right  > cR.right)  left -= mRect.right  - cR.right  + 8;
            if (mRect.bottom > cR.bottom) top  -= mRect.bottom - cR.bottom + 8;
            menu.style.left = `${Math.max(4, left)}px`;
            menu.style.top  = `${Math.max(4, top)}px`;
        });

        // Show / hide conv vs cancel buttons based on whether a conversation is active
        const cancelBtn = menu.querySelector('#pov-ctx-cancel-conv');
        const convBtn   = menu.querySelector('#pov-ctx-conv');
        if (state.activeConversation) {
            convBtn.style.display   = 'none';
            cancelBtn.style.display = '';
        }

        convBtn.addEventListener('click', e => {
            e.stopPropagation();
            _dismissCtxMenu();
            startPovConversation(povGator, targetGator);
        });

        cancelBtn.addEventListener('click', e => {
            e.stopPropagation();
            _dismissCtxMenu();
            cancelPovConversation(povGator, targetGator);
        });

        menu.querySelector('#pov-ctx-attack').addEventListener('click', e => {
            e.stopPropagation();
            _dismissCtxMenu();
            if (!povGator) return;

            _lastBiteMs = Date.now();
            const result = applyBiteEffect(povGator.id, targetGator.id);
            if (!result) return;

            // Visual feedback
            _triggerBiteFlash(container);

            // Brief on-screen toast so the player knows the social fallout
            const witnessText = result.witnessCount > 0
                ? ` ${result.witnessCount} gator${result.witnessCount > 1 ? 's' : ''} witnessed it.`
                : ' Nobody saw.';
            _showBiteToast(container, `🦷 You bit ${targetGator.name}!${witnessText}`);
        });

        // ── Make Attack button ────────────────────────────────────────────────
        // "Make Attack" lets the player *order* another living gator to attack a
        // specific target.  Clicking it opens a two-step inline picker:
        //   Step 1: choose the attacker (any living gator except the POV gator itself)
        //   Step 2: choose the victim   (any living gator except the chosen attacker)
        // Once both are selected, applyBiteEffect(attacker, victim) fires with the
        // same social consequences as a natural bite, plus a toast describing what happened.
        menu.querySelector('#pov-ctx-make-attack').addEventListener('click', e => {
            e.stopPropagation();
            if (!povGator) return;
            _showMakeAttackPicker(container, povGator, targetGator);
        });

        menu.querySelector('#pov-ctx-switch').addEventListener('click', e => {
            e.stopPropagation();
            _dismissCtxMenu();
            activeGatorIndex = targetIdx;
        });

        menu.querySelector('#pov-ctx-close').addEventListener('click', e => {
            e.stopPropagation();
            _dismissCtxMenu();
        });

        // Menu stays open until the user picks an action or clicks ✖ Close
    }   // end _showCtxMenu

    // Enter manual mode immediately — the user always drives the camera in POV.
    _manualActive = true;

    // ── HUD button wiring ──────────────────────────────────────────────────
    const _hudPauseBtn    = document.getElementById('pov-hud-pause-btn');
    const _hudRelDeltaBtn = document.getElementById('pov-hud-rel-delta-btn');

    _hudPauseBtn?.addEventListener('click', () => {
        hudPausePov();
        _hudPauseBtn.textContent = _povPaused ? '▶ Resume' : '⏸ Pause';
    });

    _hudRelDeltaBtn?.addEventListener('click', () => {
        state.showRelDelta = !state.showRelDelta;
        _hudRelDeltaBtn.textContent = `💬 Rel: ${state.showRelDelta ? 'ON' : 'OFF'}`;
        // Keep the 2D toggle button in sync if it exists
        const btn2d = document.getElementById('relDeltaToggleBtn');
        if (btn2d) btn2d.textContent = `\ud83d\udcac Rel. Changes: ${state.showRelDelta ? 'ON' : 'OFF'}`;
    });

    engine.runRenderLoop(() => {
        if (!scene) return;
        if (state.houses.length > 0 && houseMeshes.length === 0) buildHouses();
        if (state.gators.length > 0) {
            const dt = engine.getDeltaTime() / 1000;

            if (!_povPaused) {
                syncGatorMeshes(dt);

                // ── Jump physics ─────────────────────────────────────────────
                if (_jumpVelocity !== 0 || _jumpY > 0) {
                    _jumpVelocity -= GRAVITY * dt;
                    _jumpY += _jumpVelocity * dt;
                    if (_jumpY < 0) { _jumpY = 0; _jumpVelocity = 0; }
                }

                if (_manualActive) {
                    _applyManualCamera(dt);
                } else {
                    updateCamera();
                }

                // Apply jump height on top of whatever the camera system set Y to
                if (_jumpY > 0) camera.position.y += _jumpY;
            }

            const alive = living();
            const activeGator = alive[activeGatorIndex % Math.max(alive.length, 1)] ?? null;
            state.povGatorId = activeGator?.id ?? null;
            updatePovBubbles(activeGator);
            const label = document.getElementById('babylon-pov-gator-label');
            if (label && activeGator) label.textContent = `🐊 ${activeGator.name}`;
            const pauseBtn = document.getElementById('pov-hud-pause-btn');
            if (pauseBtn) pauseBtn.textContent = _povPaused ? '▶ Resume' : '⏸ Pause';
        }
        scene.render();
    });

    // Register the POV response-choice handler with the conversation queue.
    // This must happen after initBabylon so the container reference is live.
    setPovChoiceHandler((options, onPick) => {
        _showPovChoices(options, onPick);
    });
}

// ── POV conversation response choices ─────────────────────────────────────
// Shown during a conversation when it is the player-controlled gator's turn.
// The other gator waits silently until the player picks a response.

let _choicePanel = null;

/**
 * Display the in-conversation response-choice panel.
 * @param {string[]} options  - 2–3 text choices to present.
 * @param {function} onPick   - Called with the chosen string when the player selects.
 */
function _showPovChoices(options, onPick) {
    _dismissPovChoices();
    const container = _canvas?.parentElement;
    if (!container) { onPick(options[0]); return; }

    // Release pointer lock so the player can click
    if (document.pointerLockElement === _canvas) document.exitPointerLock();

    const panel = document.createElement('div');
    panel.className = 'pov-choices';

    const label = document.createElement('div');
    label.className = 'pov-choices-label';
    label.textContent = 'Your response…';
    panel.appendChild(label);

    options.forEach(text => {
        const isIgnore = text === '__IGNORE__';
        const btn = document.createElement('button');
        btn.className = isIgnore ? 'pov-choice-btn pov-choice-ignore' : 'pov-choice-btn';
        btn.textContent = isIgnore ? '🚶 Ignore (walk away)' : text;
        btn.addEventListener('click', () => {
            _dismissPovChoices();
            onPick(text);
        });
        panel.appendChild(btn);
    });

    container.appendChild(panel);
    _choicePanel = panel;
}

function _dismissPovChoices() {
    if (_choicePanel) { _choicePanel.remove(); _choicePanel = null; }
}

// ── Bite flash/toast state (module-scope so destroyBabylon + hudAttack can reach them) ──
let _biteFlashEl    = null;
let _biteFlashTimer = null;
let _biteToastEl    = null;
let _biteToastTimer = null;

/** Flash the VICTIM gator's body mesh red for ~600 ms — no overlay change. */
function flashGatorRed(gatorId) {
    const data = gatorMeshes.get(gatorId);
    if (!data?.bodyMat) return;
    const BABYLON = window.BABYLON;
    const originalDiffuse = data.bodyMat.diffuseColor.clone();
    data.bodyMat.diffuseColor  = new BABYLON.Color3(1, 0.05, 0.05);
    data.bodyMat.emissiveColor = new BABYLON.Color3(0.8, 0, 0);
    const steps = [100, 200, 350, 500, 600];
    steps.forEach((ms, i) => {
        setTimeout(() => {
            if (!data.bodyMat) return;
            const t = i / (steps.length - 1);
            data.bodyMat.diffuseColor = BABYLON.Color3.Lerp(
                new BABYLON.Color3(1, 0.05, 0.05), originalDiffuse, t);
            if (i === steps.length - 1) {
                data.bodyMat.diffuseColor  = originalDiffuse;
                data.bodyMat.emissiveColor = new BABYLON.Color3(0, 0, 0);
            }
        }, ms);
    });
}

function _triggerBiteFlash(container) {
    if (_biteFlashTimer) { clearTimeout(_biteFlashTimer); _biteFlashEl?.remove(); }
    const flash = document.createElement('div');
    flash.className = 'pov-bite-flash';
    container.appendChild(flash);
    _biteFlashEl = flash;
    container.classList.add('pov-shake');
    setTimeout(() => container.classList.remove('pov-shake'), 350);
    requestAnimationFrame(() => { requestAnimationFrame(() => { flash.style.opacity = '0'; }); });
    _biteFlashTimer = setTimeout(() => {
        flash.remove(); _biteFlashEl = null; _biteFlashTimer = null;
    }, 600);
}

function _showBiteToast(container, text) {
    if (_biteToastTimer) { clearTimeout(_biteToastTimer); _biteToastEl?.remove(); }
    const toast = document.createElement('div');
    toast.className = 'pov-bite-toast';
    toast.textContent = text;
    container.appendChild(toast);
    _biteToastEl = toast;
    requestAnimationFrame(() => { requestAnimationFrame(() => { toast.style.opacity = '1'; }); });
    _biteToastTimer = setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => { toast.remove(); _biteToastEl = null; }, 500);
        _biteToastTimer = null;
    }, 3000);
}

/**
 * Two-step attacker → victim picker at module scope.
 * povGator may be null (HUD Make Attack with no context gator selected).
 */
// ── Influence system ─────────────────────────────────────────────────────────
// Full catalogue of influence types.  Six are chosen at random each time the
// picker is opened so the options feel dynamic and replayable.
const _INFLUENCE_TYPES = [
    { emoji: '💚', name: 'Likes',       delta: [25,  45]  },
    { emoji: '❤️',  name: 'Adores',     delta: [55,  75]  },
    { emoji: '🤝', name: 'Warms Up To', delta: [15,  30]  },
    { emoji: '🫂', name: 'Befriends',   delta: [40,  60]  },
    { emoji: '🌟', name: 'Admires',     delta: [35,  55]  },
    { emoji: '🌿', name: 'Trusts',      delta: [20,  40]  },
    { emoji: '💔', name: 'Dislikes',    delta: [-25, -40] },
    { emoji: '😤', name: 'Resents',     delta: [-35, -55] },
    { emoji: '🖤', name: 'Hates',       delta: [-55, -75] },
    { emoji: '😱', name: 'Fears',       delta: [-60, -80] },
    { emoji: '🕵️', name: 'Suspects',   delta: [-15, -30] },
    { emoji: '😒', name: 'Ignores',     delta: [-10, -20] },
];

/** Apply one influence step to g1's feelings toward g2. Returns { prev, next, delta }. */
function _applyInfluence(g1, g2, inf) {
    g1.relations          ??= {};
    g1.perceivedRelations ??= {};
    const [lo, hi] = inf.delta;
    const sign  = lo < 0 ? -1 : 1;
    const mag   = Math.abs(lo) + Math.floor(Math.random() * (Math.abs(hi) - Math.abs(lo) + 1));
    const delta = sign * mag;
    const prev  = g1.relations[g2.id] ?? 0;
    const next  = Math.max(-100, Math.min(100, prev + delta));
    g1.relations[g2.id]          = next;
    g1.perceivedRelations[g2.id] = next;
    return { prev, next, delta };
}

/** Three-step influence picker: pick g1 → pick influence type → pick g2 → apply. */
function _showInfluencePicker(container) {
    const existing = container.querySelector('.pov-influence-picker');
    if (existing) existing.remove();

    const allGators = living();
    if (allGators.length < 2) {
        _showBiteToast(container, '⚠️ Need at least 2 gators!');
        return;
    }

    const picker = document.createElement('div');
    picker.className = 'pov-make-attack-picker pov-influence-picker';

    function renderStep(title, options, onSelect) {
        picker.innerHTML = `<div class="pov-picker-title">${title}</div>`;
        for (const opt of options) {
            const btn = document.createElement('button');
            btn.className = 'pov-picker-btn';
            btn.textContent = `${opt.emoji ?? '🐊'} ${opt.name}`;
            btn.addEventListener('click', ev => { ev.stopPropagation(); onSelect(opt); });
            picker.appendChild(btn);
        }
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'pov-picker-btn pov-picker-cancel';
        cancelBtn.textContent = '✖ Cancel';
        cancelBtn.addEventListener('click', ev => { ev.stopPropagation(); picker.remove(); });
        picker.appendChild(cancelBtn);
    }

    // Step 1 — pick the influencer
    renderStep('🧠 Who will feel something new?',
        allGators.map(g => ({ emoji: g.emoji ?? '🐊', name: g.name, _g: g })),
        ({ _g: g1 }) => {
            // Step 2 — pick influence type (6 random from full catalogue)
            const options = [..._INFLUENCE_TYPES]
                .sort(() => Math.random() - 0.5)
                .slice(0, 6);
            renderStep(`🧠 How does ${g1.name} feel?`, options, inf => {
                // Step 3 — pick the target
                const targets = living().filter(g => g.id !== g1.id);
                if (targets.length === 0) {
                    picker.remove();
                    _showBiteToast(container, '⚠️ No other gators to target!');
                    return;
                }
                renderStep(
                    `${inf.emoji} ${g1.name} ${inf.name}\u2026 toward who?`,
                    targets.map(g => ({ emoji: g.emoji ?? '🐊', name: g.name, _g: g })),
                    ({ _g: g2 }) => {
                        picker.remove();
                        const { delta } = _applyInfluence(g1, g2, inf);
                        const dir = delta >= 0 ? '▲' : '▼';
                        _showBiteToast(container,
                            `${inf.emoji} ${g1.name} now ${inf.name} ${g2.name} (${dir}${Math.abs(delta)})`);
                    }
                );
            });
        }
    );

    picker.style.left = '50%';
    picker.style.transform = 'translateX(-50%)';
    picker.style.top = '80px';
    container.appendChild(picker);

    setTimeout(() => {
        window.addEventListener('click', function dismissInfluence(ev) {
            if (!picker.contains(ev.target)) {
                picker.remove();
                window.removeEventListener('click', dismissInfluence, true);
            }
        }, { capture: true });
    }, 0);
}

function _showMakeAttackPicker(container, povGator, _targetGator) {
    const existing = container.querySelector('.pov-make-attack-picker');
    if (existing) existing.remove();

    const aliveGators = living().filter(g => g.id !== (povGator?.id ?? -1));
    if (aliveGators.length === 0) {
        _showBiteToast(container, '\u26a0\ufe0f No other living gators to order!');
        return;
    }

    const picker = document.createElement('div');
    picker.className = 'pov-make-attack-picker';

    function _renderPickerStep(title, options, onSelect) {
        picker.innerHTML = `<div class="pov-picker-title">${title}</div>`;
        for (const g of options) {
            const btn = document.createElement('button');
            btn.className = 'pov-picker-btn';
            btn.textContent = `${g.emoji ?? '\ud83d\udc0a'} ${g.name}`;
            btn.addEventListener('click', ev => { ev.stopPropagation(); onSelect(g); });
            picker.appendChild(btn);
        }
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'pov-picker-btn pov-picker-cancel';
        cancelBtn.textContent = '\u2716 Cancel';
        cancelBtn.addEventListener('click', ev => { ev.stopPropagation(); picker.remove(); });
        picker.appendChild(cancelBtn);
    }

    _renderPickerStep('\ud83c\udfaf Who will attack?', aliveGators, (chosenAttacker) => {
        const victimOptions = living().filter(g => g.id !== chosenAttacker.id);
        if (victimOptions.length === 0) {
            picker.remove();
            _showBiteToast(container, `\u26a0\ufe0f No valid targets for ${chosenAttacker.name}!`);
            return;
        }
        _renderPickerStep(`\ud83d\udc0a ${chosenAttacker.name} attacks who?`, victimOptions, (chosenVictim) => {
            picker.remove();
            // Queue the attack — attacker will walk to victim and bite; do NOT change view.
            commandAttack(chosenAttacker.id, chosenVictim.id);
            const witnessText = ''; // witness count not known until bite resolves
            _showBiteToast(container, `\ud83c\udfaf ${chosenAttacker.name} is moving to attack ${chosenVictim.name}!`);
            // Flash victim red after estimated travel time (capped at 8 s)
            const attacker = state.gators.find(g => g.id === chosenAttacker.id);
            const victim   = state.gators.find(g => g.id === chosenVictim.id);
            const travelMs = attacker && victim
                ? Math.min(8000, Math.max(600,
                    Math.hypot(victim.x - attacker.x, victim.y - attacker.y) / (attacker.speed || 1.5) * 60))
                : 2000;
            setTimeout(() => flashGatorRed(chosenVictim.id), travelMs);
        });
    });

    picker.style.left = '50%';
    picker.style.transform = 'translateX(-50%)';
    picker.style.top = '80px';
    container.appendChild(picker);

    setTimeout(() => {
        window.addEventListener('click', function dismissPicker(ev) {
            if (!picker.contains(ev.target)) {
                picker.remove();
                window.removeEventListener('click', dismissPicker, true);
            }
        }, { capture: true });
    }, 0);
}

export function destroyBabylon() {
    if (!initialized) return;
    initialized = false;
    state.povGatorId = null;
    _dismissCtxMenu();
    _dismissPovChoices();
    _biteToastEl?.remove(); _biteToastEl = null;
    _biteFlashEl?.remove(); _biteFlashEl = null;
    window.removeEventListener('resize',   onResize);
    window.removeEventListener('keydown',  _onKeyDown);
    window.removeEventListener('keyup',    _onKeyUp);
    if (_canvas) {
        _canvas.removeEventListener('pointerdown',   _onMouseDown);
        _canvas.removeEventListener('pointerup',     _onMouseUp);
        _canvas.removeEventListener('pointermove',   _onMouseMove);
    }
    _keys.clear();
    _manualActive = false;
    _jumpY = 0;
    _jumpVelocity = 0;
    clearTimeout(_manualTimer);

    // Clear POV bubble DOM
    _povBubbleDivs.forEach(d => d.remove());
    _povBubbleDivs.clear();
    const selfSpeech = document.getElementById('pov-self-speech');
    if (selfSpeech) selfSpeech.style.display = 'none';

    gatorMeshes.forEach(d => d.root.dispose());
    gatorMeshes.clear();
    houseMeshes.forEach(m => m.dispose());
    houseMeshes = [];

    engine.stopRenderLoop();
    scene.dispose();
    engine.dispose();
    engine = null;
    scene = null;
    camera = null;

    if (_canvas && _canvas.parentNode) _canvas.parentNode.removeChild(_canvas);
    _canvas = null;
}

export function nextGator() {
    const alive = living();
    if (!alive.length) return;
    activeGatorIndex = (activeGatorIndex + 1) % alive.length;
}

export function prevGator() {
    const alive = living();
    if (!alive.length) return;
    activeGatorIndex = (activeGatorIndex - 1 + alive.length) % alive.length;
}

/** Jump directly to a specific gator by simulation id. */
export function setActiveGatorById(id) {
    const alive = living();
    const idx = alive.findIndex(g => g.id === id);
    if (idx !== -1) activeGatorIndex = idx;
}

/**
 * HUD Attack button — if a target gator is visible in the context menu, use that.
 * Otherwise show a picker of all living gators; selecting one commands the POV
 * gator to walk toward them and bite when in range.
 */
export function hudAttack() {
    const container = _canvas?.parentElement;
    if (!container) return;
    if ((Date.now() - _lastBiteMs) < BITE_COOLDOWN_MS) {
        _showBiteToast(container, '\u23f3 Attack cooling down\u2026');
        return;
    }
    const alive = living();
    const povGator = alive[activeGatorIndex % Math.max(alive.length, 1)] ?? null;
    if (!povGator) return;

    // Show a one-step victim picker (all alive gators except the POV gator)
    const existing = container.querySelector('.pov-make-attack-picker');
    if (existing) existing.remove();

    const victims = alive.filter(g => g.id !== povGator.id);
    if (victims.length === 0) { _showBiteToast(container, '\u26a0\ufe0f No other gators!'); return; }

    const picker = document.createElement('div');
    picker.className = 'pov-make-attack-picker';
    picker.innerHTML = `<div class="pov-picker-title">\ud83e\uddb7 Who to bite?</div>`;
    for (const g of victims) {
        const btn = document.createElement('button');
        btn.className = 'pov-picker-btn';
        btn.textContent = `${g.emoji ?? '\ud83d\udc0a'} ${g.name}`;
        btn.addEventListener('click', ev => {
            ev.stopPropagation();
            picker.remove();
            _lastBiteMs = Date.now();
            commandAttack(povGator.id, g.id);
            _showBiteToast(container, `\ud83e\uddb7 Moving to bite ${g.name}\u2026`);
            // Flash victim red after estimated travel time
            const travelMs2 = Math.min(8000, Math.max(600,
                Math.hypot(g.x - povGator.x, g.y - povGator.y) / (povGator.speed || 1.5) * 60));
            setTimeout(() => flashGatorRed(g.id), travelMs2);
        });
        picker.appendChild(btn);
    }
    const cancel = document.createElement('button');
    cancel.className = 'pov-picker-btn pov-picker-cancel';
    cancel.textContent = '\u2716 Cancel';
    cancel.addEventListener('click', ev => { ev.stopPropagation(); picker.remove(); });
    picker.appendChild(cancel);
    picker.style.cssText = 'left:50%;transform:translateX(-50%);top:80px;';
    container.appendChild(picker);
    setTimeout(() => {
        window.addEventListener('click', function d(ev) {
            if (!picker.contains(ev.target)) { picker.remove(); window.removeEventListener('click', d, true); }
        }, { capture: true });
    }, 0);
}

/**
 * HUD Make Attack button — always shows the full two-step
 * attacker → victim picker regardless of whether a target is active.
 */
export function hudMakeAttack() {
    const container = _canvas?.parentElement ?? document.getElementById('world');
    if (!container) return;
    const alive = living();
    const povGator = alive[activeGatorIndex % Math.max(alive.length, 1)] ?? null;
    // Pass null as targetGator so the picker shows all gators as potential attackers
    // except the POV gator (the player), matching the existing Make Attack UX.
    _showMakeAttackPicker(container, povGator, null);
}

/**
 * HUD Influence button — three-step picker:
 *   1. Choose the influencer (g1)
 *   2. Choose an influence type (6 randomised options)
 *   3. Choose the target (g2)
 * Applies the relation delta immediately to g1's feelings toward g2.
 */
export function hudInfluence() {
    const container = _canvas?.parentElement ?? document.getElementById('world');
    if (!container) return;
    _showInfluencePicker(container);
}

/** Toggle POV pause — freezes gator movement / camera tracking while canvas still renders. */
export function hudPausePov() {
    _povPaused = !_povPaused;
}

// ── Relationship delta floating labels (POV) ─────────────────────────────────
// Maps gatorId → { div, expiry } for labels floating above their heads.
const _relDeltaDivs = new Map();

/**
 * Show a floating relationship-change label above a gator's head in the POV view.
 * Called by simulation.js / agentQueue.js after any relation change.
 * @param {number} gatorId  - Whose head to place the label above.
 * @param {string} text     - e.g. "Hates that sports team – Dislike +25"
 * @param {number} delta    - Numeric delta; negative = bad (red), positive = good (green).
 */
export function showRelDeltaLabel(gatorId, text, delta) {
    if (!state.showRelDelta) return;
    const container = _canvas?.parentElement;
    if (!container) return;
    // Remove any existing label for this gator
    const existing = _relDeltaDivs.get(gatorId);
    if (existing) { existing.div.remove(); _relDeltaDivs.delete(gatorId); }

    const div = document.createElement('div');
    div.className = 'pov-rel-delta ' + (delta >= 0 ? 'pov-rel-delta-pos' : 'pov-rel-delta-neg');
    div.textContent = text;
    container.appendChild(div);

    // Position it on the next frame once we can project the head
    const positionLabel = () => {
        if (!div.isConnected) return;
        const sp = _projectHead(gatorId);
        if (sp) {
            div.style.left = `${sp.x}px`;
            div.style.top  = `${sp.y - 60}px`;
        }
    };
    requestAnimationFrame(positionLabel);

    // Auto-remove after 3 s
    const timer = setTimeout(() => {
        div.style.opacity = '0';
        setTimeout(() => { div.remove(); _relDeltaDivs.delete(gatorId); }, 600);
    }, 3000);
    _relDeltaDivs.set(gatorId, { div, timer });
}

function onResize() {
    if (engine) engine.resize();
}
