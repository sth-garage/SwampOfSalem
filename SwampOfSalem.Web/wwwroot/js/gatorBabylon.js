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

// ── Constants ──────────────────────────────────────────────────────────────
const SCALE  = 0.1;
const CAM_H  = 2.0;
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

function worldX(px) { return px * SCALE; }
function worldZ(py) { return py * SCALE; }

// ── Scene ──────────────────────────────────────────────────────────────────
function buildScene() {
    const BABYLON = window.BABYLON;

    scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.10, 0.23, 0.10, 1);
    scene.fogMode    = BABYLON.Scene.FOGMODE_LINEAR;
    scene.fogColor   = new BABYLON.Color3(0.10, 0.23, 0.10);
    scene.fogStart   = 40;
    scene.fogEnd     = 140;

    // Lighting
    new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene)
        .intensity = 0.9;
    const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -2, -0.5), scene);
    sun.intensity = 1.4;
    sun.diffuse   = new BABYLON.Color3(1, 0.93, 0.71);

    // Swamp floor
    const floor = BABYLON.MeshBuilder.CreateGround('floor', { width: 240, height: 160, subdivisions: 10 }, scene);
    floor.position = new BABYLON.Vector3(60, 0, 40);
    const floorMat = new BABYLON.StandardMaterial('floorMat', scene);
    floorMat.diffuseColor = new BABYLON.Color3(0.18, 0.35, 0.15);
    floor.material = floorMat;

    // Water patches
    const waterMat = new BABYLON.StandardMaterial('waterMat', scene);
    waterMat.diffuseColor = new BABYLON.Color3(0.10, 0.29, 0.23);
    waterMat.alpha = 0.85;
    [[20, 20, 18, 12], [90, 50, 24, 10], [50, 65, 14, 16], [110, 25, 20, 8]]
        .forEach(([x, z, w, d], i) => {
            const patch = BABYLON.MeshBuilder.CreateGround(`water${i}`, { width: w, height: d }, scene);
            patch.position = new BABYLON.Vector3(x, 0.01, z);
            patch.material = waterMat;
        });

    buildTrees();
}

function buildTrees() {
    const BABYLON = window.BABYLON;

    const trunkMat = new BABYLON.StandardMaterial('trunkMat', scene);
    trunkMat.diffuseColor = new BABYLON.Color3(0.24, 0.17, 0.10);
    const leafMat = new BABYLON.StandardMaterial('leafMat', scene);
    leafMat.diffuseColor = new BABYLON.Color3(0.12, 0.30, 0.12);

    const positions = [];
    // Perimeter
    for (let i = 0; i < 40; i++) {
        const edge = Math.floor(Math.random() * 4);
        let x, z;
        if (edge === 0)      { x = Math.random() * 240 - 5; z = -8 + Math.random() * 6; }
        else if (edge === 1) { x = Math.random() * 240 - 5; z = 86 + Math.random() * 6; }
        else if (edge === 2) { x = -8 + Math.random() * 6;  z = Math.random() * 80; }
        else                 { x = 126 + Math.random() * 6; z = Math.random() * 80; }
        positions.push([x, z]);
    }
    // Interior scatter
    for (let i = 0; i < 12; i++) {
        positions.push([5 + Math.random() * 110, 4 + Math.random() * 72]);
    }

    positions.forEach(([x, z], idx) => {
        const h = 4 + Math.random() * 5;
        const trunk = BABYLON.MeshBuilder.CreateCylinder(`trunk${idx}`, { diameterTop: 0.6, diameterBottom: 1.0, height: h, tessellation: 6 }, scene);
        trunk.position = new BABYLON.Vector3(x, h / 2, z);
        trunk.material = trunkMat;

        const leafH = 3 + Math.random() * 3;
        const leaf = BABYLON.MeshBuilder.CreateCylinder(`leaf${idx}`, { diameterTop: 0, diameterBottom: (2 + Math.random()) * 2, height: leafH, tessellation: 6 }, scene);
        leaf.position = new BABYLON.Vector3(x, h + leafH / 2 - 0.5, z);
        leaf.material = leafMat;
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
    });
}

// ── Gator meshes ───────────────────────────────────────────────────────────
function getOrCreateGatorMesh(gator) {
    if (gatorMeshes.has(gator.id)) return gatorMeshes.get(gator.id);

    const BABYLON = window.BABYLON;
    const isDead  = state.deadIds.has(gator.id);

    const bodyColor = isDead ? new BABYLON.Color3(0.33, 0.33, 0.33) : new BABYLON.Color3(0.29, 0.48, 0.19);
    const bodyMat = new BABYLON.StandardMaterial(`bmat${gator.id}`, scene);
    bodyMat.diffuseColor = bodyColor;
    if (isDead) { bodyMat.alpha = 0.4; }

    const snoutMat = new BABYLON.StandardMaterial(`smat${gator.id}`, scene);
    snoutMat.diffuseColor = new BABYLON.Color3(0.24, 0.38, 0.15);

    const eyeMat = new BABYLON.StandardMaterial(`emat${gator.id}`, scene);
    eyeMat.diffuseColor = new BABYLON.Color3(1, 0.87, 0);

    // Label colour
    const colors = [
        new BABYLON.Color3(1,0.40,0.27), new BABYLON.Color3(0.27,0.67,1),
        new BABYLON.Color3(1,0.80,0.13), new BABYLON.Color3(0.67,0.40,1),
        new BABYLON.Color3(0.27,1,0.67), new BABYLON.Color3(1,0.27,0.67),
        new BABYLON.Color3(0.53,1,0.80), new BABYLON.Color3(1,0.67,0.27),
        new BABYLON.Color3(0.40,0.73,1),
    ];
    const labelMat = new BABYLON.StandardMaterial(`lmat${gator.id}`, scene);
    labelMat.diffuseColor = colors[gator.id % colors.length];
    labelMat.emissiveColor = colors[gator.id % colors.length];

    const parent = new BABYLON.TransformNode(`gator${gator.id}`, scene);

    const body = BABYLON.MeshBuilder.CreateBox(`body${gator.id}`, { width: 1.4, height: 0.6, depth: 3.0 }, scene);
    body.position.y = 0.5; body.material = bodyMat; body.parent = parent;

    const head = BABYLON.MeshBuilder.CreateBox(`head${gator.id}`, { width: 0.9, height: 0.5, depth: 1.2 }, scene);
    head.position = new BABYLON.Vector3(0, 0.5, -1.8); head.material = bodyMat; head.parent = parent;

    const snout = BABYLON.MeshBuilder.CreateBox(`snout${gator.id}`, { width: 0.7, height: 0.25, depth: 0.8 }, scene);
    snout.position = new BABYLON.Vector3(0, 0.38, -2.55); snout.material = snoutMat; snout.parent = parent;

    [-0.28, 0.28].forEach((ex, ei) => {
        const eye = BABYLON.MeshBuilder.CreateSphere(`eye${gator.id}_${ei}`, { diameter: 0.2, segments: 6 }, scene);
        eye.position = new BABYLON.Vector3(ex, 0.78, -1.75); eye.material = eyeMat; eye.parent = parent;
    });

    const tail = BABYLON.MeshBuilder.CreateBox(`tail${gator.id}`, { width: 0.6, height: 0.35, depth: 1.4 }, scene);
    tail.position = new BABYLON.Vector3(0, 0.42, 1.7); tail.material = bodyMat; tail.parent = parent;

    const label = BABYLON.MeshBuilder.CreateBox(`label${gator.id}`, { width: 1.0, height: 0.4, depth: 0.08 }, scene);
    label.position = new BABYLON.Vector3(0, 1.4, -1.5); label.material = labelMat; label.parent = parent;

    gatorMeshes.set(gator.id, parent);
    return parent;
}

function syncGatorMeshes() {
    const seen = new Set();
    state.gators.forEach(g => {
        const parent = getOrCreateGatorMesh(g);
        seen.add(g.id);

        const gx = worldX(g.x);
        const gz = worldZ(g.y);
        parent.position.x = gx;
        parent.position.z = gz;
        parent.position.y = state.deadIds.has(g.id) ? -0.3 : 0;

        const mdx = (g.targetX ?? g.x) - g.x;
        const mdy = (g.targetY ?? g.y) - g.y;
        if (Math.abs(mdx) + Math.abs(mdy) > 4) {
            parent.rotation.y = Math.atan2(mdx, mdy);
        }
    });

    gatorMeshes.forEach((mesh, id) => {
        if (!seen.has(id)) {
            mesh.dispose();
            gatorMeshes.delete(id);
        }
    });
}

// ── Camera ─────────────────────────────────────────────────────────────────
function updateCamera() {
    const alive = living();
    if (!alive.length) return;
    if (activeGatorIndex >= alive.length) activeGatorIndex = 0;
    const gator = alive[activeGatorIndex];

    const label = document.getElementById('babylon-pov-gator-label');
    if (label) label.textContent = `🐊 ${gator.name ?? 'Gator'}`;

    const gx = worldX(gator.x);
    const gz = worldZ(gator.y);

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

    camera.setTarget(new window.BABYLON.Vector3(lookX, CAM_H * 0.6, lookZ));

    // Hide active gator's own mesh
    gatorMeshes.forEach((mesh, id) => {
        mesh.setEnabled(id !== gator.id);
    });
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

    window.addEventListener('resize', onResize);

    engine.runRenderLoop(() => {
        if (!scene) return;
        if (state.houses.length > 0 && houseMeshes.length === 0) buildHouses();
        if (state.gators.length > 0) {
            syncGatorMeshes();
            updateCamera();
        }
        scene.render();
    });
}

export function destroyBabylon() {
    if (!initialized) return;
    initialized = false;
    window.removeEventListener('resize', onResize);

    gatorMeshes.forEach(m => m.dispose());
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
