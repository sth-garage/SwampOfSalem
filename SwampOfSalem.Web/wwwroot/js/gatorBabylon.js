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
    belly.position = new BABYLON.Vector3(0, 1.65, -0.30);
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
    snout.position = new BABYLON.Vector3(0, -0.08, -0.85);
    snout.material = snoutMat;
    snout.parent = headPivot;

    // Teeth row (top + bottom)
    const teethTop = BABYLON.MeshBuilder.CreateBox(`teethT${gator.id}`,
        { width: 0.6, height: 0.05, depth: 0.85 }, scene);
    teethTop.position = new BABYLON.Vector3(0, -0.20, -0.85);
    teethTop.material = toothMat;
    teethTop.parent = headPivot;

    [-0.22, 0.22].forEach((ex, ei) => {
        const eye = BABYLON.MeshBuilder.CreateSphere(`eye${gator.id}_${ei}`,
            { diameter: 0.20, segments: 8 }, scene);
        eye.position = new BABYLON.Vector3(ex, 0.32, -0.10);
        eye.material = eyeMat;
        eye.parent = headPivot;

        // Pupil
        const pupil = BABYLON.MeshBuilder.CreateSphere(`pupil${gator.id}_${ei}`,
            { diameter: 0.09, segments: 6 }, scene);
        pupil.position = new BABYLON.Vector3(ex, 0.30, -0.18);
        const pmat = new BABYLON.StandardMaterial(`pmat${gator.id}_${ei}`, scene);
        pmat.diffuseColor = new BABYLON.Color3(0, 0, 0);
        pupil.material = pmat;
        pupil.parent = headPivot;
    });

    // Tail — small stub at the back of the hips for the alligator silhouette
    const tail = BABYLON.MeshBuilder.CreateBox(`tail${gator.id}`,
        { width: 0.40, height: 0.30, depth: 0.85 }, scene);
    tail.position = new BABYLON.Vector3(0, 1.0, 0.55);
    tail.rotation.x = -0.35;
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
        if (moveDist > 4) {
            // Face direction of motion (snout points -Z, so atan2(dx, dy) works)
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

    camera.setTarget(new window.BABYLON.Vector3(lookX, CAM_H * 0.85, lookZ));

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

    window.addEventListener('resize', onResize);

    engine.runRenderLoop(() => {
        if (!scene) return;
        if (state.houses.length > 0 && houseMeshes.length === 0) buildHouses();
        if (state.gators.length > 0) {
            const dt = engine.getDeltaTime() / 1000;
            syncGatorMeshes(dt);
            updateCamera();
            const alive = living();
            const activeGator = alive[activeGatorIndex % Math.max(alive.length, 1)] ?? null;
            updatePovBubbles(activeGator);
            // Update HUD label
            const label = document.getElementById('babylon-pov-gator-label');
            if (label && activeGator) label.textContent = `🐊 ${activeGator.name}`;
        }
        scene.render();
    });
}

export function destroyBabylon() {
    if (!initialized) return;
    initialized = false;
    window.removeEventListener('resize', onResize);

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
