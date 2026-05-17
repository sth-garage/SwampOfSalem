/**
 * @fileoverview gatorBabylon.js — First-person 3D alligator-POV view using Babylon.js + WebGPU.
 *
 * Renders the swamp world from the eye-level perspective of a chosen alligator
 * using the Babylon.js WebGPU engine. Falls back to WebGL if WebGPU is
 * unavailable. Scene content mirrors gator3d.js:
 *   - Green plane          : swamp floor
 *   - BoxBuilder           : houses
 *   - Cylinder meshes      : trees
 *   - Alligator body groups: other gators
 *
 * Depends on window.BABYLON being available (loaded via CDN <script> tag).
 * Only READS simulation state — never mutates it.
 *
 * @module gatorBabylon
 */

import { state } from './state.js';
import { living } from './gator.js';
import { startPovConversation } from './simulation.js';
import { setPovChoiceHandler } from './agentQueue.js';

// ── Constants ──────────────────────────────────────────────────────────────
const SCALE  = 0.1;
const CAM_H  = 2.7;
const HOUSE_W = 12;
const HOUSE_H = 7;
const HOUSE_D = 12;

// ── Module state ───────────────────────────────────────────────────────────
let engine, scene, camera;
let gatorMeshes  = new Map(); // gatorId → BABYLON.TransformNode (parent)
let houseMeshes  = [];
let initialized  = false;
let activeGatorIndex = 0;
let _canvas = null;

// ── Free-camera (WASD / arrow / mouse) ─────────────────────────────────────
// When the user touches any input key or drags the mouse the camera detaches
// from the auto-follow logic.  It reverts to gator-follow after
// MANUAL_RESUME_MS of inactivity OR when the user presses Escape.
const MANUAL_RESUME_MS = 4000;
const FREE_CAM_SPEED   = 12;   // world units per second for keyboard
const MOUSE_SENSITIVITY = 0.0020; // radians per pixel

const _keys = new Set();         // currently held keys
let _manualYaw   = 0;           // radians — horizontal look
let _manualPitch = 0;           // radians — vertical look
let _manualActive   = false;    // true while user is in control
let _manualTimer    = 0;        // setTimeout handle
let _mouseDown      = false;
let _lastMouseX     = 0;
let _lastMouseY     = 0;

function _enterManual() {
    _manualActive = true;
    clearTimeout(_manualTimer);
    _manualTimer = setTimeout(_exitManual, MANUAL_RESUME_MS);
    const hint = document.getElementById('pov-control-hint');
    if (hint) hint.style.opacity = '1';
}

function _exitManual() {
    _manualActive = false;
    const hint = document.getElementById('pov-control-hint');
    if (hint) hint.style.opacity = '0';
    if (document.pointerLockElement === _canvas) document.exitPointerLock();
}

function _onKeyDown(e) {
    if (!initialized) return;
    const k = e.key.toLowerCase();
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
    if (e.button !== 2) return;
    const container = _canvas && _canvas.parentElement;
    if (container && !container.contains(e.target)) return;
    _mouseDown = true;
    _lastMouseX = e.clientX;
    _lastMouseY = e.clientY;
    // Seed yaw/pitch from live camera direction so there is no jump
    if (camera) {
        const fwd = camera.getTarget().subtract(camera.position);
        _manualYaw   = Math.atan2(fwd.x, fwd.z);
        _manualPitch = Math.atan2(fwd.y, Math.sqrt(fwd.x * fwd.x + fwd.z * fwd.z));
    }
    _enterManual();
    e.preventDefault();
    // Pointer capture keeps move events coming even when the cursor leaves the canvas
    try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
}

function _onMouseUp(e) {
    if (e.button !== 2) return;
    _mouseDown = false;
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
    _manualYaw   -= dx * MOUSE_SENSITIVITY;
    _manualPitch += dy * MOUSE_SENSITIVITY; // inverted Y: drag down = look down
    _manualPitch  = Math.max(-1.3, Math.min(1.3, _manualPitch));
    _enterManual();
}

function _onPointerLockChange() {
    // No-op: pointer lock is not used for right-drag look
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

    buildTrees();
    buildReeds();
    buildRocks();
    buildWall();
}

// ── Village perimeter wall ────────────────────────────────────────────────────
// Four stone walls run along the edges of the island (x: 0–120, z: 0–80).
// Each wall is visible and registered in state.obstacles so the 2-D simulation
// movement code can steer gators away from it.
function buildWall() {
    const BABYLON = window.BABYLON;

    const stoneMat = new BABYLON.StandardMaterial('wallStoneMat', scene);
    stoneMat.diffuseColor  = new BABYLON.Color3(0.42, 0.38, 0.30);
    stoneMat.specularColor = new BABYLON.Color3(0.12, 0.10, 0.08);
    stoneMat.specularPower = 16;

    const capMat = new BABYLON.StandardMaterial('wallCapMat', scene);
    capMat.diffuseColor = new BABYLON.Color3(0.30, 0.28, 0.22);

    const WALL_H   = 2.8;   // wall height (world units)
    const WALL_T   = 0.9;   // wall thickness
    const ISLAND_X = 120;
    const ISLAND_Z = 80;
    const OFFSET   = 1.0;   // how far inward from the island edge the wall sits

    // Four segments: North (z≈0), South (z≈80), West (x≈0), East (x≈120)
    const segments = [
        // [cx, cz, width, depth, label]
        [ISLAND_X / 2, OFFSET,          ISLAND_X + WALL_T * 2, WALL_T, 'wallN'],
        [ISLAND_X / 2, ISLAND_Z - OFFSET, ISLAND_X + WALL_T * 2, WALL_T, 'wallS'],
        [OFFSET,          ISLAND_Z / 2, WALL_T, ISLAND_Z - OFFSET * 2, 'wallW'],
        [ISLAND_X - OFFSET, ISLAND_Z / 2, WALL_T, ISLAND_Z - OFFSET * 2, 'wallE'],
    ];

    segments.forEach(([cx, cz, w, d, name]) => {
        const wall = BABYLON.MeshBuilder.CreateBox(name,
            { width: w, height: WALL_H, depth: d }, scene);
        wall.position = new BABYLON.Vector3(cx, WALL_H / 2, cz);
        wall.material = stoneMat;

        // Crenellation cap on top
        const cap = BABYLON.MeshBuilder.CreateBox(`${name}_cap`,
            { width: w, height: WALL_T * 0.4, depth: d + WALL_T * 0.3 }, scene);
        cap.position = new BABYLON.Vector3(cx, WALL_H + WALL_T * 0.2, cz);
        cap.material = capMat;
    });

    // Corner towers
    const towerR = WALL_T * 1.4;
    const towerH = WALL_H + 1.2;
    const corners = [
        [OFFSET, OFFSET],
        [ISLAND_X - OFFSET, OFFSET],
        [OFFSET, ISLAND_Z - OFFSET],
        [ISLAND_X - OFFSET, ISLAND_Z - OFFSET],
    ];
    corners.forEach(([cx, cz], i) => {
        const tower = BABYLON.MeshBuilder.CreateCylinder(`tower${i}`,
            { diameter: towerR * 2, height: towerH, tessellation: 8 }, scene);
        tower.position = new BABYLON.Vector3(cx, towerH / 2, cz);
        tower.material = stoneMat;
    });
}

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

// Fixed island-tree positions (world units) – shared with 2-D collision system.
// Exported so simulation.js can mirror them without re-generating randomly.
export const ISLAND_TREE_POSITIONS = [
    // perimeter: north edge
    [8,3],[20,4],[34,2],[48,4],[62,3],[76,4],[90,2],[104,3],[116,4],
    // perimeter: south edge
    [8,74],[20,75],[34,73],[48,75],[62,74],[76,75],[90,73],[104,74],
    // perimeter: west edge
    [3,10],[3,22],[3,36],[3,50],[3,64],
    // perimeter: east edge
    [117,10],[117,22],[117,36],[117,50],[117,64],
    // interior scatter
    [22,18],[88,18],[40,58],[100,58],[60,34],[48,62],[72,48],[30,42],
];

function buildTrees() {
    const BABYLON = window.BABYLON;

    const trunkMat = new BABYLON.StandardMaterial('trunkMat', scene);
    trunkMat.diffuseColor = new BABYLON.Color3(0.22, 0.14, 0.07);

    // Several shades of foliage for variety
    const leafMats = [
        (() => { const m = new BABYLON.StandardMaterial('leaf0', scene); m.diffuseColor = new BABYLON.Color3(0.10, 0.28, 0.10); return m; })(),
        (() => { const m = new BABYLON.StandardMaterial('leaf1', scene); m.diffuseColor = new BABYLON.Color3(0.14, 0.34, 0.12); return m; })(),
        (() => { const m = new BABYLON.StandardMaterial('leaf2', scene); m.diffuseColor = new BABYLON.Color3(0.08, 0.22, 0.09); return m; })(),
        (() => { const m = new BABYLON.StandardMaterial('leaf3', scene); m.diffuseColor = new BABYLON.Color3(0.20, 0.38, 0.10); return m; })(),
        (() => { const m = new BABYLON.StandardMaterial('leaf4', scene); m.diffuseColor = new BABYLON.Color3(0.28, 0.40, 0.08); return m; })(), // yellowy dead
    ];

    const positions = [];

    // ── Dense far-bank forest beyond the moat ────────────────────────────
    // North bank (z < -8)
    for (let i = 0; i < 60; i++) positions.push([Math.random() * 200 - 40, -12 - Math.random() * 28, true]);
    // South bank (z > 88)
    for (let i = 0; i < 60; i++) positions.push([Math.random() * 200 - 40,  88 + Math.random() * 28, true]);
    // West bank (x < -8)
    for (let i = 0; i < 40; i++) positions.push([-12 - Math.random() * 22, Math.random() * 100 - 10, true]);
    // East bank (x > 128)
    for (let i = 0; i < 40; i++) positions.push([128 + Math.random() * 22, Math.random() * 100 - 10, true]);

    // ── Sparse trees on the island itself ─────────────────────────────────
    // Use the fixed ISLAND_TREE_POSITIONS so 2-D simulation can mirror them.
    ISLAND_TREE_POSITIONS.forEach(([x, z]) => positions.push([x, z, false]));


    positions.forEach(([x, z, isFarBank], idx) => {
        const tall = isFarBank;
        const h    = tall ? 6 + Math.random() * 8 : 3.5 + Math.random() * 4;
        const lmat = leafMats[Math.floor(Math.random() * leafMats.length)];

        const trunk = BABYLON.MeshBuilder.CreateCylinder(`trunk${idx}`,
            { diameterTop: 0.45, diameterBottom: 0.9, height: h, tessellation: 6 }, scene);
        trunk.position = new BABYLON.Vector3(x, h / 2, z);
        trunk.material = trunkMat;

        // Two canopy layers for a fuller look
        const leafH1 = (tall ? 4.5 : 3) + Math.random() * 2;
        const leaf1 = BABYLON.MeshBuilder.CreateCylinder(`leaf${idx}a`,
            { diameterTop: 0, diameterBottom: (1.6 + Math.random()) * (tall ? 3 : 2), height: leafH1, tessellation: 7 }, scene);
        leaf1.position = new BABYLON.Vector3(x, h + leafH1 / 2 - 0.8, z);
        leaf1.material = lmat;

        if (Math.random() > 0.4) {
            const leafH2 = leafH1 * 0.65;
            const leaf2 = BABYLON.MeshBuilder.CreateCylinder(`leaf${idx}b`,
                { diameterTop: 0, diameterBottom: (1.0 + Math.random()) * (tall ? 2.2 : 1.5), height: leafH2, tessellation: 7 }, scene);
            leaf2.position = new BABYLON.Vector3(x, h + leafH1 - 0.3 + leafH2 / 2 - 0.4, z);
            leaf2.material = leafMats[(leafMats.indexOf(lmat) + 1) % leafMats.length];
        }

        // Register island-side trees as circular obstacles in sim-px
        if (!isFarBank) {
            const trunkR = (0.45 + 0.5) * 10;
            state.obstacles.push({ x: x * 10, y: z * 10, r: trunkR, type: 'tree' });
        }
    });
}

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

    // Floating name label (above head)
    const label = BABYLON.MeshBuilder.CreatePlane(`label${gator.id}`,
        { width: 1.4, height: 0.45 }, scene);
    label.position = new BABYLON.Vector3(0, 3.2, 0);
    label.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    const labelMat = new BABYLON.StandardMaterial(`lmat${gator.id}`, scene);
    labelMat.emissiveColor = accent;
    labelMat.diffuseColor  = accent;
    labelMat.disableLighting = true;
    label.material = labelMat;
    label.parent = root;

    const meshData = { root, headPivot, legL, legR, armL, armR, walkPhase: Math.random() * Math.PI * 2 };
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

    // Hide active gator's own mesh
    gatorMeshes.forEach((data, id) => {
        data.root.setEnabled(id !== gator.id);
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
        // Ignore if this click was a drag-end from mouse-look
        if (_mouseDown) return;
        const alive = living();
        if (alive.length < 2) return;
        const curId = alive[activeGatorIndex % alive.length]?.id;
        const rect  = _canvas.getBoundingClientRect();
        const hit   = _pickGatorAtScreen(e.clientX - rect.left, e.clientY - rect.top, 80, curId);
        if (hit) _showCtxMenu(e.clientX, e.clientY, hit.gator, hit.idx);
        else _dismissCtxMenu();
    });

    // Suppress the browser context menu on right-click so right-drag look works cleanly
    _canvas.addEventListener('contextmenu', e => e.preventDefault());

    // ── POV context menu ────────────────────────────────────────────────────────
    let _ctxMenu = null;

    function _dismissCtxMenu() {
        if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null; }
    }

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

    function _showCtxMenu(clientX, clientY, targetGator, targetIdx) {
        _dismissCtxMenu();
        // Release pointer lock so the user can click menu items
        if (document.pointerLockElement === _canvas) document.exitPointerLock();

        const container = _canvas?.parentElement;
        if (!container) return;

        const canConverse = !state.activeConversation && !state.noNewConversations;
        const menu = document.createElement('div');
        menu.className = 'pov-context-menu';
        menu.innerHTML = `
            <div class="pov-ctx-title">🐊 ${targetGator.name}</div>
            <button class="pov-ctx-btn" id="pov-ctx-conv"${canConverse ? '' : ' disabled'}>💬 Start Conversation</button>
            <button class="pov-ctx-btn" id="pov-ctx-switch">👁 Switch POV</button>`;

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

        menu.querySelector('#pov-ctx-conv').addEventListener('click', e => {
            e.stopPropagation();
            _dismissCtxMenu();
            const alive = living();
            const povGator = alive[activeGatorIndex % Math.max(alive.length, 1)] ?? null;
            startPovConversation(povGator, targetGator);
        });

        menu.querySelector('#pov-ctx-switch').addEventListener('click', e => {
            e.stopPropagation();
            _dismissCtxMenu();
            activeGatorIndex = targetIdx;
        });

        // Dismiss on next outside click
        setTimeout(() => {
            window.addEventListener('click', _dismissCtxMenu, { once: true, capture: true });
        }, 0);
    }   // end _showCtxMenu

    engine.runRenderLoop(() => {
        if (!scene) return;
        if (state.houses.length > 0 && houseMeshes.length === 0) buildHouses();
        if (state.gators.length > 0) {
            const dt = engine.getDeltaTime() / 1000;
            syncGatorMeshes(dt);
            if (_manualActive) {
                _applyManualCamera(dt);
            } else {
                updateCamera();
            }
            const alive = living();
            const activeGator = alive[activeGatorIndex % Math.max(alive.length, 1)] ?? null;
            // Keep shared state in sync so simulation.js can skip this gator for conversations
            state.povGatorId = activeGator?.id ?? null;
            updatePovBubbles(activeGator);
            // Update HUD label
            const label = document.getElementById('babylon-pov-gator-label');
            if (label && activeGator) label.textContent = `🐊 ${activeGator.name}`;
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
        const btn = document.createElement('button');
        btn.className = 'pov-choice-btn';
        btn.textContent = text;
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

export function destroyBabylon() {
    if (!initialized) return;
    initialized = false;
    state.povGatorId = null;
    _dismissCtxMenu();
    _dismissPovChoices();
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

function onResize() {
    if (engine) engine.resize();
}
