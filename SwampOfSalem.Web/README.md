# 🐊 Swamp of Salem — Complete Project Reference

> *A social-deduction simulation where AI-driven alligators gossip, scheme, and bite each other in a procedurally generated bayou — with a first-person Babylon.js 3-D view.*

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Project Summary](#2-project-summary)
3. [Rules of the Game](#3-rules-of-the-game)
4. [Game Instructions](#4-game-instructions)
5. [Technical Architecture](#5-technical-architecture)
   - 5.1 [Solution Layout](#51-solution-layout)
   - 5.2 [Technology Stack](#52-technology-stack)
   - 5.3 [Data Flow — End-to-End Request](#53-data-flow--end-to-end-request)
   - 5.4 [Game Loop & Phase Machine](#54-game-loop--phase-machine)
   - 5.5 [Gator AI & Social Simulation](#55-gator-ai--social-simulation)
   - 5.6 [Frontend Module Map](#56-frontend-module-map)
   - 5.7 [API Reference](#57-api-reference)
   - 5.8 [3-D POV Renderer (Babylon.js)](#58-3-d-pov-renderer-babylonjs)
   - 5.9 [Key Game Constants](#59-key-game-constants)
   - 5.10 [Configuration & Secrets](#510-configuration--secrets)
   - 5.11 [A Gator's Thought Process: How the Game Calls Code](#511-a-gators-thought-process-how-the-game-calls-code)
   - 5.12 [Gator Memory: How It Works and Influences Decisions](#512-gator-memory-how-it-works-and-influences-decisions)
   - 5.13 [How Topics, Phrases, and Dialog Are Chosen](#513-how-topics-phrases-and-dialog-are-chosen)
6. [Project History](#6-project-history)

---

## 1. Executive Summary

**Swamp of Salem** is a browser-based social-deduction game inspired by *Town of Salem* and *The Sims*. A small colony of bipedal alligators lives on an island in a bayou. Hidden among them is **at least one murderer**. Over a full day–night–debate–vote cycle the townsgators must identify and execute the killer before they are all bitten to death.

What makes it unique:

- Every conversation is **generated live by an LLM** (or a fast rule-based fallback). Gators remember what was said, who lied, and who witnessed what.
- A **2-D sprite simulation** runs at ~2.2 s/tick driving autonomous wandering, proximity conversations, fear/suspicion propagation, and phase transitions.
- An optional **first-person 3-D view** (Babylon.js / WebGPU) lets the player inhabit any gator's body, walk around the island, click on neighbours to talk or attack, and watch the drama unfold from street level.
- The entire social graph (relations, suspicions, fear memories) is persistent across turns and feeds directly into voting and execution decisions.

---

## 2. Project Summary

| Attribute | Value |
|-----------|-------|
| **Name** | Swamp of Salem |
| **Type** | Browser game + ASP.NET Core API |
| **Target framework** | .NET 10 |
| **Frontend** | Vanilla ES Modules (no bundler) |
| **3-D engine** | Babylon.js 7 (WebGPU / WebGL2 fallback) |
| **AI backend** | Semantic Kernel → OpenAI or Azure OpenAI |
| **Offline mode** | Rule-based dialog, no LLM required |
| **Default gator count** | 2 (configurable up to ~12) |
| **Repository** | `sth-garage/SwampOfSalem` (branch `offline`) |

### What it looks like

```
┌─────────────────────────────────────────────────────────┐
│  2-D overhead canvas (SVG sprites, fog-of-war labels)    │
│                                                          │
│   🐊 Rex ──── 💬 ──── 🐊 Dot                           │
│         "Did you hear                                    │
│          about the biting?"                              │
│                                                          │
│   🏚 House 1      🏚 House 2      🏚 House 3            │
│                                                          │
│   [Phase: DAY  ██████░░░░ 5:12 remaining]               │
└─────────────────────────────────────────────────────────┘
		 ▼  Press [3-D View]
┌─────────────────────────────────────────────────────────┐
│  Babylon.js POV — you ARE a gator, walking around       │
│  Names float above other gators' heads                   │
│  WASD to move · Right-drag to look · Click to interact   │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Rules of the Game

### 3.1 Roles

| Role | Count | Win condition |
|------|-------|---------------|
| **Murderer** 🔪 | 1 (hidden) | Bite all Towngators to death before being executed |
| **Towngator** 🐊 | Remaining | Survive and correctly vote to execute the Murderer |

> Roles are assigned secretly at game start. No gator knows who the Murderer is except the Murderer themselves.

### 3.2 Phase Cycle

```
   ┌──────────────────────────────────────────────────────┐
   │                                                      │
   ▼                                                      │
 DAY (~5 min)                                            │
   Gators wander, chat, form opinions.                   │
   Murderer secretly picks a target.                      │
   ▼                                                      │
 NIGHT (~4 s)                                            │
   Screen goes dark.                                     │
   Murderer bites their chosen victim.                    │
   ▼                                                      │
 DAWN (~13 s)                                            │
   Bite damage is revealed publicly.                     │
   Witnesses report what they saw.                       │
   ▼                                                      │
 DEBATE (~2 min)                                         │
   Gators take turns accusing each other.                │
   Fear & suspicion scores drive who speaks & what.      │
   ▼                                                      │
 VOTE (instant)                                          │
   Each gator casts a vote based on highest suspicion.   │
   ▼                                                      │
 EXECUTE (instant)                                       │
   Gator with most votes is removed from the game.       │
   ──────────────────────────────────────────────────────┘
   Loop back to DAY unless win condition met.
```

### 3.3 Win Conditions

| Outcome | Trigger |
|---------|---------|
| **Towngators win** | The Murderer is executed during Vote/Execute |
| **Murderer wins** | All Towngators are dead (bitten to death) |
| **Stalemate** | Only one Towngator remains and the Murderer is still alive — Murderer wins on the next night |

### 3.4 Biting Mechanics

- Any gator (including the player) can bite another gator at any time during the Day.
- Each bite adds 1 to the **biteCount** of the victim.
- At **5 bites** the victim dies.
- Biting in view of witnesses **raises suspicion** of the biter in every witness's social model.
- The victim's own suspicion of the biter spikes **+60** (almost always enough to convict).
- After being bitten, a gator enters a **flee state** for 4–7 seconds, then may counter-attack (45% chance).

### 3.5 Social Currency

| Metric | Range | Effect |
|--------|-------|--------|
| **Relation** | −100 → +100 | How much gator A likes gator B |
| **Suspicion** | 0 → 100 | How strongly A believes B is the Murderer |
| **Fear** | 0 → 100 | How frightened A is of B |
| **Social Need** | 0 → 100 | Pressure to seek conversation; decays 12/tick idle, restores 22/tick talking |

---

## 4. Game Instructions

### 4.1 Starting a Game

1. Open `https://localhost:5001` (or the deployed URL).
2. Click **▶ Start Simulation**.
3. Gators spawn at random positions on the island.
4. The simulation begins in **DAY** phase automatically.

### 4.2 2-D Overhead View Controls

| Action | How |
|--------|-----|
| Select a gator | Click their sprite in the overhead view |
| View gator details | Hover over any sprite — tooltip shows stats |
| Switch dialog mode | Toggle **AI / Rule-Based** button in the top bar |
| Speed up | Reduce `TickMs` in `appsettings.json` and restart |

### 4.3 3-D POV View Controls

Click the **🌐 3-D View** button to enter Babylon mode.

| Input | Action |
|-------|--------|
| `W` / `↑` | Move forward |
| `S` / `↓` | Move backward |
| `A` / `←` | Strafe left |
| `D` / `→` | Strafe right |
| `Space` | Jump |
| Right-click + drag | Look around (yaw + pitch) |
| Left-click on a gator | Open interaction menu |
| `Escape` | Exit POV / release pointer lock |

### 4.4 Interaction Menu (POV Mode)

When you left-click another gator in 3-D view a floating menu appears:

```
┌──────────────────────────┐
│ 🐊 Dot                   │
├──────────────────────────┤
│ 💬 Start Conversation    │
│ 🦷 Attack!               │
│ 🎯 Make Attack…          │
│ 👁 Switch POV            │
│ ✖  Close                 │
└──────────────────────────┘
```

| Button | Effect |
|--------|--------|
| **💬 Start Conversation** | Your POV gator walks to the target and begins an AI conversation |
| **🦷 Attack!** | Your gator bites the target immediately (5 s cooldown) |
| **🎯 Make Attack…** | Two-step picker: choose an attacker gator, then a victim — the attacker autonomously chases and bites |
| **👁 Switch POV** | You inhabit the clicked gator's body |
| **✖ Close** | Dismiss the menu |

### 4.5 HUD Buttons (Always Visible in POV)

| Button | Effect |
|--------|--------|
| **⚔ Attack** | Quick-attack: picks a victim from a one-step picker |
| **🎯 Make Attack** | Full two-step attacker → victim command |

### 4.6 Watching the Debate

During the **DEBATE** phase, gators automatically take turns speaking. Speech bubbles appear over each speaker in both views. Accusing a gator raises the community's suspicion of them. The AI chooses who to accuse based on:

1. Their own **suspicion scores** (highest = most likely accused)
2. **Fear memories** — being bitten by someone is near-conclusive evidence
3. **Relation weights** — friendly gators may defend each other even against evidence

### 4.7 Voting

Each surviving gator votes for the gator they most suspect. Ties are broken randomly. The voted-out gator's role is revealed and they are removed from the game. The cycle restarts.

---

## 5. Technical Architecture

### 5.1 Solution Layout

```
SwampOfSalem.slnx
│
├── SwampOfSalem.Web/           ← ASP.NET Core host + entire frontend
│   ├── Program.cs              ← DI wiring, Minimal API endpoints
│   ├── wwwroot/
│   │   ├── index.html          ← Single-page shell, POV HUD markup
│   │   ├── js/
│   │   │   ├── main.js         ← Entry point
│   │   │   ├── simulation.js   ← Core tick loop & movement
│   │   │   ├── phases.js       ← Phase transitions
│   │   │   ├── agentQueue.js   ← HTTP queue + conversation buffer
│   │   │   ├── agentBridge.js  ← fetch() wrappers
│   │   │   ├── gatorBabylon.js ← Babylon.js 3-D renderer
│   │   │   ├── rendering.js    ← SVG/DOM writes
│   │   │   ├── state.js        ← Mutable global state
│   │   │   ├── gator.js        ← Gator constructor, social math
│   │   │   ├── helpers.js      ← Pure utilities
│   │   │   └── gameConfig.js   ← Fetches C# constants → JS
│   │   └── css/
│   │       └── swamp-of-salem.css
│   └── README.md               ← (this file)
│
├── SwampOfSalem.AppLogic/      ← Game constants + AI orchestration
│   ├── Constants/
│   │   └── GameConstants.cs    ← Single source of truth for all numbers
│   └── Services/
│       ├── GameConfigProvider.cs   ← Serialises constants → JSON → JS
│       ├── GatorAgentService.cs    ← Semantic Kernel AI calls
│       ├── GatorBrainService.cs    ← Rule-based dialog fallback
│       └── DialogRouter.cs         ← Routes to AI or rules
│
├── SwampOfSalem.Gators/        ← Gator character generation
├── SwampOfSalem.Shared/        ← Shared DTOs / interfaces
└── SwampOfSalem.SK/            ← Semantic Kernel configuration
```

### 5.2 Technology Stack

```
┌─────────────────────────────────────────────────────────────┐
│                     BROWSER                                  │
│                                                              │
│  ┌───────────────────┐   ┌──────────────────────────────┐   │
│  │  2-D Simulation   │   │  3-D POV (Babylon.js)         │   │
│  │  (SVG + Canvas)   │   │  WebGPU → WebGL2 fallback     │   │
│  │  ES Modules       │   │  Free camera, mesh sync       │   │
│  └─────────┬─────────┘   └──────────────┬───────────────┘   │
│            │  shared state.js            │                   │
│            └──────────────┬─────────────┘                   │
│                           │ fetch()                          │
└───────────────────────────┼─────────────────────────────────┘
							│ HTTP/1.1 (localhost)
┌───────────────────────────┼─────────────────────────────────┐
│           ASP.NET Core    │  (.NET 10)                       │
│                           │                                  │
│  ┌────────────────────────▼──────────────────────────────┐  │
│  │  Minimal API  (14 endpoints)                           │  │
│  │  Program.cs                                            │  │
│  └──────┬─────────────────────────┬──────────────────────┘  │
│         │                         │                          │
│  ┌──────▼──────┐         ┌────────▼────────┐                │
│  │DialogRouter │         │GameConfigProvider│                │
│  └──────┬──────┘         └────────┬────────┘                │
│    ┌────┴────┐                    │                          │
│    │         │            GameConstants.cs                   │
│  AI mode  Rules mode                                         │
│    │                                                         │
│  ┌─▼──────────────────┐                                     │
│  │ Semantic Kernel     │                                     │
│  │ GatorAgentService   │                                     │
│  └─────────┬──────────┘                                     │
└────────────┼────────────────────────────────────────────────┘
			 │ HTTPS
	 ┌───────▼─────────┐
	 │ OpenAI / Ollama  │   ← or Azure OpenAI
	 │ (configurable)   │
	 └──────────────────┘
```

### 5.3 Data Flow — End-to-End Request

#### Conversation request (AI mode)

```
gameLoop() detects two gators within TalkDist (300 px)
  │
  ▼
agentQueue.js :: requestFullConversation(gatorA, gatorB)
  │  Enqueues HTTP call to avoid parallel AI floods
  ▼
agentBridge.js :: POST /api/agent/conversation
  { speakerId, listenerId, topic, history, socialContext }
  │
  ▼
Program.cs maps to → GatorAgentService.GetConversationAsync()
  │
  ▼
Semantic Kernel builds prompt:
  System: "You are [name], an alligator in a swamp town..."
  + personality traits, relationship context, fear/suspicion
  + conversation history (last N turns)
  │
  ▼
LLM returns: [ { speaker, text }, ... ]  (5–9 turns)
  │
  ▼
Response JSON → agentQueue.js :: drainNextConvTurn()
  Plays one line per tick, updates speech bubbles in rendering.js
  Records new memories: gator.chatLog, gator.fearMemories
  │
  ▼
Suspicion / relation deltas applied → state.gators[]
  Next AI call can see these in context
```

#### Rule-based fallback path

```
DialogRouter checks appsettings DialogSource == "RuleBased"
  │
  ▼
GatorBrainService picks a template line based on:
  - phase (day / debate / dawn)
  - suspicion scores
  - relation to listener
  - random topic pool from helpers.js
  │
  ▼
Returns same { speaker, text } JSON shape → same playback path
```

### 5.4 Game Loop & Phase Machine

#### Tick flow

```
setInterval(gameLoop, TICK_MS)   ← 2200 ms default
  │
  ├─ Increment tick counter
  ├─ Move all living gators toward their wander targets
  │    └─ Wall-bounce: if near WALL_CLEAR margin → pick new interior target
  ├─ Check proximity pairs → trigger conversations
  ├─ Check house proximity → trigger hosting/visiting
  ├─ Murderer AI: pick weakest target → move toward them
  ├─ Flee states: decrement timers → maybe counter-attack
  ├─ Social-need decay / gain per gator
  ├─ Check phase expiry
  │    ├─ DAY    → triggerNightfall()
  │    ├─ NIGHT  → triggerDawn()
  │    ├─ DAWN   → triggerDebate()
  │    ├─ DEBATE → triggerVote()
  │    ├─ VOTE   → triggerExecute()
  │    └─ EXECUTE→ finaliseExecution() → back to DAY (or game over)
  └─ renderAllGators() → SVG repaint
```

#### Phase state machine

```
		┌─────────────────────────────────────────────┐
		│                                             │
		▼                                             │
  ┌───────────┐  DayTicks (136)  ┌───────────────┐   │
  │    DAY    ├─────────────────►│     NIGHT     │   │
  │ (~5 min)  │                  │    (~4 s)     │   │
  └───────────┘                  └──────┬────────┘   │
		▲                               │ NightTicks  │
		│                               ▼  (2)        │
		│                        ┌──────────────┐     │
		│                        │     DAWN     │     │
		│                        │   (~13 s)    │     │
		│                        └──────┬───────┘     │
		│                               │ DawnTicks(6) │
		│                               ▼              │
		│                        ┌──────────────┐      │
		│                        │    DEBATE    │      │
		│                        │  (~2 min)    │      │
		│                        └──────┬───────┘      │
		│                               │ DebateTicks  │
		│                               │   (55)       │
		│                               ▼              │
		│                        ┌──────────────┐      │
		│                        │     VOTE     │      │
		│                        └──────┬───────┘      │
		│                               │              │
		│                               ▼              │
		│                        ┌──────────────┐      │
		│                        │   EXECUTE    │      │
		│                        └──────┬───────┘      │
		│    No winner yet              │              │
		└───────────────────────────────┘              │
					 Winner found                      │
						  └────────────────────────────┘
							   ► OVER
```

### 5.5 Gator AI & Social Simulation

#### Social graph structure (per gator)

```javascript
{
  id:               number,       // stable numeric ID
  name:             string,       // e.g. "Rex"
  emoji:            string,       // e.g. "🐊"
  role:             "towngator" | "murderer",
  traits:           string[],     // e.g. ["liar", "brave", "paranoid"]

  // Position (2-D pixel space, 0–1200 × 0–800)
  x: number, y: number,
  targetX: number, targetY: number,
  speed: number,

  // Social state
  relations:         { [id]: −100…100 },   // how much I like them
  suspicion:         { [id]: 0…100 },      // how much I suspect them
  fear:              { [id]: 0…100 },      // how scared I am of them
  socialNeed:        0…100,

  // Memory
  chatLog:           string[],    // last N conversation lines
  fearMemories:      { biterId, victimId, witnessCount, tick }[],
  history:           string[],    // LLM conversation history for continuity

  // Combat state
  biteCount:         number,      // bites received; ≥5 = dead
  fleeUntilMs:       number,      // timestamp until flee state ends
  isFleeing:         boolean,

  // Phase state
  votedFor:          id | null,
  debateCooldown:    number,
}
```

#### Suspicion propagation (bite witness model)

```
Attacker bites Victim in view of Witness
  │
  ├─ Victim.suspicion[attacker]     += 60   (direct evidence)
  ├─ Victim.fear[attacker]          += 50
  │
  ├─ For each Witness within TALK_DIST:
  │    ├─ listenerFeelsBiter  = witness.relations[attacker]
  │    ├─ listenerFeelsVictim = witness.relations[victim]
  │    │
  │    ├─ If feelsVictim > feelsAttacker  →  suspicion += 35, sides with victim
  │    ├─ If feelsAttacker > feelsVictim  →  suspicion += 5  (minimises it)
  │    └─ If neutral (both ~0)            →  50% chance either way
  │
  └─ Liar trait: 40% chance to flip the story before passing on
```

#### Conversation context sent to the LLM

```json
{
  "speakerId": 2,
  "listenerId": 5,
  "topic": "the biting last night",
  "socialContext": {
	"speakerRelationToListener":  42,
	"speakerSuspicionOfListener": 78,
	"speakerFearsListener":       12,
	"listenerSuspicionOfSpeaker": 30,
	"speakerTraits":              ["paranoid", "talkative"],
	"phase":                      "debate"
  },
  "history": [
	"Rex: Did you see what Dot did last night?",
	"Bubba: I was asleep, I swear..."
  ]
}
```

#### Voting algorithm

```
For each living gator G:
  1. Find max(G.suspicion[x]) across all other alive gators
  2. That gator = G.votedFor
  3. If tie → random selection
  4. Tally votes → most votes = executed
  5. Reveal role on execution screen
```

### 5.6 Frontend Module Map

```
index.html
  └── <script type="module" src="js/main.js">
		│
		├── simulation.js       ← imports everything below
		│     ├── state.js           singleton mutable state
		│     ├── gator.js           Person constructor + helpers
		│     ├── phases.js          phase transition handlers
		│     ├── rendering.js       all DOM/SVG writes
		│     ├── agentQueue.js      HTTP request queue
		│     │     └── agentBridge.js   raw fetch() wrappers
		│     ├── helpers.js         pure utils (layout, math, topics)
		│     └── gameConfig.js      /api/game-config → JS constants
		│
		└── gatorBabylon.js     ← lazy-loaded on 3-D button click
			  ├── state.js      (same singleton)
			  ├── simulation.js (commandAttack, applyBiteEffect, …)
			  └── agentQueue.js (setPovChoiceHandler)
```

#### Module responsibilities

| Module | ~Lines | Core responsibility |
|--------|--------|---------------------|
| `simulation.js` | 1 340 | Tick loop, movement, bite effects, OOB guard, POV movement write-back |
| `phases.js` | 1 400 | Night/Dawn/Debate/Vote/Execute transitions, scripted speeches |
| `agentQueue.js` | 400 | Serial HTTP queue, conversation turn playback buffer |
| `agentBridge.js` | 150 | Raw `fetch()` wrappers for all 14 endpoints |
| `state.js` | 170 | Single `state` export: gators[], phase, obstacles[], etc. |
| `gator.js` | 300 | `createPerson()`, `living()`, relation/suspicion math |
| `rendering.js` | 600 | SVG sprites, speech bubbles, stat bars, house guests |
| `helpers.js` | 400 | `stageBounds()`, `dist()`, topic pools, SVG helpers |
| `gameConfig.js` | 50 | One-time GET `/api/game-config` → named constants |
| `gatorBabylon.js` | 1 750 | Babylon scene, gator meshes, POV camera, HUD, wall meshes |

### 5.7 API Reference

All endpoints are declared in `Program.cs` using Minimal API syntax.

| Method | Path | Body / Response | Notes |
|--------|------|-----------------|-------|
| `POST` | `/api/agent/initialize` | `{ gatorCount }` → `GatorDto[]` | Spawns gators with random traits |
| `POST` | `/api/agent/dialog` | `DialogRequest` → `{ speaker, text }` | Single spoken line |
| `POST` | `/api/agent/thought` | `DialogRequest` → `{ speaker, text }` | Inner thought (type="thought") |
| `POST` | `/api/agent/conversation` | `ConversationRequest` → `Turn[]` | Full multi-turn conv (5–9 turns) |
| `POST` | `/api/agent/vote` | `VoteRequest` → `{ votedForId }` | Voting decision |
| `POST` | `/api/agent/memory` | `MemoryRequest` → `204` | Inject one memory entry |
| `POST` | `/api/agent/memory/batch` | `MemoryRequest[]` → `204` | Inject many memories |
| `POST` | `/api/agent/night-report` | `NightReportRequest` → `Report[]` | All gators' night thoughts |
| `POST` | `/api/agent/test-chat` | `{ message }` → `{ reply }` | LLM connection test |
| `POST` | `/api/agent/get-gator` | `{}` → `GatorDto` | AI-generate a random character |
| `GET`  | `/api/game-config` | — → `{ GATOR_SIZE, TICK_MS, … }` | All C# constants as JSON |
| `GET`  | `/api/config` | — → `{ provider, model }` | Active LLM info |
| `GET`  | `/api/dialog-source` | — → `"AI"` or `"RuleBased"` | Current engine mode |
| `POST` | `/api/dialog-source` | `{ source }` → `204` | Switch engine at runtime |

### 5.8 3-D POV Renderer (Babylon.js)

#### Scene hierarchy

```
Scene
│
├── Lights
│     ├── HemisphericLight  "hemi"   (sky/ground ambient)
│     ├── DirectionalLight  "sun"    (key light, warm golden)
│     └── DirectionalLight  "fill"   (cool rim fill)
│
├── Ground meshes
│     ├── swampBase    600×600 deep water plane (beneath everything)
│     ├── island       120×80 central dry ground
│     ├── grass[0-7]   straw-coloured patches
│     ├── mud[0-12]    dark wet soil near edges
│     ├── bog[0-8]     green-brown transition strips
│     └── puddle[0-7]  shallow water pools (alpha 0.8)
│
├── Moat planes        North / South / West / East water rings
├── Lily pads          ~28 disc meshes scattered on moat
│
├── Wall (buildWall)
│     ├── wallN / wallS / wallW / wallE   box segments
│     ├── *_cap                            crenellation tops
│     └── tower[0-3]                       octagonal corner towers
│
├── Trees (buildTrees)
│     ├── 200 far-bank trees               (tall, dense forest backdrop)
│     └── ~45 island trees                 (match ISLAND_TREE_POSITIONS[])
│
├── Reeds (buildReeds)           clustered along all four edges
├── Rocks (buildRocks)           14 mossy rock groups
│
└── Gator meshes (getOrCreateGatorMesh per living gator)
	  └── root (TransformNode)
			├── torso   (shirt colour = unique accent per gator)
			├── belly   (pale accent strip)
			├── hips    (dark trousers)
			├── legL / legR  (swing animation during walk)
			├── armL / armR  (swing animation)
			├── headPivot
			│     ├── skull
			│     ├── snout
			│     ├── eyeL / eyeR
			│     └── toothL / toothR
			├── tail
			└── label   (billboard DynamicTexture — name above head)
```

#### Coordinate mapping

```
2-D canvas (px)      →    Babylon world (units)
─────────────────────────────────────────────
0 – 1200 (x)         →    0 – 120   (world X)
0 – 800  (y)         →    0 –  80   (world Z)
SCALE = 0.1          →    1 canvas px = 0.1 world unit

Camera eye height: 2.7 wu  ≈ person shoulder height
Gator total height: ~3.8 wu
```

#### POV camera system

```
_manualActive = true  (permanent once initBabylon runs)

Each frame (_applyManualCamera):
  1. Read _keys set (WASD / Arrows)
  2. Compute forward/strafe vectors from _manualYaw
  3. Move camera by FREE_CAM_SPEED × dt
  4. Clamp to WALL_CLEAR margin in both X and Z
  5. Write position back → POV gator's simulation coordinates
	 (gator.x = camera.x / SCALE, gator.y = camera.z / SCALE)
  6. Right-drag mouse → update _manualYaw + _manualPitch
  7. camera.setTarget(lookX, lookY, lookZ) from yaw+pitch
```

#### Red flash on hit gator

```javascript
flashGatorRed(gatorId):
  data = gatorMeshes.get(gatorId)
  save originalDiffuse
  bodyMat.diffuseColor  = Color3(1, 0.05, 0.05)   // bright red
  bodyMat.emissiveColor = Color3(0.8, 0, 0)
  lerp back over 600 ms in 5 steps: [100, 200, 350, 500, 600] ms
  restore original colour + zero emissive
```

---

#### How Babylon.js Is Used in This Application

Babylon.js is not the authoritative game engine — the 2-D `simulation.js` loop owns all game state. Babylon's role is strictly **visual**: a read-only mirror of the simulation rendered from first-person perspective.

```
┌──────────────────────────────────────────────────────────────────────┐
│                     ARCHITECTURE SPLIT                               │
│                                                                      │
│  simulation.js (authoritative)          gatorBabylon.js (visual)    │
│  ─────────────────────────────          ─────────────────────────── │
│  state.gators[].x / .y                  worldX = gator.x * SCALE    │
│  state.gators[].activity                mesh.position updated/frame  │
│  applyBiteEffect()                      flashGatorRed() visual only  │
│  commandAttack()                        HUD button calls back to sim  │
│  TICK_MS = 2200 ms (simulation)         60 fps render loop (Babylon) │
│                                                                      │
│  gatorBabylon READS state.gators[]     gatorBabylon NEVER writes it  │
│  (except: WASD writes gator.x/y back to move the 2-D sim position)  │
└──────────────────────────────────────────────────────────────────────┘
```

---

#### Engine initialisation

```javascript
// gatorBabylon.js — initBabylonPOV()
const engine = await BABYLON.WebGPUEngine.CreateAsync(canvas, { antialias: true });
// Falls back automatically to WebGL2 if WebGPU is unavailable.
```

The WebGPU engine is created once on first click of the "3-D View" button. It is never destroyed while the tab is open — switching back to 2-D hides the canvas but keeps the engine alive for instant re-entry.

---

#### Coordinate mapping: 2-D pixels → 3-D world units

```
2-D simulation pixel space:   0 – 1200 px wide,  0 – 800 px tall
Babylon world-unit space:     0 – 120  wide,      0 – 80  deep   (SCALE = 0.1)

Formula:
  worldX = simPixelX * 0.1
  worldZ = simPixelY * 0.1    ← note: 2-D Y maps to Babylon Z (forward axis)
  worldY = 0                  ← all gators stand on the ground plane

Camera eye height:  CAM_H = 2.7 world units ≈ shoulder height on gator mesh
Gator total height: ~3.8 world units (body + head cylinders)
```

Every frame, `syncGatorMeshes()` converts each gator's 2-D coordinates:

```javascript
mesh.position.x = gator.x * SCALE;   // e.g. gator.x=600 → worldX=60 (island center)
mesh.position.z = gator.y * SCALE;   // e.g. gator.y=400 → worldZ=40
mesh.position.y = 0;                 // ground level
```

---

#### Scene construction — what gets built and when

`buildScene()` is called once during `initBabylonPOV()`. All meshes are built procedurally — there are no external asset files.

```
buildScene():
  ├── Create BABYLON.Scene, set sky colour rgb(22%, 30%, 18%) (swamp green-grey)
  ├── Set fog: LINEAR mode, start=55, end=160 world units
  │     (gators disappear into haze at ~160 units = 1,600 sim px)
  │
  ├── Lighting (3-point setup):
  │     HemisphericLight 'hemi'   intensity=0.65  diffuse=(0.75, 0.85, 0.60) sky
  │                                               groundColor=(0.20, 0.28, 0.12)
  │     DirectionalLight 'sun'    intensity=1.60  diffuse=(1.00, 0.92, 0.65) warm gold
  │                                               direction=(-1, -2.5, -0.8)
  │     DirectionalLight 'fill'   intensity=0.25  diffuse=(0.45, 0.62, 0.55) cool cyan
  │                                               direction=(+1, -1, +1)
  │
  ├── Ground planes (layered, Y offsets prevent Z-fighting):
  │     swampBase   600×600  Y=−0.12  (dark murky water, alpha=0.92)
  │     island      120×80   Y=0.00   (cracked dry earth, 20 subdivisions)
  │     grass[0-7]  Y=0.005  (straw patches, scattered across island)
  │     mud[0-12]   Y=0.006  (dark wet soil near edges and interior channels)
  │     bog[0-8]    Y=0.007  (green-brown transition at water's edge)
  │     puddle[0-7] Y=0.020  (shallow water pools, alpha=0.80)
  │
  ├── Moat planes  N/S/W/E   Y=−0.05  200-unit-wide deep-water rings
  ├── Lily pads    28 discs  radius 0.9–1.6, tessellation=10
  │
  ├── buildTrees()   ~45 island trees + 200 far-bank backdrop trees
  ├── buildReeds()   Cylinder clusters along all 4 edges
  ├── buildRocks()   14 mossy rock groups (2–4 scaled spheres each)
  └── buildWall()    4 box-segment wall + 4 octagonal corner towers
```

---

#### Gator mesh anatomy (`getOrCreateGatorMesh`)

Each living gator gets a `TransformNode` root parenting a fully articulated bipedal figure:

```
root (TransformNode, positioned at worldX/worldZ each frame)
│
├── torso      CylinderMeshBuilder  r=0.5→0.6, h=1.4   shirt colour = gator.color
├── belly      CylinderMeshBuilder  r=0.52,   h=0.5    pale accent strip
├── hips       CylinderMeshBuilder  r=0.45→0.5, h=0.6  dark trousers
├── legL       CylinderMeshBuilder  r=0.18,   h=0.9    left leg (pivots for walk)
├── legR       CylinderMeshBuilder  r=0.18,   h=0.9    right leg
├── armL       CylinderMeshBuilder  r=0.14,   h=0.8    left arm (counter-swings)
├── armR       CylinderMeshBuilder  r=0.14,   h=0.8    right arm
├── headPivot  TransformNode        (Y=1.5 above root)
│     ├── skull    SphereBuilder    diameter=1.1
│     ├── snout    CylinderMeshBuilder  elongated forward-facing muzzle
│     ├── eyeL     SphereBuilder    diameter=0.22, white with dark pupil
│     ├── eyeR     SphereBuilder    (mirrored)
│     ├── toothL   CylinderMeshBuilder  small ivory spike
│     └── toothR   CylinderMeshBuilder
├── tail       CylinderMeshBuilder  tapers from r=0.25 to r=0.05, h=1.2
│
└── label      DynamicTexture (256×64 px) drawn with:
               ctx.fillText(gator.name, ...)  in billboard mode
               position: Y=3.8 (above head)
               always faces the camera (billboardMode = ALL)
```

**Walk animation** — run every frame from the render loop:

```javascript
// Each frame, if gator.activity === 'moving' and dist-to-target > 0.5:
const walkCycle = (Date.now() * 0.003) % (Math.PI * 2);   // period ≈ 2100 ms
legL.rotation.x  =  Math.sin(walkCycle) * 0.6;             // ±34° swing
legR.rotation.x  = -Math.sin(walkCycle) * 0.6;             // opposite phase
armL.rotation.x  = -Math.sin(walkCycle) * 0.4;             // counter-swing
armR.rotation.x  =  Math.sin(walkCycle) * 0.4;
```

---

#### The wall system and how it links to the 2-D simulation

`buildWall()` places four stone wall segments and four octagonal corner towers as visual Babylon meshes **and simultaneously registers them in `state.obstacles[]`** so the 2-D simulation movement code can avoid them:

```javascript
// For each wall segment:
const seg = BABYLON.MeshBuilder.CreateBox('wallN', { width:ISLAND_X, height:WALL_H, depth:WALL_T }, scene);
seg.position = new BABYLON.Vector3(cx, WALL_H/2, cz);

// Register obstacle for 2-D movement guard (simulation.js WALL_CLEAR check):
state.obstacles.push({ x: seg.position.x / SCALE - …, y: …, w: …, h: … });
```

The 2-D simulation then enforces `WALL_CLEAR = 60 px` (6 world units) margin on every tick, so gators that wander too close physically turn around:

```javascript
// simulation.js tick() — wall-safe clamp + bounce:
if (gator.x < WALL_CLEAR) {
  gator.x = WALL_CLEAR;
  gator.targetX = WALL_CLEAR + rnd(W/2);   // pick a new target away from the wall
}
if (gator.x > W - GATOR_SIZE - WALL_CLEAR) {
  gator.x = W - GATOR_SIZE - WALL_CLEAR;
  gator.targetX = rnd(W/2);
}
// Same for Y / top / bottom edges.
```

---

#### Manual camera system — always on

Once the player presses any key or right-drags, `_manualActive = true` **permanently**. The camera never auto-follows the simulation's notion of where the gator is. Instead, player movement writes back to the simulation:

```
Each render frame (_applyManualCamera, called from scene.registerBeforeRender):
  dt = engine.getDeltaTime() / 1000          // seconds since last frame
  sp = FREE_CAM_SPEED(12) × dt              // world units to move this frame

  fwdX = sin(_manualYaw),  fwdZ = cos(_manualYaw)   // forward vector (XZ only)
  rtX  = cos(_manualYaw),  rtZ =-sin(_manualYaw)    // right vector

  Read _keys Set:
    W/↑ → camera.position += (fwdX, fwdZ) × sp
    S/↓ → camera.position -= (fwdX, fwdZ) × sp
    A/← → camera.position -= (rtX,  rtZ)  × sp
    D/→ → camera.position += (rtX,  rtZ)  × sp

  Clamp camera to wall-safe bounds:
    camera.position.x = clamp(camera.x, 6, 120−6)
    camera.position.z = clamp(camera.z, 6, 80−6)

  Write back to sim gator:
    activeGator.x = camera.position.x / 0.1     // world → sim pixels
    activeGator.y = camera.position.z / 0.1
    activeGator.targetX = activeGator.x          // prevent sim from overriding

  Look-at target (from yaw + pitch):
    lookX = camX + sin(yaw)×cos(pitch)
    lookY = camY + sin(pitch)
    lookZ = camZ + cos(yaw)×cos(pitch)
    camera.setTarget(lookX, lookY, lookZ)
```

Right-drag mouse adjusts `_manualYaw` (horizontal, unlimited) and `_manualPitch` (vertical, clamped to ±1.3 rad ≈ ±74°):

```javascript
_manualYaw   +=  dx * MOUSE_SENSITIVITY;        // MOUSE_SENSITIVITY = 0.0020 rad/px
_manualPitch -=  dy * MOUSE_SENSITIVITY;        // drag up = look up
_manualPitch  = clamp(_manualPitch, −1.3, +1.3);
```

---

#### POV context menu — single left-click on a gator

```
Player left-clicks canvas while in POV mode:
  │
  ├─ scene.pick(clickX, clickY) → PickingInfo
  ├─ Walk up hit.pickedMesh's parent chain → find TransformNode root
  ├─ Look up root in gatorMeshes Map → get gator object
  ├─ Was there a right-drag this pointer-down? → suppress (wasDragging guard)
  │
  └─ _showCtxMenu(gator, screenX, screenY)
       Renders floating <div> with 4 buttons:
         💬 "Start Conversation" → startPovConversation(povGator, target)
         🦷 "Attack!"           → applyBiteEffect(povGator.id, target.id)
                                   (enforces 5-second BITE_COOLDOWN_MS)
         🎯 "Make Attack…"      → two-step picker overlay:
                                     Step 1: choose attacker (radio list of living gators)
                                     Step 2: choose victim   (radio list excluding attacker)
                                   → commandAttack(attacker.id, victim.id)
         👁 "Switch POV"        → activeGatorIndex = living().indexOf(target)
```

---

#### HUD layer (HTML overlay, not Babylon)

The HUD is a set of `<div>` elements floating above the Babylon `<canvas>` — it is plain HTML/CSS, not part of the Babylon scene graph. Two key HUD functions connect the 3-D view back to the simulation:

```javascript
hudAttack(attackerId, victimId):
  // Called when player picks attacker+victim from "Make Attack" picker
  commandAttack(attackerId, victimId)   // simulation.js — sets _pendingAttackTargetId
  // Attacker walks toward victim and bites when in range

hudMakeAttack():
  // Opens the two-step attacker→victim picker overlay
  // Populates dropdown with living() gator names
  // On confirm: calls hudAttack(selectedAttackerId, selectedVictimId)
```

---

#### Babylon.js features used — summary table

| Feature | Used for | Key parameter |
|---------|----------|---------------|
| `WebGPUEngine` | Primary renderer (WebGL2 fallback) | `antialias: true` |
| `Scene` | Container for all meshes, lights, camera | `fogMode: LINEAR` |
| `HemisphericLight` | Sky/ground ambient | intensity=0.65 |
| `DirectionalLight` | Sun key light + cool fill | intensity=1.60 / 0.25 |
| `MeshBuilder.CreateGround` | Island terrain, moat, grass, mud, bog, puddle | Y-layered, 0.001–0.020 offsets |
| `MeshBuilder.CreateBox` | Houses, wall segments | HOUSE_W=12, HOUSE_H=7, WALL_H=2.8 |
| `MeshBuilder.CreateCylinder` | Gator body, head, trees, reeds, rocks | Tapered top/bottom radii |
| `MeshBuilder.CreateSphere` | Gator skull, eyes, rocks | diameter 0.22–1.1 |
| `MeshBuilder.CreateDisc` | Lily pads on moat | radius 0.9–1.6, tessellation=10 |
| `TransformNode` | Gator root + headPivot | Groups sub-meshes for easy transforms |
| `DynamicTexture` | Name-tag labels above gator heads | 256×64 px canvas drawn per-frame |
| `StandardMaterial` | All surface materials | diffuse/specular/emissive colour |
| `FreeCamera` | First-person POV | Manual yaw/pitch in `registerBeforeRender` |
| `scene.registerBeforeRender` | Per-frame camera + walk animation | Runs at display refresh rate (~60 fps) |
| `engine.getDeltaTime()` | Frame-rate-independent movement | dt = ms since last frame / 1000 |
| `Color3 / Color4` | All colour values | Normalised 0–1 RGB |
| `Vector3` | All position/direction math | x, y, z |
| `scene.pick()` | Left-click gator selection | Returns `PickingInfo` with mesh + UV |



All defined in `SwampOfSalem.AppLogic/Constants/GameConstants.cs` and serialised to `window.GameConfig` at startup.

| Constant | Value | Meaning |
|----------|-------|---------|
| `GatorSize` | 120 px | Sprite bounding box |
| `GatorCount` | 2 | Default gators per session |
| `TickMs` | 2 200 ms | Simulation tick interval |
| `TalkDist` | 300 px | Max distance to start a conversation |
| `TalkStop` | 90 px | Distance at which gators stop and face each other |
| `HouseEnterD` | 48 px | Distance to "enter" a house |
| `SocialDecay` | 12 /tick | Social need lost while idle |
| `SocialGain` | 22 /tick | Social need restored while talking |
| `SocialUrgent` | 60 | Social need level that triggers aggressive socialising |
| `DayTicks` | 136 | Ticks in Day phase (~5 min) |
| `NightTicks` | 2 | Ticks in Night phase (~4 s) |
| `DawnTicks` | 6 | Ticks in Dawn phase (~13 s) |
| `DebateTicks` | 55 | Max ticks in Debate phase (~2 min) |
| `ConvictionThreshold` | 55 | Suspicion score that triggers accusation/vote |
| `BiteDeathThreshold` | 5 | Bites before death |
| `BiteFleeMinMs` | 4 000 ms | Minimum flee duration after being bitten |
| `BiteFleeExtraMs` | 3 000 ms | Random extra flee time on top |
| `BiteCounterChance` | 0.45 | Probability of counter-attack after flee |
| `LiarFlipChance` | 0.40 | Probability a "liar" trait gator inverts passed gossip |
| `ConversationExtraTurns` | 4 | Extra turns added randomly to base 5-turn conversations |

### 5.10 Configuration & Secrets

**`appsettings.json`** (committed, no secrets):

```jsonc
{
  "LLM": {
	"Provider": "OpenAI",          // "OpenAI" | "AzureOpenAI"
	"OpenAI": {
	  "ModelId": "llama3",         // any OpenAI-compatible model
	  "Endpoint": "http://localhost:11434/v1",  // Ollama local by default
	  "ApiKey": "not-needed"
	},
	"AzureOpenAI": {
	  "DeploymentName": "gpt-4o",
	  "Endpoint": "",
	  "ApiKey": ""                 // ← use dotnet user-secrets in production
	}
  },
  "DialogSource": "AI"             // "AI" | "RuleBased"
}
```

**Offline / no-LLM mode** (fastest iteration):

```jsonc
{ "DialogSource": "RuleBased" }
```

**Running locally**:

```powershell
cd SwampOfSalem.Web
dotnet run
# Navigate to https://localhost:5001
```

---

### 5.11 A Gator's Thought Process: How the Game Calls Code

This section walks through a gator's inner loop exactly as the code executes it — not at a high level, but with actual numbers, function names, and decision branches.

#### Overview: two clocks, one gator

Each gator is driven by **two independent timers**:

| Clock | What drives it | Period |
|-------|---------------|--------|
| **Tick clock** | `setInterval(tick, TICK_MS)` — 2,200 ms | Activity changes, movement, conversations |
| **Thought clock** | `Date.now()` compared to `nextThoughtAt` | Inner thoughts (2,000 ms – 20,000 ms depending on `thoughtStat`) |

The tick clock is global — all gators update on every tick. The thought clock is per-gator and fires asynchronously between ticks.

---

#### Step-by-step: a typical DAY tick for one gator

Assume gator **Rex** (id=3, personality=`extrovert`, thoughtStat=8), currently `activity:'moving'`.

```
Tick fires at t = 0 ms  (setInterval, every 2,200 ms)
│
├─ 1. Move Rex toward targetX/targetY
│      speed = WALK_SPEED['extrovert'] = 3.2 px/frame
│      dist to target ≈ 85 px
│      → Rex moves 3.2 px closer this frame
│      → still moving, ticksLeft-- (was 4, now 3)
│
├─ 2. Wall-bounce guard (simulation.js inner loop)
│      if (rex.x < WALL_CLEAR)          → rex.x = 60, flip targetX
│      if (rex.x > W - GATOR_SIZE - 60) → same on right edge
│      (W = 1200, so right limit = 1200 - 120 - 60 = 1020)
│
├─ 3. Scan for conversation partners
│      For every other living gator q:
│        d = dist(Rex, q) = 247 px
│        if d <= TALK_DIST (300) AND d > TALK_STOP (90):
│          → Rex walks TOWARD q (new targetX/targetY = q's position)
│        if d <= TALK_STOP (90):
│          → CONVERSATION TRIGGER (see below)
│
└─ 4. renderAllGators() — SVG updated
```

---

#### Conversation trigger (the most expensive path)

When `dist(Rex, Dot) <= 90` (TALK_STOP) and no conversation is active:

```
simulation.js tick():
  state.activeConversation = true
  Rex.activity = 'talking'; Rex.talkingTo = Dot.id; Rex.ticksLeft = rndTicks('talking')
  Dot.activity = 'talking'; Dot.talkingTo = Rex.id
  │
  ├─ First meeting? (Rex.met does NOT contain Dot.id)
  │     YES → topicCompatibility(Rex.topicOpinions, Dot.topicOpinions)
  │             e.g. Rex=Jets fan(+65 leadership, -30 gossip)
  │                  Dot=Jets fan(+40 leadership, +20 gossip)
  │           sports_team same → +80 raw → score component = 80
  │           leadership diff  = |65−40| = 25 → 100−25 = 75
  │           gossip diff      = |−30−20| = 50 → 100−50 = 50
  │           avg = (80+75+50+…) / 4 ≈ +60
  │           seed = round(60 × 0.2) = +12
  │           Rex.relations[Dot.id] = 12
  │           Dot.relations[Rex.id] = 12
  │     NO  → use existing relation score
  │
  ├─ agentQueue.requestFullConversation(Rex, Dot, openingLine, maxTurns, context, isPrivate, onComplete)
  │     maxTurns = 5 + rnd(CONVERSATION_EXTRA_TURNS=4)  →  e.g. 7
  │     openingLine = "Hi, I'm Rex!"  (first meeting) or "Hey Dot!" (repeat)
  │
  │     INSIDE agentQueue:
  │       _flushMemoriesForGator(Rex.id) → POST /api/agent/memory/batch (Rex's pending memories)
  │       _flushMemoriesForGator(Dot.id) → POST /api/agent/memory/batch (Dot's pending memories)
  │       getFullConversation(Rex.id, Dot.id, openingLine, 7, context)
  │         → POST /api/agent/conversation  [HTTP call to Semantic Kernel / rule-based fallback]
  │         → Returns array of 7 turn objects: [{speaker:"Rex",text:"…"},{speaker:"Dot",text:"…"},…]
  │
  └─ Turns queued in _convTurns[]; playback begins on next tick drain
```

---

#### Conversation playback: turn-by-turn drain

Once the AI response arrives, `agentQueue._drainNextConvTurn()` runs on each tick until all turns are consumed:

```
Turn 1 (t = 2,200 ms after conv start):
  Rex.message = "Hi, I'm Rex!"
  logChat(Rex, Dot.id, "Hi, I'm Rex!", /*thought*/ null, isPrivate=false)
    → Rex.chatLog ← { from:3, to:5, message:"Hi…", type:'said' }
    → Dot.chatLog ← same entry
    → Gator Sam (dist=210 px < 300) gets { type:'overheard' } entry
    → recordMemory(Sam.id, day=1, 'overheard', "Overheard Rex say: Hi I'm Rex", refId=Rex.id)

Turn 2 (t = 4,400 ms):
  Dot.message = "Nice to meet you Rex! Jets fan here."
  logChat(Dot, Rex.id, "Nice to meet you Rex! Jets fan here.", null, false)
  (same broadcast)

…turns 3–7 play at 2,200 ms intervals…

Turn 7 (final):
  _drainNextConvTurn detects _convTurnIndex === _convTurns.length
  → _convHolding = true  (3-second post-conversation hold)
  → setTimeout 3,000 ms → onComplete() fires:
       driftRelations(Rex, Dot)
       _onConversationCompleted()
       Rex.activity = 'moving'; Rex.talkingTo = null
       Dot.activity = 'moving'; Dot.talkingTo = null
       state.activeConversation = false
```

---

#### Opinion sharing after a conversation (30% chance)

```javascript
// simulation.js _maybeShareOpinion()
// Fires once per conversation completion, 30% probability.

if (Math.random() < 0.30) {
  // Pick a random third gator C that Rex has suspicion about
  // Rex tells Dot what he thinks of gator C
  // Dot.suspicion[C.id] nudges toward Rex.suspicion[C.id] by ~10–20 pts
  // If Rex is a liar (liar=true), 40% chance the story is inverted:
  //   Rex says C is trustworthy even though Rex suspects them.
}
```

Example with real numbers:
> Rex suspects Sam (suspicion[Sam.id]=72). Rex has a 30% chance to share this with Dot.
> If triggered: Dot's suspicion of Sam moves from 10 → ~25 (nudge of +15).
> If Rex is a liar: 40% chance Dot's suspicion of Sam actually *decreases* by ~10 instead.

---

#### Attack path: how `commandAttack` calls code

```
Player (or murderer AI) triggers: commandAttack(attackerId=3, victimId=7)
│
├─ attacker._pendingAttackTargetId = 7
├─ attacker.activity = 'moving'
│
│  [on each subsequent tick, tick() checks:]
│    if (attacker._pendingAttackTargetId) {
│      victim = gators.find(g.id === 7)
│      d = dist(attacker, victim) = 160 px  → still too far, walk closer
│    }
│
│  [tick N+3, dist = 88 px ≤ TALK_STOP=90]
│    applyBiteEffect(attackerId=3, victimId=7, isCounter=false)
│    attacker._pendingAttackTargetId = null
│
│  INSIDE applyBiteEffect:
│    victim.relations[biter.id] = −100   (instant max hatred)
│    victim.suspicion[biter.id] += 60    (e.g. 10 → 70; now above ConvictionThreshold=55)
│    victim.biteCount++                  (e.g. 2 → 3; threshold=5)
│    victim.fear[biter.id] += 50         (e.g. 5 → 55)
│    flashGatorRed(victimId)             (Babylon.js red flash, 600 ms lerp-back)
│    _startFightOrFlight(victim, biter)
│      fleeMs = BITE_FLEE_MIN_MS(4000) + rnd(BITE_FLEE_EXTRA_MS=3000)  →  e.g. 5,200 ms
│      victim.biteFleeUntil = Date.now() + 5200
│      victim.activity = 'moving'; victim.targetX = random edge point
│      setTimeout(5200 ms):
│        if (Math.random() < BITE_COUNTER_CHANCE=0.45):
│          applyBiteEffect(victim.id, biter.id, isCounter=true)  ← counter-bite
│        else:
│          victim.message = "I need to get away from Rex…"
│
│    witness loop (all living gators within TALK_DIST=300 px):
│      Sam (dist=220) → _vocabSawBite(Sam, Rex, Dot):
│        "I just watched Rex bite Dot! That was brutal."
│        Sam.suspicion[Rex.id] += 35   (if Sam likes Dot more than Rex)
│        Sam.fear[Rex.id] += 30
│        Sam.biteObservations.push({ biterId:3, victimId:7, day:1 })
│        recordMemory(Sam.id, day=1, 'witnessed_bite', "Saw Rex bite Dot", refId=Rex.id)
│
│    if (victim.biteCount >= BITE_DEATH_THRESHOLD=5):
│      _killFromBites(victim, biter)
│        state.deadIds.add(victim.id)
│        all survivors: suspicion[biter.id] += 35, fear[biter.id] += 40
│        DOM element fades out over 1.5 s
```

---

#### Phase transitions: when code fires at the tick boundary

```
Every tick: if (state.ticksLeft <= 0) triggerPhaseTransition()

DAY phase started with DayTicks=136 ticks remaining.
At tick 136: phases.js triggerNightfall()
  murderer = gators with role='murderer'  (assigned at spawn)
  murderVictim():
    candidates = living().filter(g ≠ murderer)
    weights = candidates.map(c => 1 + murderer.suspicion[c.id]/100 + murderer.fear[c.id]/100)
    victim = weightedPick(weights, candidates)
    // e.g. weights: [1.2, 1.8, 0.9] → victim most likely to be the gator with weight 1.8
    state.nightVictimId = victim.id
    victim.message = "💤 Zzz…"
    state.phase = PHASE.NIGHT; state.ticksLeft = NightTicks=2

At tick 2 of NIGHT: triggerDawn()
  night victim is killed; crime scene rendered
  state.phase = PHASE.DAWN; state.ticksLeft = DawnTicks=6

At tick 6 of DAWN: triggerDebate()
  pickDebateSuspect(each gator):
    top suspect = argmax(gator.suspicion)
    if max(suspicion) >= ConvictionThreshold=55 → that gator is the debate target
  requestDialog() calls for opening accusations
  state.phase = PHASE.DEBATE; state.ticksLeft = DebateTicks=55

At tick 55 of DEBATE (or early if enough accusation): triggerVote()
  decideVote(voter):
    votedFor = argmax(voter.suspicion across living gators)
    if tie → random
  state.phase = PHASE.VOTE → EXECUTE
```

---

### 5.12 Gator Memory: How It Works and Influences Decisions

Memory is the bridge between what a gator *witnessed* and how they *behave* later. There are three layers of memory, each with different persistence and influence.

#### Layer 1 — chatLog (ephemeral, conversation-local)

Stored on `gator.chatLog[]`. Each entry:

```javascript
{ day: 1, from: 3, to: 5, message: "Did you see what Dot did?",
  thought: null, ts: 1716000000000, type: 'said' | 'overheard' | 'private' | 'thought' }
```

**What it's used for:**
- Rendering the gator's chat panel in the UI.
- Feeding the AI system prompt (recent lines are injected as conversation history).
- Determining overhearing: any gator within `TALK_DIST=300 px` of a public speaker gets an `overheard` entry.

**How it influences the AI:**
The last N lines from `chatLog` are serialised into the `context` parameter of `getFullConversation()`. If Dot's chatLog contains *"Overheard Rex say: 'Did you see what Sam did last night?'"*, that line lands in Dot's next conversation context — the LLM "remembers" it organically without any special memory API.

---

#### Layer 2 — recordMemory() / flushMemories() (buffered, AI-side)

Every significant event calls `recordMemory(gatorId, day, type, detail, refId)`.

```javascript
// Examples generated by the simulation:
recordMemory(Sam.id,  day=1, 'witnessed_bite',  "Saw Rex bite Dot",               refId=Rex.id)
recordMemory(Dot.id,  day=1, 'first_meeting',   "Met Rex for the first time",      refId=Rex.id)
recordMemory(Rex.id,  day=1, 'conversation_start', "Started talking with Dot",     refId=Dot.id)
recordMemory(Dot.id,  day=2, 'overheard',        "Overheard Sam say: 'Rex did it'", refId=Sam.id)
```

Memories accumulate in `agentQueue._pendingMemories[gatorId][]` (an in-browser buffer). They are **NOT sent immediately**.

**Flush timing:** immediately before every AI conversation request:

```
agentQueue.requestFullConversation(Rex, Dot, …):
  _flushMemoriesForGator(Rex.id)
    → POST /api/agent/memory/batch  [ array of Rex's pending memories ]
    → server feeds them into Semantic Kernel's memory store
    → 204 response; buffer cleared
  _flushMemoriesForGator(Dot.id)
    → same for Dot
  → now call getFullConversation(…)
```

**Why flush-before-call?** The LLM needs the freshest context injected into its SK memory *before* it generates the conversation. Batching avoids N separate HTTP calls per game event and keeps the server-side state synchronized just in time.

---

#### Layer 3 — suspicion, fear, relations (persistent social graph)

These are numeric scores on the gator object itself. They never expire and directly drive every high-stakes decision.

```
gator.suspicion[otherId]  0–100   "How likely is this gator to be the murderer?"
gator.fear[otherId]       0–100   "How scared am I of this gator?"
gator.relations[otherId]  −100–+100  "How much do I like/hate this gator?"
```

**How memory builds suspicion — worked example:**

> **Day 1, tick 42:** Rex bites Dot.
> - Sam witnesses from 220 px away (within TALK_DIST=300).
> - Sam has `relations[Rex.id]=−15` (mild dislike) and `relations[Dot.id]=+30` (likes Dot).
> - Sam's weights: feelsVictim(30) > feelsAttacker(−15) → *sides with victim*
> - `Sam.suspicion[Rex.id] += 35` → Sam.suspicion[Rex.id] = 35 (was 0).
> - `Sam.fear[Rex.id] += 30` → Sam.fear[Rex.id] = 30.
>
> **Day 1, tick 88:** Sam passes Rex walking, overhears Rex say: *"I had nothing to do with the bite."*
> - `recordMemory(Sam.id, day=1, 'overheard', "Heard Rex deny the bite", refId=Rex.id)`
> - Sam's suspicion of Rex does NOT auto-increment here — the memory is buffered.
>
> **Day 1, tick 110:** Sam starts a conversation with Babs.
> - `_flushMemoriesForGator(Sam.id)` sends "witnessed Rex bite Dot" + "heard Rex deny it" to server.
> - The LLM generates Sam's dialog with both memories in context.
> - Sam's line: *"I saw Rex bite Dot, and then Rex had the nerve to deny it!"*
> - `logChat(Sam, Babs.id, "I saw Rex bite Dot…", null, false)`
> - Babs overhears this → `Babs.suspicion[Rex.id] += ~20` via `_maybeShareOpinion()`.
>
> **Debate phase, tick 1:**
> - `pickDebateSuspect(Sam)`:
>   - `max(Sam.suspicion)` = Rex=35, Babs=5, Dot=0
>   - Rex is Sam's top suspect but 35 < ConvictionThreshold=55 → Sam accuses Rex tentatively.
>
> **Day 2 (if Rex bites again):** Sam.suspicion[Rex.id] += 35 again → 70 → **above threshold**.
> - Now Sam will vote to execute Rex without hesitation.

---

#### Memory and the liar flag

Gators assigned `liar=true` (probability is personality-dependent: cheerful ≈ 10%, grumpy ≈ 45%) manipulate their **perceivedRelations** and their gossip:

```javascript
// driftRelations() — called after every conversation
if (a.liar && a.relations[b.id] < −20) {
  a.perceivedRelations[b.id] = Math.min(100, Math.abs(a.relations[b.id]));
  // true: relations[b.id] = −55 (hates b)
  // shown: perceivedRelations[b.id] = +55 (presents as friendly)
}

// _maybeShareOpinion() — 30% chance, 40% flip if liar
if (Math.random() < LIAR_FLIP_CHANCE=0.40) {
  // Invert the gossip: tell partner Rex is innocent even though suspicion=72
  partner.suspicion[refId] = Math.max(0, partner.suspicion[refId] - nudge);
}
```

A grumpy liar can drive an innocent gator's community suspicion score toward 55+ over 3–4 conversations by spreading inverted rumors, manufacturing a false conviction.

---

#### biteObservations — the fear memory record

When a gator witnesses a bite, a structured record is pushed:

```javascript
witness.biteObservations.push({
  day:      1,
  biterId:  3,   // Rex
  victimId: 7,   // Dot
  reason:   "Rex bit Dot in the open near house 2"
});
```

This record feeds the night-report endpoint (`getNightReport(aliveIds)`), where each gator generates a narrative of what frightened them most. The result is surfaced in the game's end-of-night summary panel and injected back as a memory before Day 2's conversations begin.

---

### 5.13 How Topics, Phrases, and Dialog Are Chosen

#### Topic opinion generation at spawn (`generateTopicOpinions`)

Every gator runs `generateTopicOpinions(personality)` once when `createGator()` is called. There are four topics:

| Topic key | Type | Range |
|-----------|------|-------|
| `sports_team` | string | `'Rockets'`, `'Jets'`, or `'Chowda'` |
| `local_gossip` | number | −100 … +100 |
| `swamp_leadership` | number | −100 … +100 |
| `favorite_swamp_activity` | number | −100 … +100 |

**Sports team assignment (probability split):**

```
Roll random 0–1:
  < 0.42 → 'Rockets'   (42% — local majority team)
  < 0.85 → 'Jets'      (43% — local minority team)
  else   → 'Chowda'    (15% — out-of-town team, triggers friction)
```

**Numeric topic generation with personality bias:**

```javascript
const bias = { cheerful:+30, grumpy:−30, shy:−10, extrovert:+20, paranoid:−20, neutral:0 }[personality];
const raw  = (Math.random() * 200 − 100) + bias * (0.5 + Math.random() * 0.5);
opinions[topic] = clamp(round(raw), −100, +100);
```

**Worked example — a `grumpy` gator:**

```
bias = −30
For topic 'swamp_leadership':
  random raw base = +28  (lucky roll)
  bias factor     = −30 × 0.73 = −21.9
  raw total       = 28 − 21.9 = +6.1  →  clamped to +6
For topic 'local_gossip':
  random raw base = −55
  bias factor     = −30 × 0.61 = −18.3
  raw total       = −55 − 18.3 = −73.3  →  clamped to −73
```
> A grumpy gator is likely to dislike most things, but the ±random component means they can occasionally surprise you with positive opinions.

---

#### How opinions are converted to conversation context (`topicOpinionSummary`)

Before every AI call, `topicOpinionSummary(gator.topicOpinions)` produces a compact sentence:

```
Threshold labels:
  ≥  60 → "loves"
  ≥  20 → "likes"
  ≥ −20 → "is neutral about"
  ≥ −60 → "dislikes"
  <  −60 → "hates"

Input:  { sports_team:'Jets', local_gossip:−73, swamp_leadership:6, favorite_swamp_activity:55 }
Output: "supports Jets; hates local gossip; is neutral about swamp leadership; likes swamp activities"
```

This string is injected directly into the AI system prompt so the LLM generates in-character dialogue without needing a database query.

---

#### Topic compatibility and first-meeting relationship seeding

When two gators meet for the first time, `topicCompatibility(a.topicOpinions, b.topicOpinions)` runs:

```
Sports team (string):
  Same team:           +80
  Both local, rival:   −10  (Jets vs Rockets — mild rivalry)
  One is Chowda:       −60  (out-of-towner stigma)

Numeric topics:
  score = 100 − |opinionA − opinionB|
  Example: opinionA=+55, opinionB=−30 → |55−(−30)|=85 → score=15 (nearly incompatible)
  Example: opinionA=+55, opinionB=+60 → |55−60|=5   → score=95 (nearly identical)

Final = average across all 4 topics
```

**Full example:**

| Topic | Rex | Dot | Score |
|-------|-----|-----|-------|
| sports_team | Jets | Jets | +80 |
| local_gossip | +40 | +55 | 100−15=85 |
| swamp_leadership | −30 | +60 | 100−90=10 |
| favorite_swamp_activity | +70 | +65 | 100−5=95 |
| **Average** | | | **(80+85+10+95)/4 = 67.5** |

> Result: `seed = round(67.5 × 0.2) = 14`. Rex and Dot start with `relations[other.id] = 14` — a mildly positive first impression driven entirely by topic alignment.

---

#### Post-hosting topic delta (`applyTopicRelationDelta`)

When two gators finish a *hosting* (private, indoor) conversation, topic-based bond/friction is applied on top of the standard `driftRelations()` drift:

| Topic | Contribution range | Formula |
|-------|--------------------|---------|
| Sports team | −9 to +12 | `_sportsTeamCompat() × 0.15` |
| Local gossip | −8 to +8 | `(100 − |diff|) × 0.08` |
| Swamp leadership | −10 to +10 | `±strength × 0.1` (sign = agree/disagree) |
| Fav. activity | −6 to +6 | `(100 − |diff|) × 0.06` |
| **Total range** | **−33 to +36** | (extreme values rare) |

**Example:** Rex (Jets, gossip=+40, leadership=−30, activity=+70) hosts Dot (Chowda fan, gossip=+55, leadership=+60, activity=+65):

```
Sports:      Chowda vs Jets → −60 × 0.15 = −9
Gossip:      |40−55|=15 → (100−15)×0.08 = +6.8 → +7
Leadership:  sign(−30)≠sign(+60) → opposite → −(45)×0.1 = −4.5 → −5
Activity:    |70−65|=5 → (100−5)×0.06 = +5.7 → +6
──────────────────────────────────────────────────────
Total delta: −9 + 7 − 5 + 6 = −1
```

> Rex and Dot end the visit almost neutral — sports tension and leadership disagreement nearly cancel out the gossip and activity harmony.

---

#### Phrase selection: vocabulary buckets and `pickBucketed`

Spoken lines for reactions (bite events, first meetings, accusations) come from **personality-bucketed phrase pools** via `pickBucketed(bucket, personality)`:

```javascript
const pool = bucket[personality] || bucket.cheerful || Object.values(bucket)[0];
return pool[rnd(pool.length)];
```

Each vocabulary array in `simulation.js` has **15 entries** across 7 reaction contexts:

| Context function | When called | Pool size |
|-----------------|-------------|-----------|
| `_vocabGetBit(victim, biter)` | Victim is bitten | 15 |
| `_vocabBiting(biter, victim)` | Biter's inner monologue | 15 |
| `_vocabSawBite(witness, biter, victim)` | Neutral witness | 15 |
| `_vocabSawBiteOfLiked(witness, biter, victim)` | Witness likes victim | 15 |
| `_vocabSawBiteOfHated(witness, biter, victim)` | Witness dislikes victim | 15 |
| `_vocabLikedBitesHated(witness, biter, victim)` | Witness likes biter, hates victim | 15 |
| `_vocabHatedBitesLiked(witness, biter, victim)` | Witness hates biter, likes victim | 15 |

Selection is weighted by social graph at call time — the simulation looks up `witness.relations[biter.id]` and `witness.relations[victim.id]` to decide which pool to pull from:

```
relations[biter.id] > +20  AND  relations[victim.id] < −20  → _vocabLikedBitesHated
relations[biter.id] < −20  AND  relations[victim.id] > +20  → _vocabHatedBitesLiked
relations[victim.id] > +20  (only)                          → _vocabSawBiteOfLiked
relations[victim.id] < −20  (only)                          → _vocabSawBiteOfHated
otherwise                                                   → _vocabSawBite (neutral)
```

**Example selection path:**

> Sam's `relations[Rex.id] = −15` (slightly negative, not below −20) and `relations[Dot.id] = +30` (likes Dot, above +20).
> → Uses `_vocabSawBiteOfLiked` pool.
> → `rnd(15)` returns 3 → *"How dare Rex hurt Dot?! I care about them and this is unforgivable."*

---

#### AI vs. rule-based dialog selection

The game can run in two modes switchable at runtime via `/api/dialog-source`:

```
DialogSource = "AI"
  → agentBridge.getFullConversation() → POST /api/agent/conversation
  → Semantic Kernel + OpenAI/Azure OpenAI generates all turns
  → Full memory context, personality prompt, topic opinions injected

DialogSource = "RuleBased"
  → server returns pre-scripted template responses
  → topic opinions and personality still shape which template is selected
  → zero LLM latency; ideal for offline/dev iteration
```

In RuleBased mode, topic opinion summary is still computed and injected — the rule engine uses the same `topicOpinionSummary` string to pick the closest matching scripted response from a template bank organised by topic and personality.

---

## 6. Project History

The project began as **PeopleWatcher** — a general people-watching simulator — and evolved through three name changes and multiple architectural overhauls into the current social-deduction game.

### Timeline

```
Apr 2026                                              May 2026
│                                                          │
▼                                                          ▼
●─────●───●─────●──●──●─────────────────────────●─────────●
│     │   │     │  │  │                         │         │
│     │   │     │  │  │                         │         └─ 2026-05-17
│     │   │     │  │  │                         │            "Attacking now possible,
│     │   │     │  │  │                         │             other cleanup"
│     │   │     │  │  │                         │             🐊 Full combat + flash
│     │   │     │  │  │                         │
│     │   │     │  │  │                         └─ 2026-05-16
│     │   │     │  │  │                            "readmes" + "AI off play"
│     │   │     │  │  │                             Rule-based dialog switch added
│     │   │     │  │  │
│     │   │     │  │  └─ 2026-05-07  (burst of 6 commits)
│     │   │     │  │     "3d" → "up" → "much better" → "before" → "hmm" → "l"
│     │   │     │  │      Babylon.js 3-D POV view built from scratch
│     │   │     │  │      Bipedal gator meshes, manual camera, wall/tree/house scene
│     │   │     │  │
│     │   │     │  └─ 2026-04-24  "Happy with how offline is coming"
│     │   │     │      Offline branch polished; rule-based engine stable
│     │   │     │
│     │   │     └─ 2026-04-23  "Offline started" + "Output report"
│     │   │         Began decoupling from live AI for dev iteration
│     │   │         Report generation endpoint added
│     │   │
│     │   └─ 2026-04-22  "conversation picker" + "st" + "stupid me" + "Docs"
│     │       POV conversation-picker UI built
│     │       In-game documentation panel added
│     │
│     └─ 2026-04-18  "adsf" + "They're talking :)" 🎉
│         First successful end-to-end AI conversation between two gators
│         LLM generates real dialogue, history tracked per gator
│
└─ 2026-04-17  FOUNDING COMMITS
	da01059 — "Add .gitattributes and .gitignore"   ← repo created
	f8e1fd8 — "Add project files."                  ← initial scaffold
			  Original name: PeopleWatcher
			  Stack: Blazor Server + plain JS canvas
	6374c9c — "quick update"
	c75e48c — "quick"
	efc5ba3 — "good split" × 2
			  Refactored into multi-project solution
			  Renamed: PeopleWatcher → GatorGazing → SwampOfSalem
	23173c0 — "AI chat works"  🎉  FIRST AI MILESTONE
	2d38c82 — "Update AgentInterop + appsettings gitignore"
	7e14061 — "Docs"
	1f910f2 — "Looking good"
```

### Architectural Evolution

| Era | Stack | Key milestone |
|-----|-------|--------------|
| **v0 — PeopleWatcher** (Apr 17) | Blazor Server + JS canvas | Initial scaffold, `people-watcher.js`, Blazor page |
| **v1 — GatorGazing** (Apr 17) | ASP.NET Core → Blazor interop | Multi-project split, `GatorGazing.Blazor`, `AgentInterop.cs` |
| **v2 — AI Talks** (Apr 17–18) | Semantic Kernel + OpenAI | First real AI conversation (`23173c0` — "They're talking 🎉") |
| **v3 — SwampOfSalem online** (Apr 18–23) | Full ES-module frontend, 14 API endpoints | Conversation picker, output reports, phase system complete |
| **v4 — Offline mode** (Apr 23–24) | `DialogSource: RuleBased` | No-LLM game loop, fast iteration branch (`offline`) |
| **v5 — 3-D POV** (May 7) | Babylon.js 7 (WebGPU) | Full 3-D scene: island, trees, houses, bipedal gator meshes |
| **v6 — Combat & polish** (May 16–17) | — | Attack commands, victim red-flash, permanent manual camera, name tags, wall bounce |

### Commit Log

| Hash | Date | Message | What changed |
|------|------|---------|--------------|
| `da01059` | 2026-04-17 | Add .gitattributes and .gitignore | Repo initialisation |
| `f8e1fd8` | 2026-04-17 | Add project files | Bootstrap scaffold (PeopleWatcher) |
| `6374c9c` | 2026-04-17 | quick update | Early wiring |
| `c75e48c` | 2026-04-17 | quick | Iteration |
| `efc5ba3` | 2026-04-17 | good split | Multi-project restructure |
| `9337fcb` | 2026-04-17 | good split | Further restructure |
| `2d38c82` | 2026-04-17 | Update AgentInterop + gitignore appsettings | Secrets hygiene |
| `f63917b` | 2026-04-17 | Update AgentInterop + appsettings.json to gitignore | Duplicate cleanup |
| `23173c0` | 2026-04-17 | AI chat works | 🎉 **First AI conversation milestone** |
| `a9b9e60` | 2026-04-18 | They're talking 🙂 | Stable multi-turn conversations |
| `1710adf` | 2026-04-18 | adsf | Iteration |
| `1f910f2` | 2026-04-21 | Looking good | UI improvements, social graph visible |
| `7e14061` | 2026-04-22 | Docs | In-game docs panel |
| `a684664` | 2026-04-22 | stupid me | Bug fix |
| `ef84db6` | 2026-04-22 | st | Iteration |
| `a9e7927` | 2026-04-22 | conversation picker | POV conversation picker UI |
| `f086fd2` | 2026-04-23 | Output report | Report generation endpoint |
| `1844243` | 2026-04-23 | Offline started | Offline / rule-based branch begins |
| `c4f8c62` | 2026-04-24 | Happy with how offline is coming | Rule-based mode stable |
| `f9beae5` | 2026-05-07 | up | Babylon dependencies added |
| `2e71129` | 2026-05-07 | 3d | 🎉 **Babylon.js 3-D scene first commit** |
| `564930b` | 2026-05-07 | much better | Gator mesh polish, lighting |
| `15b70ae` | 2026-05-07 | before | Scene layout iteration |
| `08663a0` | 2026-05-07 | hmm | Debug iteration |
| `cf854d0` | 2026-05-07 | l | Final 3-D scene polish |
| `149950a` | 2026-05-16 | AI off play | Rule-based toggle in UI |
| `5ef5819` | 2026-05-16 | readmes | Project READMEs written |
| `86719db` | 2026-05-17 | Attacking now possible, other cleanup | 🎉 **Full combat: commandAttack, flashGatorRed, wall-bounce, permanent POV camera, name tags** |

---

*README last updated: 2026-05-17 · Branch: `offline` · Repo: `sth-garage/SwampOfSalem`*
