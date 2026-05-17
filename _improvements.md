# SwampOfSalem — 3D Visual Upgrade Prompt

## Context for the AI

You are helping upgrade the visual rendering layer of an existing browser-based social simulation game called **SwampOfSalem**. The game simulates a cul-de-sac of anthropomorphic alligators who walk around, have AI-driven conversations, form relationships, and vote to execute a hidden murderer among them (a social deduction game in the spirit of *Town of Salem*).

### Current Tech Stack
- **Frontend**: Blazor WebAssembly (.NET 10) + vanilla ES modules in `wwwroot/js/`
- **Backend**: ASP.NET Core (.NET 10) with SignalR and Semantic Kernel AI integration
- **Rendering**: DOM-based. Each alligator is an HTML `<div>` containing an inline SVG sprite, absolutely positioned on a `<div id="world">` canvas. No WebGL, no canvas element, no 3D.
- **Game logic**: C# in `SwampOfSalem.AppLogic` — constants, personality system, relationship math. These are serialised to JSON at startup and consumed by `gameConfig.js` as `window.GameConfig`.
- **Appearance system**: Each gator has a `p.appearance` object with: `skinTone` (hex, one of 10 green variants), `hatStyle` (one of: `tophat`, `sunglasses`, `wig`, `bowtie`, `crown`, `bandana`, `hornplate`, `spines`, `monocle`, `crest`), `hatColor` (random bright HSL hex), `shirtColor` (muted green hex), `headSize`, `bodyHeight`, `legLength`, `armAngle`.
- **Names**: Chomps, Bubba, Gnarla, Dredge, Murka, Fang, Gully, Hiss, Ivy, Jaw
- **Game phases**: DAY, NIGHT, DAWN, DEBATE, VOTE, EXECUTE, OVER — each with distinct visual states

### Key Files You Will Modify
- `SwampOfSalem.Web/wwwroot/js/helpers.js` — contains `buildFigureSVG(p)` (the SVG sprite builder) and `randomAppearance(index)` (appearance data factory). **Replace `buildFigureSVG` with a Babylon.js mesh factory.**
- `SwampOfSalem.Web/wwwroot/js/rendering.js` — contains `renderGator(p)` and `renderAllGators()` which position gators via `el.style.left/top`. **Replace with Babylon.js scene updates.**
- `SwampOfSalem.Web/wwwroot/index.html` — currently loads JS modules. **Add Babylon.js script tag and replace `<div id="world">` with a `<canvas id="renderCanvas">`.**
- `SwampOfSalem.Web/wwwroot/js/simulation.js` — calls `renderAllGators()` each tick. This call signature must remain unchanged.
- `SwampOfSalem.Web/wwwroot/js/gator.js` — the `createGator()` factory. The `p.appearance` object should be extended to include Babylon mesh color values. Do not break existing fields.

### Invariants — Do NOT Change
- `state.gators[]` array structure and all Person object fields (`p.id`, `p.x`, `p.y`, `p.activity`, `p.talkingTo`, `p.indoors`, `p.message`, `p.name`, `p.appearance`, etc.)
- `window.GameConfig` injection pipeline and `gameConfig.js` exports
- All C# projects (`AppLogic`, `Shared`, `SK`, `Gators`) — no C# changes required
- SignalR hub and all API endpoints
- Chat bubble DOM elements (`#bubble-{id}`) — these are HTML overlays on top of the canvas and must continue to work
- The detail panel (`#gator-panel`) sidebar — pure HTML, unaffected
- `state.bubbles`, `state.thoughts`, `state.talkLines` maps
- The `PHASE` state machine and all phase transition logic in `phases.js`

---

## Goal

Replace the current flat 2D SVG sprite rendering with a **Babylon.js 3D scene** rendered on a `<canvas>` element. The alligators must:

1. **Stand upright and bipedal** — like people, not like swimming crocodiles
2. **Walk with an animated gait** — legs swing, arms swing opposite, torso bobs — driven entirely by `Math.sin()` in code, no external animation files
3. **Wear clothes** — visible shirt, pants, shoes, belt, and a hat matching their `hatStyle`
4. **Stand out clearly from the floor** — real-time shadows, strong lighting contrast, vivid colors
5. **Be built entirely from Babylon.js primitive meshes** — no `.glb`, no `.fbx`, no Mixamo, no external 3D assets of any kind
6. **Be vibrant and saturated** — post-processing bloom, color grading, high-saturation materials

---

## Step-by-Step Implementation Instructions

### Step 1 — Add Babylon.js to the Project

In `SwampOfSalem.Web/wwwroot/index.html`, add before the closing `</body>` tag:

```html
<script src="https://cdn.babylonjs.com/babylon.js"></script>
<script src="https://cdn.babylonjs.com/materialsLibrary/babylonjs.materials.min.js"></script>
<script src="https://cdn.babylonjs.com/postProcessesLibrary/babylonjs.postProcess.min.js"></script>
```

Replace `<div id="world" ...>` with:

```html
<canvas id="renderCanvas" style="width:100%;height:100%;position:absolute;top:0;left:0;touch-action:none;"></canvas>
<div id="world-overlay" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;">
  <!-- Chat bubbles, dead markers, and private enclosures are appended here -->
</div>
```

Update all `document.getElementById('world')` references in `rendering.js` and `simulation.js` to use `document.getElementById('world-overlay')` for DOM overlay appends only.

---

### Step 2 — Create `babylonScene.js`

Create a new file `SwampOfSalem.Web/wwwroot/js/babylonScene.js`. This module owns the Babylon engine, scene, camera, lights, ground, and the mesh registry. It exports:

```js
export function initBabylonScene()   // Creates engine, scene, camera, lights, ground, water, post-processing
export function getBabylonScene()    // Returns { engine, scene }
export function getGatorMeshes()     // Returns Map<gatorId, { root, parts, walkPhase }>
export function buildGatorMesh(p, scene)  // Creates all meshes for one gator, returns root TransformNode
export function disposeGatorMesh(id)      // Removes a gator's meshes from the scene
```

#### `initBabylonScene()` — Scene Setup

```js
const canvas  = document.getElementById('renderCanvas');
const engine  = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene   = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.05, 0.18, 0.08, 1); // Deep swamp green-black sky
```

**Camera**: Use `ArcRotateCamera` for an isometric-ish top-down perspective:
```js
const camera = new BABYLON.ArcRotateCamera('cam', -Math.PI/2, Math.PI/3.5, 28, BABYLON.Vector3.Zero(), scene);
camera.lowerRadiusLimit = 10;
camera.upperRadiusLimit = 60;
camera.attachControl(canvas, true);
```

**Lighting**:
```js
// Warm sunlight (day)
const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -2, -1), scene);
sun.position = new BABYLON.Vector3(20, 40, 20);
sun.intensity = 1.4;
sun.diffuse   = new BABYLON.Color3(1.0, 0.95, 0.7);   // warm yellow

// Ambient fill — sky is warm green, ground is dark mud
const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
hemi.intensity   = 0.5;
hemi.diffuse     = new BABYLON.Color3(0.5, 0.9, 0.4);  // swamp green sky
hemi.groundColor = new BABYLON.Color3(0.1, 0.2, 0.05); // dark mud below
```

**Shadow generator**:
```js
const shadowGen = new BABYLON.ShadowGenerator(1024, sun);
shadowGen.useBlurExponentialShadowMap = true;
shadowGen.blurKernel = 16;
// Register each gator root mesh as a shadow caster after creation:
// shadowGen.addShadowCaster(rootMesh, true);
```

**Ground** — the swamp floor:
```js
const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 60, height: 60, subdivisions: 4 }, scene);
const groundMat = new BABYLON.StandardMaterial('groundMat', scene);
groundMat.diffuseColor  = new BABYLON.Color3(0.12, 0.32, 0.10);  // murky green
groundMat.specularColor = new BABYLON.Color3(0, 0, 0);
ground.material = groundMat;
ground.receiveShadows = true;
```

**Water surface** (using Babylon Materials Library `WaterMaterial`):
```js
const waterMesh = BABYLON.MeshBuilder.CreateGround('water', { width: 60, height: 60 }, scene);
waterMesh.position.y = 0.02;  // just above ground
const water = new BABYLON.WaterMaterial('water', scene, new BABYLON.Vector2(512, 512));
water.bumpHeight      = 0.08;
water.windForce       = 4;
water.windDirection   = new BABYLON.Vector2(1, 1);
water.waveHeight      = 0.05;
water.waveLength      = 0.1;
water.colorBlendFactor = 0.2;
water.waterColor      = new BABYLON.Color3(0.05, 0.28, 0.12);  // deep swamp teal-green
water.addToRenderList(ground);
waterMesh.material = water;
```

**Lily pads** — scatter 20–30 flat discs:
```js
for (let i = 0; i < 25; i++) {
	const pad = BABYLON.MeshBuilder.CreateDisc(`pad${i}`, { radius: 0.4 + Math.random()*0.5, tessellation: 16 }, scene);
	pad.rotation.x = Math.PI / 2;
	pad.position.set((Math.random()-0.5)*55, 0.04, (Math.random()-0.5)*55);
	const padMat = new BABYLON.StandardMaterial(`padMat${i}`, scene);
	padMat.diffuseColor = new BABYLON.Color3(0.1 + Math.random()*0.2, 0.5 + Math.random()*0.3, 0.1);
	padMat.specularColor = new BABYLON.Color3(0,0,0);
	pad.material = padMat;
}
```

**Post-processing pipeline** (vivid, bloomy, saturated):
```js
const pipeline = new BABYLON.DefaultRenderingPipeline('pipeline', true, scene, [camera]);
pipeline.bloomEnabled      = true;
pipeline.bloomThreshold    = 0.3;
pipeline.bloomWeight       = 0.6;
pipeline.bloomKernel       = 64;
pipeline.bloomScale        = 0.5;
pipeline.imageProcessingEnabled = true;
pipeline.imageProcessing.contrast   = 1.3;
pipeline.imageProcessing.exposure   = 1.1;
pipeline.imageProcessing.colorGradingEnabled = false;
pipeline.imageProcessing.vignetteEnabled = true;
pipeline.imageProcessing.vignetteWeight = 2.0;
// Boost saturation via color curves
const curves = new BABYLON.ColorCurves();
curves.globalSaturation = 60;   // push saturation hard
curves.globalHue        = 0;
curves.shadowsHue       = 5;    // cool shadows
curves.highlightsHue    = -5;   // warm highlights
pipeline.imageProcessing.colorCurves = curves;
pipeline.imageProcessing.colorCurvesEnabled = true;
```

**Render loop**:
```js
engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
```

---

### Step 3 — Build a Gator Mesh: `buildGatorMesh(p, scene)`

Each gator is a hierarchy of Babylon primitives. All measurements are in Babylon world units. Map the current `GATOR_SIZE` (pixels) to world units at a ratio of approximately `1 world unit = 10 pixels`.

Parse appearance colors from hex strings using `BABYLON.Color3.FromHexString(hex)`.

#### Mesh Hierarchy

```
root (TransformNode — position tracks p.x, p.z)
├── pelvis (TransformNode — pivot for leg rotation)
│   ├── upperLegL (Cylinder, radius 0.12, height 0.45)
│   │   └── lowerLegL (Cylinder, radius 0.10, height 0.40)
│   │       └── footL (Box, 0.28 × 0.12 × 0.18)
│   ├── upperLegR (mirror of L)
│   │   └── lowerLegR
│   │       └── footR
│   ├── pantsL (Cylinder slightly larger than upperLegL, same pivot, clothing layer)
│   └── pantsR
├── torso (Box, 0.55 wide × 0.65 tall × 0.35 deep)
│   ├── shirt (Box, 0.60 wide × 0.67 tall × 0.38 deep — slightly larger than torso, same position)
│   ├── belt (Box, 0.62 wide × 0.07 tall × 0.40 deep, positioned at waist)
│   ├── upperArmL (Cylinder, radius 0.10, height 0.38)
│   │   └── lowerArmL (Cylinder, radius 0.09, height 0.34)
│   ├── upperArmR (mirror of L)
│   │   └── lowerArmR
│   └── neck (Cylinder, radius 0.14, height 0.16)
│       └── head (Sphere, diameter 0.52)
│           ├── snout (Box, 0.32 wide × 0.20 tall × 0.28 deep, forward offset)
│           ├── eyeL (Sphere, diameter 0.14, yellow emissive)
│           │   └── pupilL (Sphere, diameter 0.07, black)
│           ├── eyeR (mirror of L)
│           └── hat (see HAT_STYLES below)
```

#### Material Colors

| Part | Color Source |
|---|---|
| Body (torso, neck, head, snout, arms, legs) | `BABYLON.Color3.FromHexString(p.appearance.skinTone)` |
| Shirt | `BABYLON.Color3.FromHexString(p.appearance.shirtColor)` — slightly brightened (`+0.15` on each channel) |
| Pants | Complementary dark color: `new BABYLON.Color3(0.15, 0.10, 0.05)` (dark brown) or gator-specific |
| Belt | `new BABYLON.Color3(0.20, 0.12, 0.04)` (leather brown) |
| Shoes / feet | `new BABYLON.Color3(0.10, 0.08, 0.04)` |
| Eyes | Yellow emissive: `new BABYLON.Color3(0.9, 0.85, 0.0)`, `emissiveColor` set for glow |
| Pupils | `new BABYLON.Color3(0.05, 0.05, 0.05)` |
| Hat | `BABYLON.Color3.FromHexString(p.appearance.hatColor)` — use `emissiveColor` at 30% intensity so hats glow slightly |

Use **PBR materials** (`PBRMaterial`) for all body and clothing parts:
```js
const mat = new BABYLON.PBRMaterial('torsoMat_' + p.id, scene);
mat.albedoColor  = skinColor;
mat.metallic     = 0.0;
mat.roughness    = 0.85;  // scales look rough/matte
```

For eyes, use `StandardMaterial` with `emissiveColor` for the glowing yellow effect.

#### Hat Mesh Implementations

Implement each `hatStyle` as a sub-function. All hats are parented to the `head` mesh and positioned above it (positive Y offset of ~0.3).

- **`tophat`**: A `MeshBuilder.CreateCylinder` with `diameterTop: 0.36, diameterBottom: 0.36, height: 0.32` (brim) stacked under a `CreateCylinder` with `diameterTop: 0.30, diameterBottom: 0.30, height: 0.36` (crown). Color: `hatColor`.
- **`crown`**: `CreateCylinder` base ring + 5× `CreateBox` spike points arranged in a circle. Color: `hatColor` with gold sheen (`metallic: 0.8, roughness: 0.2`).
- **`sunglasses`**: Two flat `CreateCylinder` discs (very thin) positioned over the eye area. Color: near-black with slight blue tint.
- **`wig`**: A `CreateSphere` scaled to `(0.7, 0.5, 0.7)` slightly above and wider than the head, with `hatColor` and high roughness.
- **`bowtie`**: Two `CreateBox` shapes scaled as triangular wedges, parented to the neck/chest area (not the head). Color: `hatColor`.
- **`bandana`**: A thin `CreateCylinder` ring around the head forehead area. Color: `hatColor`.
- **`hornplate`**: Three `CreateCylinder` cones (`diameterTop: 0, diameterBottom: 0.08`) arranged in a row on top of head. Color: `hatColor`.
- **`spines`**: Four `CreateCylinder` cones of varying heights arranged along the top of the head. Color: `hatColor`.
- **`monocle`**: A `CreateTorus` (thin ring) parented over one eye position. Color: `hatColor` with `metallic: 0.9`.
- **`crest`**: A flat `CreateRibbon` or three overlapping `CreatePlane` meshes fanned out like feathers on top of the head. Color: `hatColor`.

---

### Step 4 — The Walk Cycle Animation

In `babylonScene.js`, export:

```js
export function updateGatorAnimation(p, deltaTimeMs)
```

This is called from `renderGator(p)` each frame. It reads `p.activity` and `p.x`/`p.y` velocity to determine walk vs. idle state.

#### Walk Cycle Formula

Store per-gator animation state in `getGatorMeshes().get(p.id)`:
```js
{
	walkPhase: 0,       // current sine phase in radians
	walkSpeed: 0,       // current movement speed (world units/sec)
	facingAngle: 0,     // current Y rotation of root mesh
}
```

Each call to `updateGatorAnimation`:

```js
const anim   = gatorMeshes.get(p.id);
const dt     = deltaTimeMs / 1000;  // seconds
const isWalking = p.activity === 'moving' && anim.walkSpeed > 0.01;

// Advance walk phase
if (isWalking) {
	anim.walkPhase += dt * 6.0;  // ~1 full cycle per second at normal walk
} else {
	anim.walkPhase *= 0.85;      // decay to idle smoothly
}

const s  = Math.sin(anim.walkPhase);
const s2 = Math.sin(anim.walkPhase + Math.PI);  // opposite phase

const parts = anim.parts;

// Upper legs — swing ±25° forward/back
parts.upperLegL.rotation.x =  s  * 0.44;  // 0.44 rad ≈ 25°
parts.upperLegR.rotation.x =  s2 * 0.44;

// Lower legs — bend on backswing only (natural knee bend)
parts.lowerLegL.rotation.x = Math.max(0, -s)  * 0.35;
parts.lowerLegR.rotation.x = Math.max(0, -s2) * 0.35;

// Arms — swing opposite to same-side leg
parts.upperArmL.rotation.x = -s  * 0.30;
parts.upperArmR.rotation.x = -s2 * 0.30;

// Torso bob — small vertical oscillation
parts.torso.position.y = 0.65 + Math.abs(s) * 0.04;

// Torso sway — slight side tilt
parts.torso.rotation.z = s * 0.04;

// Head counter-sway (stabilises gaze)
parts.head.rotation.z = -s * 0.02;

// Face direction of travel
if (anim.walkSpeed > 0.05) {
	parts.root.rotation.y = anim.facingAngle;
}
```

#### Idle Breathing

When not walking, add a gentle breathing cycle:
```js
const breathPhase = Date.now() / 1000 * 0.8;  // slow
parts.torso.scaling.x = 1.0 + Math.sin(breathPhase) * 0.015;
parts.torso.scaling.z = 1.0 + Math.sin(breathPhase) * 0.010;
```

---

### Step 5 — Update `rendering.js`

Replace the body of `renderGator(p)` to call into `babylonScene.js` instead of manipulating DOM element positions:

```js
import { updateGatorAnimation, getGatorMeshes } from './babylonScene.js';

export function renderGator(p) {
	const meshData = getGatorMeshes().get(p.id);
	if (!meshData) return;

	const isDead    = state.deadIds.has(p.id);
	const isPrivate = p.indoors && (p.activity === 'hosting' || p.activity === 'visiting');

	if (isDead) {
		meshData.parts.root.setEnabled(false);
		// Remove chat bubbles as before
		const bubble = state.bubbles.get(p.id);
		if (bubble) { bubble.remove(); state.bubbles.delete(p.id); }
		p.message = null;
		p.thought = null;
		return;
	}

	// Convert 2D simulation coordinates (pixels) to Babylon world units
	// The simulation uses p.x, p.y in pixel space on a ~1200×800 stage.
	// Map to Babylon's XZ plane: center the world at (0,0), scale by 1/20.
	const { W, H } = stageBounds();
	const bx = (p.x / W - 0.5) * 50;   // -25 to +25 world units
	const bz = (p.y / H - 0.5) * 35;   // -17.5 to +17.5 world units

	meshData.parts.root.position.x = bx;
	meshData.parts.root.position.z = bz;
	meshData.parts.root.position.y = 0;  // standing on ground

	// Compute velocity for walk speed
	const dx = bx - (meshData.lastBx ?? bx);
	const dz = bz - (meshData.lastBz ?? bz);
	meshData.walkSpeed = Math.sqrt(dx*dx + dz*dz) / (TICK_MS / 1000);
	if (meshData.walkSpeed > 0.01) {
		meshData.facingAngle = Math.atan2(dx, dz);
	}
	meshData.lastBx = bx;
	meshData.lastBz = bz;

	// Animate walk cycle
	updateGatorAnimation(p, TICK_MS);

	// Chat bubbles — keep existing DOM overlay logic, but re-project 3D position to screen
	// Use scene.activeCamera and BABYLON.Vector3.Project() to get screen coords for bubble placement
	_updateBubbleScreenPosition(p, meshData.parts.root.position);

	// Handle private/indoors visibility
	meshData.parts.root.setEnabled(!p.indoors || isPrivate);

	_updateEnclosure(p);
}
```

Add `_updateBubbleScreenPosition(p, worldPos)` to project the 3D gator head position to 2D screen space for bubble placement:
```js
function _updateBubbleScreenPosition(p, worldPos) {
	const { scene, engine } = getBabylonScene();
	const headWorldPos = worldPos.clone();
	headWorldPos.y += 2.0;  // offset to above the head
	const screenPos = BABYLON.Vector3.Project(
		headWorldPos,
		BABYLON.Matrix.Identity(),
		scene.getTransformMatrix(),
		scene.activeCamera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
	);
	const bubble = state.bubbles.get(p.id);
	if (bubble) {
		bubble.style.left = `${screenPos.x - 40}px`;
		bubble.style.top  = `${screenPos.y - 60}px`;
	}
}
```

---

### Step 6 — Update `simulation.js` Spawn Logic

In `spawnGators()` (or equivalent), after creating each gator with `createGator()`, call:
```js
import { buildGatorMesh, getBabylonScene } from './babylonScene.js';
const { scene } = getBabylonScene();
buildGatorMesh(p, scene);
```

On game reset, call `disposeGatorMesh(id)` for each existing gator before re-spawning.

---

### Step 7 — Day/Night Cycle Visual Transition

The existing `PHASE` state machine in `phases.js` already transitions between `DAY`, `NIGHT`, `DAWN`, etc. Hook into these transitions to animate the Babylon scene lighting:

```js
export function applyPhaseToScene(phase) {
	const { scene } = getBabylonScene();
	const sun  = scene.getLightByName('sun');
	const hemi = scene.getLightByName('hemi');

	switch(phase) {
		case PHASE.DAY:
			sun.diffuse   = new BABYLON.Color3(1.0, 0.95, 0.7);
			sun.intensity = 1.4;
			hemi.intensity = 0.5;
			scene.clearColor = new BABYLON.Color4(0.35, 0.65, 0.90, 1);  // blue daytime sky
			break;
		case PHASE.NIGHT:
			sun.diffuse   = new BABYLON.Color3(0.2, 0.25, 0.5);
			sun.intensity = 0.3;
			hemi.intensity = 0.15;
			scene.clearColor = new BABYLON.Color4(0.02, 0.03, 0.10, 1);  // dark night sky
			break;
		case PHASE.DAWN:
			sun.diffuse   = new BABYLON.Color3(1.0, 0.5, 0.2);
			sun.intensity = 0.7;
			hemi.intensity = 0.3;
			scene.clearColor = new BABYLON.Color4(0.7, 0.3, 0.1, 1);    // orange dawn
			break;
		case PHASE.DEBATE:
		case PHASE.VOTE:
		case PHASE.EXECUTE:
			sun.diffuse   = new BABYLON.Color3(0.9, 0.5, 0.1);
			sun.intensity = 1.0;
			scene.clearColor = new BABYLON.Color4(0.6, 0.2, 0.05, 1);   // tense red-orange
			break;
	}
}
```

Call `applyPhaseToScene(state.gamePhase)` inside the existing `triggerNightfall()`, `triggerDawn()`, `triggerDebate()`, and `triggerVote()` functions in `phases.js`.

---

### Step 8 — Houses in 3D

Replace the existing SVG/DOM culde-sac houses with simple 3D geometry. The house positions come from `state.houses[]` (each has `x`, `y` in pixel space). Map these to Babylon XZ coordinates using the same scale formula as gators.

For each house:
```js
// Walls
const house = BABYLON.MeshBuilder.CreateBox(`house${i}`, { width: 3, depth: 3, height: 2.5 }, scene);
house.position.set(bx, 1.25, bz);
const houseMat = new BABYLON.PBRMaterial(`houseMat${i}`, scene);
houseMat.albedoColor = BABYLON.Color3.FromHexString(houseColors[i].wall);
house.material = houseMat;
house.receiveShadows = true;
shadowGen.addShadowCaster(house);

// Roof (pyramid)
const roof = BABYLON.MeshBuilder.CreateCylinder(`roof${i}`, { diameterTop: 0, diameterBottom: 4.4, height: 1.8, tessellation: 4 }, scene);
roof.rotation.y = Math.PI / 4;
roof.position.set(bx, 2.5 + 0.9, bz);
const roofMat = new BABYLON.PBRMaterial(`roofMat${i}`, scene);
roofMat.albedoColor = BABYLON.Color3.FromHexString(houseColors[i].roof);
roof.material = roofMat;

// Door glow (point light inside each house for cosy effect)
const doorLight = new BABYLON.PointLight(`doorLight${i}`, new BABYLON.Vector3(bx, 1.0, bz + 1.5), scene);
doorLight.diffuse    = new BABYLON.Color3(1.0, 0.8, 0.3);
doorLight.intensity  = 0.8;
doorLight.range      = 4;
```

---

## Summary of New Files

| File | Purpose |
|---|---|
| `wwwroot/js/babylonScene.js` | **New** — Babylon engine, scene, camera, lights, water, lily pads, post-processing, shadow generator, gator mesh factory, walk animation |
| `wwwroot/js/rendering.js` | **Modified** — `renderGator` calls `updateGatorAnimation`, projects to screen for bubbles; removes all `el.style.left/top` gator positioning |
| `wwwroot/js/simulation.js` | **Modified** — calls `buildGatorMesh(p, scene)` after each `createGator()` |
| `wwwroot/js/phases.js` | **Modified** — calls `applyPhaseToScene()` in phase transitions |
| `wwwroot/index.html` | **Modified** — adds Babylon CDN scripts, replaces `#world` div with `<canvas>` + overlay div |

## Files That Do NOT Change

`gator.js`, `helpers.js` (except `buildFigureSVG` can be left as dead code or removed), `state.js`, `agentQueue.js`, `gameConfig.js`, all C# projects.

---

## Checklist for the Implementing AI

- [ ] Babylon.js CDN scripts added to `index.html` before other scripts
- [ ] `<canvas id="renderCanvas">` replaces `<div id="world">`
- [ ] `<div id="world-overlay">` added as sibling for DOM chat bubbles
- [ ] `babylonScene.js` created with engine, scene, camera, sun, hemi, shadowGen, ground, water, lily pads, post-processing pipeline
- [ ] `buildGatorMesh(p, scene)` builds full bipedal hierarchy from primitives with PBR materials
- [ ] All 10 hat styles implemented as primitive meshes
- [ ] Walk cycle uses `Math.sin(walkPhase)` for legs, arms, torso bob — no external animation files
- [ ] `renderGator(p)` maps `p.x`/`p.y` pixel coords to Babylon XZ world coords
- [ ] Chat bubbles repositioned using `BABYLON.Vector3.Project()` screen projection
- [ ] Houses built as 3D box+roof meshes at mapped coordinates
- [ ] `applyPhaseToScene(phase)` called on all phase transitions
- [ ] Bloom post-processing enabled and color saturation boosted via `ColorCurves`
- [ ] Shadows cast by all gators and houses onto the ground plane
- [ ] No external `.glb`, `.fbx`, `.png`, or Mixamo assets used anywhere
