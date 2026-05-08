/**
 * @fileoverview gator3d.js — First-person 3D alligator-POV view using Three.js.
 *
 * Renders the swamp world in 3D from the eye-level perspective of a chosen
 * alligator. The scene is built from basic polygons:
 *   - Green plane          : swamp floor
 *   - BoxGeometry          : houses
 *   - ConeGeometry (green) : other living gators
 *   - ConeGeometry (grey)  : dead gators
 *   - Trees as cylinders+cones scattered around the edges
 *
 * Camera sits at the active gator's (x, y) position mapped into 3D world
 * space and faces the direction the gator last moved.
 *
 * The simulation continues running normally — this module only READS state.
 *
 * @module gator3d
 */

import * as THREE from 'three';
import { state } from './state.js';
import { living } from './gator.js';

// ── Constants ──────────────────────────────────────────────────────────────
// 2D canvas is nominally 1200 × 800 px. Map to a 120 × 80 Three.js world.
const SCALE   = 0.1;
const CAM_H   = 2.0;   // eye height above ground (units)
const HOUSE_W = 12;
const HOUSE_H = 7;
const HOUSE_D = 12;

// ── Module-level variables ─────────────────────────────────────────────────
let renderer, scene, camera, animFrameId;
let gatorMeshes  = new Map();  // gatorId → THREE.Group
let houseMeshes  = [];
let initialized  = false;
let activeGatorIndex = 0;     // index into living() array

// ── Helpers ────────────────────────────────────────────────────────────────
function worldX(px) { return px * SCALE; }
function worldZ(py) { return py * SCALE; }

// ── Scene setup ────────────────────────────────────────────────────────────
function buildScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a3a1a);
    scene.fog = new THREE.Fog(0x1a3a1a, 40, 140);

    // Ambient + directional light
    scene.add(new THREE.AmbientLight(0x88cc88, 1.0));
    const sun = new THREE.DirectionalLight(0xffeebb, 1.6);
    sun.position.set(30, 60, 20);
    scene.add(sun);

    // Swamp floor — large muddy-green plane
    const floorGeo = new THREE.PlaneGeometry(240, 160, 20, 14);
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x2d5a27 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(60, 0, 40);
    scene.add(floor);

    // Water patches — dark teal quads
    const waterMat = new THREE.MeshLambertMaterial({ color: 0x1a4a3a, transparent: true, opacity: 0.85 });
    [[20,20,18,12],[90,50,24,10],[50,65,14,16],[110,25,20,8]].forEach(([x,z,w,d]) => {
        const wg = new THREE.PlaneGeometry(w, d);
        const wm = new THREE.Mesh(wg, waterMat);
        wm.rotation.x = -Math.PI / 2;
        wm.position.set(x, 0.01, z);
        scene.add(wm);
    });

    // Cypress trees around perimeter
    buildTrees();
}

function buildTrees() {
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3d2b1a });
    const leafMat  = new THREE.MeshLambertMaterial({ color: 0x1e4d1e });
    const positions = [];
    for (let i = 0; i < 40; i++) {
        const edge = Math.floor(Math.random() * 4);
        let x, z;
        if (edge === 0) { x = Math.random() * 240 - 5; z = -8 + Math.random() * 6; }
        else if (edge === 1) { x = Math.random() * 240 - 5; z = 86 + Math.random() * 6; }
        else if (edge === 2) { x = -8 + Math.random() * 6; z = Math.random() * 80; }
        else               { x = 126 + Math.random() * 6; z = Math.random() * 80; }
        positions.push([x, z]);
    }
    // Also scatter a few inside
    for (let i = 0; i < 12; i++) {
        positions.push([5 + Math.random() * 110, 4 + Math.random() * 72]);
    }

    positions.forEach(([x, z]) => {
        const h = 4 + Math.random() * 5;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, h, 6), trunkMat);
        trunk.position.set(x, h / 2, z);
        scene.add(trunk);

        const leafH = 3 + Math.random() * 3;
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(2 + Math.random(), leafH, 6), leafMat);
        leaf.position.set(x, h + leafH / 2 - 0.5, z);
        scene.add(leaf);
    });
}

function buildHouses() {
    houseMeshes.forEach(m => scene.remove(m));
    houseMeshes = [];

    state.houses.forEach((h, i) => {
        const hue = [0x8b5e3c, 0x7a5230, 0x6b4828, 0x9c6b40, 0x7c5535, 0x8a6040][i % 6];
        const wallMat = new THREE.MeshLambertMaterial({ color: hue });
        const roofMat = new THREE.MeshLambertMaterial({ color: 0x3a2010 });

        // h.x and h.y are the pad centre in 2D pixel space
        const cx = worldX(h.x);
        const cz = worldZ(h.y);

        const walls = new THREE.Mesh(
            new THREE.BoxGeometry(HOUSE_W, HOUSE_H, HOUSE_D), wallMat
        );
        walls.position.set(cx, HOUSE_H / 2, cz);
        scene.add(walls);
        houseMeshes.push(walls);

        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(HOUSE_W * 0.75, HOUSE_H * 0.6, 4), roofMat
        );
        roof.position.set(cx, HOUSE_H + HOUSE_H * 0.3, cz);
        roof.rotation.y = Math.PI / 4;
        scene.add(roof);
        houseMeshes.push(roof);

        // Door marker at the "doorX/doorY" point on the pad rim
        const doorMat = new THREE.MeshLambertMaterial({ color: 0xccaa55 });
        const door = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3.0, 0.25), doorMat);
        door.position.set(worldX(h.doorX), 1.5, worldZ(h.doorY));
        scene.add(door);
        houseMeshes.push(door);
    });
}

// ── Gator meshes ───────────────────────────────────────────────────────────
function getOrCreateGatorMesh(gator) {
    if (gatorMeshes.has(gator.id)) return gatorMeshes.get(gator.id);

    const group = new THREE.Group();

    // Body — elongated box (alligator body)
    const bodyMat = new THREE.MeshLambertMaterial({
        color: state.deadIds.has(gator.id) ? 0x555555 : 0x4a7a30
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 3.0), bodyMat);
    body.position.y = 0.5;
    group.add(body);

    // Head — smaller box on front
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 1.2), bodyMat);
    head.position.set(0, 0.5, -1.8);
    group.add(head);

    // Snout — flat protruding box
    const snoutMat = new THREE.MeshLambertMaterial({ color: 0x3d6025 });
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.8), snoutMat);
    snout.position.set(0, 0.38, -2.55);
    group.add(snout);

    // Eyes — small spheres
    const eyeMat = new THREE.MeshLambertMaterial({ color: 0xffdd00 });
    [-0.28, 0.28].forEach(ex => {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), eyeMat);
        eye.position.set(ex, 0.78, -1.75);
        group.add(eye);
    });

    // Tail — tapered box
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 1.4), bodyMat);
    tail.position.set(0, 0.42, 1.7);
    group.add(tail);

    // Name label — flat plane with distinct color per gator
    const colors = [0xff6644,0x44aaff,0xffcc22,0xaa66ff,0x44ffaa,0xff44aa,0x88ffcc,0xffaa44,0x66bbff];
    const labelMat = new THREE.MeshLambertMaterial({ color: colors[gator.id % colors.length] });
    const label = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 0.08), labelMat);
    label.position.set(0, 1.4, -1.5);
    group.add(label);

    scene.add(group);
    gatorMeshes.set(gator.id, group);
    return group;
}

function syncGatorMeshes() {
    const seen = new Set();
    state.gators.forEach(g => {
        const group = getOrCreateGatorMesh(g);
        seen.add(g.id);

        const gx = worldX(g.x);
        const gz = worldZ(g.y);
        group.position.set(gx, 0, gz);

        // Face direction of movement using targetX/targetY
        const mdx = (g.targetX ?? g.x) - g.x;
        const mdy = (g.targetY ?? g.y) - g.y;
        if (Math.abs(mdx) + Math.abs(mdy) > 4) {
            group.rotation.y = Math.atan2(mdx, mdy);
        }

        // Dim dead gators
        if (state.deadIds.has(g.id)) {
            group.children.forEach(c => {
                if (c.material) c.material.opacity = 0.35;
                if (c.material) c.material.transparent = true;
            });
            group.position.y = -0.3;
        }
    });

    // Remove meshes for gators that no longer exist
    gatorMeshes.forEach((mesh, id) => {
        if (!seen.has(id)) {
            scene.remove(mesh);
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

    // Update POV label
    const label = document.getElementById('pov-gator-label');
    if (label) label.textContent = `🐊 ${gator.name ?? 'Gator'}`;

    const gx = worldX(gator.x);
    const gz = worldZ(gator.y);

    camera.position.set(gx, CAM_H, gz);

    // Face toward the gator's movement target; fall back to forward (+Z) if standing still
    const dx = (gator.targetX ?? gator.x) - gator.x;
    const dy = (gator.targetY ?? gator.y) - gator.y;
    const moveDist = Math.sqrt(dx * dx + dy * dy);

    let lookX, lookZ;
    if (moveDist > 4) {
        lookX = gx + worldX(dx) * 20;
        lookZ = gz + worldZ(dy) * 20;
    } else {
        // Standing still — face toward swamp centre
        lookX = worldX(gator.x + (600 - gator.x) * 0.3);
        lookZ = worldZ(gator.y + (400 - gator.y) * 0.3);
    }
    camera.lookAt(lookX, CAM_H * 0.6, lookZ);

    // Hide the active gator's own mesh so we don't see our own body
    gatorMeshes.forEach((mesh, id) => {
        mesh.visible = (id !== gator.id);
    });
}

// ── Render loop ────────────────────────────────────────────────────────────
function renderLoop() {
    animFrameId = requestAnimationFrame(renderLoop);

    if (!state.gators.length) { renderer.render(scene, camera); return; }

    // Rebuild houses once after they're available
    if (state.houses.length > 0 && houseMeshes.length === 0) buildHouses();

    syncGatorMeshes();
    updateCamera();
    renderer.render(scene, camera);
}

// ── Public API ─────────────────────────────────────────────────────────────
export function init3D(container) {
    if (initialized) return;
    initialized = true;
    activeGatorIndex = 0;

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.insertBefore(renderer.domElement, container.firstChild);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 300);

    buildScene();

    window.addEventListener('resize', onResize);
    renderLoop();
}

export function destroy3D() {
    if (!initialized) return;
    initialized = false;

    cancelAnimationFrame(animFrameId);
    window.removeEventListener('resize', onResize);

    gatorMeshes.forEach(m => scene.remove(m));
    gatorMeshes.clear();
    houseMeshes.forEach(m => scene.remove(m));
    houseMeshes = [];

    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    renderer = null;
    scene = null;
    camera = null;
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
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
