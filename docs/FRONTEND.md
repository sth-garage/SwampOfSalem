# 🗺️ Swamp of Salem — JavaScript Frontend Reference

> **Audience:** Junior developers who need to understand, modify, or debug the browser-side code.
> **Prerequisite:** Read [ARCHITECTURE.md](ARCHITECTURE.md) first for the big picture.

---

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Module Dependency Graph](#2-module-dependency-graph)
3. [main.js — Entry Point](#3-mainjs--entry-point)
4. [gameConfig.js — The C# Constant Bridge](#4-gameconfigjs--the-c-constant-bridge)
5. [state.js — Shared Mutable State](#5-statejs--shared-mutable-state)
6. [gator.js — Character Factory & Relations](#6-gatorjs--character-factory--relations)
7. [helpers.js — Pure Utilities](#7-helpersjs--pure-utilities)
8. [simulation.js — The Brain](#8-simulationjs--the-brain)
9. [phases.js — Phase Transitions](#9-phasesjs--phase-transitions)
10. [rendering.js — DOM Layer](#10-renderingjs--dom-layer)
11. [agentQueue.js — AI Orchestration](#11-agentqueuejs--ai-orchestration)
12. [agentBridge.js — HTTP Client](#12-agentbridgejs--http-client)
13. [The Person Object — Complete Field Reference](#13-the-person-object--complete-field-reference)
14. [Common Patterns](#14-common-patterns)
15. [Debugging Tips](#15-debugging-tips)

---

## 1. Module Overview

| File | Lines | Role | Can Import From |
|------|-------|------|-----------------|
| `main.js` | 14 | Entry point | `simulation.js` |
| `gameConfig.js` | 88 | C# → JS constant bridge | *(none — only reads `window.GameConfig`)* |
| `state.js` | 96 | Shared mutable state | `gameConfig.js` |
| `gator.js` | 342 | Gator factory + relation math | `gameConfig.js`, `helpers.js`, `state.js` |
| `helpers.js` | 1017 | Pure utilities + SVG builders | `gameConfig.js` |
| `simulation.js` | 1274 | Tick loop + conversation orchestration | all others |
| `phases.js` | 533 | Phase transitions | all except `simulation.js` |
| `rendering.js` | 503 | All DOM manipulation | `gameConfig.js`, `helpers.js`, `gator.js`, `state.js` |
| `agentQueue.js` | 576 | AI request queue + memory buffer | `agentBridge.js`, `state.js`, `gator.js`, `simulation.js` (logChat) |
| `agentBridge.js` | 145 | HTTP client | *(none — only uses fetch)* |

> 📏 **Line counts are approximate and may grow as the project evolves.**

---

## 2. Module Dependency Graph

Reading the graph: an arrow `A → B` means "A imports from B."

```
index.html
  └── main.js
		└── simulation.js  ◄──────────────────────────────────────────┐
			  │                                                         │
			  ├── gameConfig.js     (reads window.GameConfig only)      │
			  │                                                         │
			  ├── state.js                                              │
			  │     └── gameConfig.js                                   │
			  │                                                         │
			  ├── gator.js                                              │
			  │     ├── gameConfig.js                                   │
			  │     ├── helpers.js                                      │
			  │     │     └── gameConfig.js                             │
			  │     └── state.js                                        │
			  │                                                         │
			  ├── phases.js                                             │
			  │     ├── gameConfig.js                                   │
			  │     ├── helpers.js                                      │
			  │     ├── gator.js                                        │
			  │     ├── state.js                                        │
			  │     ├── rendering.js                                    │
			  │     │     ├── gameConfig.js                             │
			  │     │     ├── helpers.js                                │
			  │     │     ├── gator.js                                  │
			  │     │     └── state.js                                  │
			  │     └── agentQueue.js ──────────────────────────────────┤
			  │           ├── agentBridge.js                            │
			  │           ├── state.js                                  │
			  │           ├── gator.js                                  │
			  │           └── logChat from simulation.js ───────────────┘
			  │                (circular — resolved at runtime)
			  │
			  └── rendering.js  (also imported directly)
```

> ⚠️ **Circular import note:** `agentQueue.js` calls `logChat()` from `simulation.js`,
> while `simulation.js` imports `requestFullConversation` from `agentQueue.js`.
> ES Modules handle this for function references (not values), so it works —
> but `agentQueue.js` also needs the `tick` function reference, which is
> injected at runtime via `setTickFunction(tick)` called in `initSimulation()`.

---

## 3. main.js — Entry Point

**Purpose:** Minimal bridge between the HTML page and the simulation engine.

```javascript
// main.js is intentionally only 14 lines.
// It re-exports initSimulation and testConversation from simulation.js.
// The HTML page loads main.js and the Blazor/server-side code calls initSimulation().
export { initSimulation, testConversation } from './simulation.js';
```

**Do NOT** add logic here. If you want to add a new exported function,
add it to `simulation.js` and re-export from `main.js`.

---

## 4. gameConfig.js — The C# Constant Bridge

**Purpose:** Read the `window.GameConfig` object (injected by C# at startup)
and re-export every constant with the same name that other modules expect.

```javascript
// gameConfig.js — simplified
const G = window.GameConfig;
if (!G) throw new Error('window.GameConfig must be set before importing gameConfig.js');

export const GATOR_COUNT  = G.GATOR_COUNT;   // e.g. 6
export const TICK_MS      = G.TICK_MS;        // e.g. 2200
export const TALK_DIST    = G.TALK_DIST;      // e.g. 300
// ... (88 total exports)
```

**Golden rule:** If you add a new constant in `GameConstants.cs`,
add the corresponding export line in `gameConfig.js`.

**Adding a new constant — step by step:**
1. Add `public const int MyNewValue = 42;` in `GameConstants.cs`
2. Add serialisation in `GameConfigProvider.cs` (if it's a new structure type)
3. Add `export const MY_NEW_VALUE = G.MY_NEW_VALUE;` in `gameConfig.js`
4. Import it in whatever module needs it: `import { MY_NEW_VALUE } from './gameConfig.js';`

---

## 5. state.js — Shared Mutable State

**Purpose:** Single source of truth for all runtime simulation state.

All modules import `state` and read/write to it directly. There is no
state management library — this is intentional (see [ARCHITECTURE.md §4](ARCHITECTURE.md#4-state-management)).

### Key State Fields

```javascript
state.gators          // Array<Person> — ALL gators (living + dead)
state.houses          // Array<HouseLayout> — culde-sac house positions
state.gamePhase       // string — 'Day' | 'Night' | 'Dawn' | 'Debate' | 'Vote' | 'Execute' | 'Over'
state.murdererId      // number | null — ID of the secret killer
state.deadIds         // Set<number> — fast lookup: is this gator dead?
state.dayNumber       // number — current day (starts at 1)

// Conversation control
state.activeConversation   // boolean — MUTEX: true when AI conv is running
state.completedConvCount   // number — total conversations completed today
state.noNewConversations   // boolean — true after nightfall countdown expires
state.dayEndTimerActive    // boolean — true after conv limit hit
state.dayEndTimerExpiresAt // number — Date.now() when night begins

// Visual state
state.bubbles          // Map<id, DOMElement> — speech bubble elements
state.thoughts         // Map<id, DOMElement> — thought bubble elements
state.talkLines        // Map<string, SVGElement> — connector lines between chatting pairs
state.privateChatBubbles // Map<homeIndex, DOMElement> — hosting conversation enclosures
```

### resetGameState()

Called by `spawnGators()` at the start of each new game.
Resets all counters, flags, and sets `cycleTimer` to `DAY_TICKS`.

---

## 6. gator.js — Character Factory & Relations

**Purpose:** Creates `Person` objects and manages inter-gator relationship math.

### Exported Functions

#### `createGator(index, house)`

Creates one fully-initialised `Person` object for the given house slot.
Every field the simulation will ever read must be set here (default values).

```
createGator(0, {doorX: 400, doorY: 300, ...})
	│
	├── Picks personality from PERSONALITIES array
	├── Sets x/y near house door (±10px jitter)
	├── Computes thoughtStat from THOUGHT_STAT_BASE[personality] ± 1
	├── Sets nextThoughtAt to a random time (1.5–19.5s) to stagger initial thoughts
	├── Generates topicOpinions (sports team, governance stance, etc.)
	├── Calls randomAppearance(index) for hat/skin/shirt
	└── Returns fully-populated Person object
```

#### `initRelations()`

Called once after all gators are spawned. Resets every gator's:
- `relations[otherId]` to `0`
- `perceivedRelations[otherId]` to `0`
- `met` Set to empty (no one has been introduced yet)

Also randomly assigns `liar = true` to ~15% of non-murderer gators.

#### `driftRelations(a, b)`

Called at the END of every conversation. Nudges both gators' relations
toward each other based on personality compatibility + random noise.

```
drift formula (simplified):
  baseChange = compatBonus(a.personality, b.personality)  // from RelationshipConstants
			 + random(-6, +10)
  a.relations[b.id] = clamp(a.relations[b.id] + baseChange, -100, +100)
  b.relations[a.id] = clamp(b.relations[a.id] + baseChange, -100, +100)

If a gator is a liar, their perceivedRelations is skewed:
  perceivedRelations[otherId] = -(trueRelation * 0.6) + random(20)
  (they pretend to like people they actually dislike)
```

#### `socialWeights(gator)`

Returns the activity probability weights for this gator's personality.
Used by `weightedPick()` to randomly select their next activity.

```
socialWeights({personality: 'extrovert'})
  → { talking: 72, moving: 15, hosting: 5, visiting: 5, resting: 3 }
```

#### `living()`

Returns `state.gators.filter(p => !state.deadIds.has(p.id))`.
**Always use `living()` when you want only currently alive gators.**
Never iterate `state.gators` directly unless you want dead gators too.

---

## 7. helpers.js — Pure Utilities

**Purpose:** Utility functions with no side effects. No DOM access, no state mutations.

### Random Helpers

| Function | Signature | Returns |
|---|---|---|
| `rnd` | `rnd(n)` | Random integer `0..n-1` |
| `rndF` | `rndF(n)` | Random float `0..n` |
| `hsl` | `hsl()` | Random bright HSL color string |
| `rndTicks` | `rndTicks(activity)` | Random tick count from `ACTIVITY_TICKS[activity]` |

### Topic System

```
TOPICS = ['sports_team', 'swamp_leadership', 'local_gossip', 'favorite_swamp_activity']

TOPIC_LABELS = {
  sports_team: '⚽ Sports Team',
  swamp_leadership: '🏛️ Leadership',
  ...
}

generateTopicOpinions(personality)
  → { sports_team: 'Rockets', swamp_leadership: -40, local_gossip: 20, ... }
  Returns a mixed map of string (sports_team) and numeric (-100..+100) opinions.

topicCompatibility(aOpinions, bOpinions)
  → number (-100..+100)
  Compares opinions on all topics; same sports team = big bonus.

applyTopicRelationDelta(host, guest)
  → { delta: number, reasons: string[] }
  Called at end of hosting visit. Nudges relations based on topic agreement.
  Returns delta and an array of reason strings for debugging.
```

### Appearance & Layout

```
randomAppearance(index)
  → { skinTone, hatStyle, hatColor, shirtColor, headSize, bodyHeight, legLength, armAngle }

culdesacLayout()
  → { housePositions: [{x, y, doorX, doorY, angle, ...}] }
  Computes house positions in a ring around the cul-de-sac circle.
  Called on spawn and on window resize.

stageBounds()
  → { W: number, H: number }
  Returns current #world element dimensions. Used to clamp positions.

buildFigureSVG(gator)
  → string (SVG markup)
  Generates the inline SVG stick figure for a gator.

buildCuldesacSVG(layout)
  → string (SVG markup)
  Generates the static road / park background SVG.
```

### Timing Helpers

```
speakDelayMs(text)
  → number (milliseconds)
  Approximate reading time for a speech bubble before it fades.
  ~reading speed: 1200ms base + 60ms per word.

thoughtDelayMs(thoughtStat)
  → number (milliseconds)
  How long before a gator generates another thought.
  Formula: (20000 / thoughtStat) × (0.5 + random × 1.0)
  Range: stat=1 → 10–30s;  stat=5 → 2–6s;  stat=10 → 1–3s
```

### Display Helpers

```
relationEmoji(value)  → '❤️' | '💛' | '🤍' | '💔'
  value >= 50  → ❤️ (loves)
  value >= 10  → 💛 (likes)
  value >= -10 → 🤍 (neutral)
  value <  -10 → 💔 (dislikes)

relationColor(value)  → CSS color string
  Positive = green tint, negative = red tint, neutral = gray
```

---

## 8. simulation.js — The Brain

**Purpose:** The central orchestration module. Contains:
- The `tick()` function (called every 2.2s by `setInterval`)
- The `gameLoop()` function (called every ~16ms by `requestAnimationFrame`)
- `initSimulation()` — the exported entry point called from `main.js`
- `spawnGators()` — rebuilds the entire simulation from scratch
- `logChat()` — logs speech, updates chatLogs, broadcasts overhearing

### The Tick Loop (simulation.js `tick()`)

Called every `TICK_MS` milliseconds. Here is the full decision tree in order:

```
tick()
  │
  ├── EARLY RETURN: if gamePhase === OVER or paused
  │
  ├── Decrement state.cycleTimer
  │   If cycleTimer <= 0:
  │     DAY    → triggerNightfall()
  │     NIGHT  → triggerDawn()
  │     DAWN   → triggerDebate()
  │     DEBATE → triggerVote()
  │     VOTE   → triggerExecute()
  │     return
  │
  ├── Conversation-limit nightfall check:
  │   If dayEndTimerActive && Date.now() >= dayEndTimerExpiresAt:
  │     state.noNewConversations = true
  │   If noNewConversations:
  │     Force-abort any hosting/visiting sessions (ticksLeft = 1)
  │     If no gators are talking → triggerNightfall() immediately
  │
  ├── HOME_WARN_TICKS: at HOME_WARN_TICKS left in day:
  │     End all conversations, send everyone home
  │
  ├── VOTE phase: advance vote cursor on timer
  │
  ├── EXECUTE phase: watch condemned walk to center, then finaliseExecution()
  │
  ├── Per-gator loop (for each living gator):
  │   │
  │   ├── Decrement ticksLeft
  │   │
  │   ├── DEBATING: Generate accusation message on speakCooldown timer
  │   │
  │   ├── SKIP if ticksLeft > 0 (still mid-activity)
  │   │
  │   ├── END TALKING:
  │   │     Wait for AI call / playback / 3s hold to finish
  │   │     driftRelations(a, b)
  │   │     recordMemory for both
  │   │     _maybeShareOpinion(a, b)
  │   │     _onConversationCompleted()
  │   │
  │   ├── END HOSTING:
  │   │     Wait for AI drain to finish
  │   │     Release all guests
  │   │     applyTopicRelationDelta()
  │   │     onHostingComplete()
  │   │
  │   ├── END VISITING:
  │   │     Release gator back to 'moving'
  │   │
  │   └── Choose next activity:
  │         weightedPick(socialWeights(gator))
  │         'talking'  → find eligible nearby partner, requestFullConversation()
  │         'hosting'  → find a free guest, send them to the door
  │         'moving'   → pick a new random target position
  │
  └── renderAllGators() + updateStats()
```

### The Animation Loop (simulation.js `gameLoop()`)

Called ~60fps via `requestAnimationFrame`. Responsible ONLY for visual updates:

```
gameLoop()
  │
  ├── SKIP: if state.paused (but loop continues — gators stay visible!)
  │
  ├── For each gator:
  │   │
  │   ├── EXECUTE phase: only move the condemned gator
  │   │
  │   ├── 'resting':   snap to house, mark indoors=true
  │   │
  │   ├── 'hosting':   walk to door → once inside, gentle drift within enclosure
  │   │
  │   ├── 'visiting':  walk to host's door → drift within enclosure
  │   │
  │   ├── 'debating':  walk toward targetX/Y (debate position near door)
  │   │
  │   ├── 'talking':
  │   │     if _conversationFrozen → do nothing (frozen during AI call)
  │   │     else → inch toward partner until GATOR_SIZE×0.6 apart
  │   │
  │   └── default ('moving'):
  │         move toward targetX/Y at p.speed px/frame
  │         on arrival: pick a new random target
  │
  ├── Update el.style.left/top for each gator
  ├── Update speech bubble positions
  ├── Toggle 'indoors' / 'indoors-private' CSS classes
  │
  └── syncTalkLines()  → draw/remove SVG lines between talking pairs
```

### Key Exported Functions

| Function | Called From | Purpose |
|---|---|---|
| `initSimulation()` | `main.js` → HTML | Boot the whole simulation |
| `testConversation()` | Debug button | Force a conversation between 2 random gators |
| `logChat(speaker, targetId, message, thought, isPrivate)` | `agentQueue.js` | Log speech + broadcast overhearing |

### Key Private Functions

| Function | Purpose |
|---|---|
| `spawnGators()` | Destroy and rebuild entire simulation |
| `tick()` | Main 2.2s logic step |
| `gameLoop()` | 60fps animation frame |
| `_onConversationCompleted()` | Called after each full conversation finishes |
| `_maybeShareOpinion(speaker, listener)` | 30% chance to gossip about a third gator after a conversation |
| `startAll()` / `stopAll()` | Start/stop both tick and rAF loops |

---

## 9. phases.js — Phase Transitions

**Purpose:** One exported function per game phase transition.
Each function is responsible for setting the next phase state, triggering visual effects,
and firing any AI calls needed for that phase.

### Exported Functions

```
triggerNightfall()
  Sets gamePhase = 'Night'
  Selects murder victim (murderVictim())
  Sends all gators home (indoors = true, activity = 'resting')
  Clears all talk lines
  Shows night overlay
  Calls requestNightReport() — waits for user to click "Continue"

triggerDawn()
  Sets gamePhase = 'Dawn'
  Adds nightVictimId to deadIds
  Shows dead body marker (showDeadBody())
  Sends all gators back outside
  Generates reaction messages for each gator
  dayNumber++

triggerDebate()
  Sets gamePhase = 'Debate'
  Positions all gators at their house doors
  Seeds suspicion from current relationship scores
  Staggers each gator's first speech with real-time delays

triggerVote()
  Sorts gators into clockwise vote order (by homeIndex)
  Sets state.voteOrder[], voteIndex = 0
  Calls showNextVoter() to begin sequential display

showNextVoter()
  Reads state.voteOrder[state.voteIndex]
  Calls agentQueue.requestVote() (always returns null — vote is pure JS)
  Falls back to JS vote logic: highest suspicion target
  Records vote in state.voteResults[suspectId]++
  Advances voteIndex

triggerExecute()
  Tallies state.voteResults
  Finds the most-voted gator (ties → no execution)
  Sets state.condemnedId

finaliseExecution()
  Adds condemnedId to deadIds
  Sets deathType = 'executed'
  Checks win conditions:
	killer in deadIds → gamePhase = 'Over', TOWN WINS
	living().length <= 1 → gamePhase = 'Over', MURDERER WINS
	else → back to Day (cycleTimer = DAY_TICKS, reset counters)

pickDebateSuspect(gator)
  Returns the best target for a gator to accuse during debate.
  Murderer: prefers innocents already suspected by others (safer deflection)
  Towngator: prefers whoever they personally suspect most
```

---

## 10. rendering.js — DOM Layer

**Purpose:** All DOM reads and writes go through this module.
No other module should directly manipulate DOM elements.

```
updateStats()
  Refreshes the activity count bar:
  "👥 Alive: 5  💬 talking: 2  🚶 moving: 3"

updatePhaseLabel()
  Updates the phase label + nightfall timer pill.
  Shows countdown in mm:ss format.
  Turns red at ≤10 seconds.

renderGator(gator)
  Sets activity CSS class on the gator's DOM element.
  Updates speech bubble text and visibility.
  Updates thought bubble text and visibility.

renderAllGators()
  Calls renderGator() for every living gator.

updateHouseGuests()
  Refreshes the guest badge (👥 2) on each house door label.

syncTalkLines()
  Called from gameLoop() every frame.
  Draws SVG lines between chatting pairs.
  Removes lines for pairs that finished talking.

initTooltip()  /  showTooltip(gator, x, y)  /  moveTooltip(x, y)
hideTooltip()  /  pinTooltip(event, gator)  /  refreshPinnedTooltip()
  Floating stat-card tooltip system.
  Shows gator name, personality, relations, suspicion scores,
  topic opinions, and full chat log.

showDeadBody(gatorId)
  Places a 💀 overlay marker at the death position.

cleanPrivateChatBubbles()
  Removes DOM enclosures for hosting pairs that have ended.
```

---

## 11. agentQueue.js — AI Orchestration

**Purpose:** The traffic controller between the simulation and the AI backend.

### The Three Responsibilities

```
1. CONVERSATION MUTEX
   _conversationInProgress flag
   Prevents two AI conversations from running simultaneously.

2. MEMORY BUFFER
   _memoryBuffer: Map<alligatorId, MemoryEntry[]>
   Stores events locally until the next conversation starts.
   Then flushes them to the server in one batch call.

3. CONVERSATION PLAYBACK
   _drainNextConvTurn(initiator, responder)
   Shows one AI turn every 2.2–4 seconds.
   Manages thinking bubbles, speech bubbles, and the 3-second hold.
```

### Exported Functions

```
requestFullConversation(initiator, responder, openingLine, maxTurns, context, isPrivate, onComplete)
  → The main AI conversation function.
  → Locks mutex, flushes memories, sends AI request, plays back turns.
  → See ARCHITECTURE.md §6 for the full pipeline diagram.

recordMemory(alligatorId, day, type, detail, relatedId)
  → Buffers one memory entry locally. No network call.
  → Example: recordMemory(3, 2, 'overheard', 'Heard Bobby say I suspect Rex', 0)

requestDialog()
  → Intentionally a no-op stub. Per-line dialog calls were replaced by
	requestFullConversation(). This stub exists for any old call sites.

requestVote()
  → Always returns null. Voting is now pure JS (not AI-driven).
  → Kept for backward compatibility.

requestNightReport()
  → Fetches night reflections for all living gators.
  → Returns a Promise that resolves when user clicks "Continue to Morning."

setTickFunction(tickFn)
  → Called once from initSimulation() to provide the tick() reference.
  → Needed to restart the tick interval after AI calls without a circular import.

drainNextConvTurn(initiator, responder)
  → Public wrapper around _drainNextConvTurn. Called externally when needed.
```

---

## 12. agentBridge.js — HTTP Client

**Purpose:** The ONLY file that calls `fetch()`. All HTTP calls are centralised here.

```
isAgentAvailable()  → always true (server-side approach)

getAgentDialog(alligatorId, dialogType, targetId, context)
  → POST /api/agent/dialog
  → Returns { spoken, thought }

getAgentVote(alligatorId, candidateIds, debateSummary)
  → POST /api/agent/vote
  → Returns voteForId (number) or null

addAgentMemory()
  → No-op. Memories are buffered locally and sent via flushMemories().

flushMemories(alligatorId, entries)
  → POST /api/agent/memory/batch
  → Sends all buffered memory entries for one gator to the server.

getFullConversation(initiatorId, responderId, openingLine, maxTurns, context)
  → POST /api/agent/conversation
  → Returns array of {speakerGatorId, speech, thought} turns.

getNightReport(aliveIds)
  → POST /api/agent/night-report
  → Returns array of {alligatorId, topSuspectName, suspicionReason, innerThought}.
```

**All functions log their payloads to the console:**
```
[AGENT ➡️ SEND] conversation {...}
[AGENT ⬅️ RECV] conversation 6 turns
```

---

## 13. The Person Object — Complete Field Reference

Every living alligator is a plain JS object in `state.gators[]`.
All fields are set by `createGator()` in `gator.js`.

```javascript
{
  // ── Identity ────────────────────────────────────────────────────
  id:            0,              // Integer, assigned from state.nextId++
  name:          "Bobby",        // From NAMES constant array
  color:         "hsl(210,63%,52%)", // Accent colour for talk lines
  personality:   "cheerful",     // 'cheerful'|'grumpy'|'lazy'|'energetic'|'introvert'|'extrovert'
  homeIndex:     0,              // Which house slot (0-based). Also vote order.
  liar:          false,          // true for murderer + ~15% of towngators

  // ── Position (managed by gameLoop every ~16ms) ─────────────────
  x:       250,                  // Current pixel X on #world canvas
  y:       180,                  // Current pixel Y
  targetX: 400,                  // Destination X — gameLoop moves toward this
  targetY: 300,                  // Destination Y
  speed:   1.6,                  // Pixels per animation frame (from WALK_SPEED[personality])

  // ── Activity (managed by tick every 2.2s) ──────────────────────
  activity:      "moving",       // 'moving'|'talking'|'hosting'|'visiting'|'resting'|'debating'
  talkingTo:     null,           // ID of conversation partner, or null
  ticksLeft:     3,              // Ticks remaining in current activity
  indoors:       false,          // True while inside a house
  guestOfIndex:  null,           // homeIndex of the house being visited, or null

  // ── Social need ─────────────────────────────────────────────────
  socialNeed:    55,             // 0–100; drains while idle, refills while talking

  // ── Relationships ────────────────────────────────────────────────
  relations:          { 1: -35, 2: 20 },   // True feelings (-100 to +100)
  perceivedRelations: { 1:  30, 2: 20 },   // What this gator SHOWS others
  suspicion:          { 1: 60 },           // Murder suspicion per gator (0–100)
  conviction:         55,                  // How sure they are about their top suspect (0–100)

  // ── Social history ───────────────────────────────────────────────
  met:            new Set([1]),            // IDs of gators they've met (at least once)
  recentTalkWith: { 1: 1712001234567 },   // Date.now() of last conversation with each gator

  // ── Thoughts & speech timing ─────────────────────────────────────
  thoughtStat:   6,              // 1–10; governs thought frequency (set at spawn)
  nextSpeakAt:   1712001000000,  // Date.now() threshold; gator won't speak before this
  nextThoughtAt: 1712001010000,  // Date.now() threshold; gator won't think before this
  message:       null,           // Current speech bubble text (null = no bubble)
  thought:       null,           // Current thought text (visible in detail panel)

  // ── Topic opinions ───────────────────────────────────────────────
  topicOpinions: {
	sports_team:             "Rockets",  // string: which team they support
	swamp_leadership:        -40,         // -100..+100
	local_gossip:             20,
	favorite_swamp_activity:  60
  },

  // ── History logs ─────────────────────────────────────────────────
  chatLog:  [],   // [{day, from, to, message, thought, ts, type}]
				  // type: 'said'|'private'|'overheard'|'thought'
  history:  [],   // [{day, type, detail, with, about, sentiment, ...}]
				  // Significant events: talked, first_meeting, lied, voted, ...
  gameLog:  [],   // [{day, type, detail, ts}]  timestamped action log

  // ── Appearance ───────────────────────────────────────────────────
  appearance: {
	skinTone:   "#7ec8a0",
	hatStyle:   "cap",          // 'cap'|'beanie'|'tophat'|'hood'|'none'
	hatColor:   "#3a7bd5",
	shirtColor: "#e74c3c",
	headSize:   14,             // SVG head circle radius
	bodyHeight: 22,             // SVG body line length
	legLength:  18,
	armAngle:   0.4
  },

  // ── Conversation playback (set by agentQueue, temporary) ─────────
  isWaiting:           false,  // true while AI fetch is in-flight (shows "..." bubble)
  _convTurns:          null,   // Array of AI turns being drained
  _convTurnIndex:      0,      // Index of next turn to display
  _convPartner:        null,   // Reference to the other Person in this conversation
  _convIsPrivate:      false,  // true for hosting conversations
  _convOnComplete:     null,   // Callback fired after all turns + 3s hold
  _convHolding:        false,  // true during the 3-second final hold
  _conversationFrozen: false,  // true while AI is fetching (gameLoop skips movement)

  // ── Death info (set when eliminated) ─────────────────────────────
  deathDay:    null,    // Day they died
  deathOrder:  null,    // 1st, 2nd, 3rd... to die
  deathType:   null     // 'murdered' | 'executed'
}
```

---

## 14. Common Patterns

### Pattern 1 — Getting Only Living Gators

```javascript
// ✅ Correct
import { living } from './gator.js';
const alive = living();  // Returns only gators not in state.deadIds

// ❌ Wrong — includes dead gators
const all = state.gators;
```

### Pattern 2 — Recording a Memory

```javascript
// agentQueue.recordMemory(gatorId, day, type, detail, relatedGatorId)
recordMemory(gator.id, state.dayNumber, 'overheard',
  `Overheard ${speaker.name} say: "${message}"`, speaker.id);

// This is synchronous and cheap — it just pushes to a local Map.
// The memory is sent to the server the next time a conversation starts.
```

### Pattern 3 — Starting a Conversation

```javascript
// In simulation.js tick() — standard (public) conversation
requestFullConversation(
	gatorA,         // initiator Person object
	gatorB,         // responder Person object
	openingLine,    // e.g. "Hey Bobby!"
	6,              // maxTurns
	null,           // context string (null = auto-generated on server)
	false,          // isPrivate (false = public, overhearing possible)
	_onConversationCompleted  // callback
);

// Hosting (private) conversation
requestFullConversation(gatorA, guest, openingLine, 6, topicCtx,
	true,           // isPrivate = true (no overhearing)
	onHostingComplete);
```

### Pattern 4 — Checking Phase

```javascript
import { PHASE } from './gameConfig.js';
import { state }  from './state.js';

if (state.gamePhase === PHASE.DAY)    { /* day logic */ }
if (state.gamePhase === PHASE.NIGHT)  { /* night logic */ }
```

### Pattern 5 — Weighted Random Activity

```javascript
import { weightedPick } from './helpers.js';
import { socialWeights } from './gator.js';

// Pick next activity based on gator's personality weights
const next = weightedPick(socialWeights(gator));
// next might be 'talking', 'hosting', 'moving', 'resting'
```

---

## 15. Debugging Tips

### See What the AI Is Sending/Receiving

Open the browser console. Every AI request/response is logged:
```
[AGENT ➡️ SEND] conversation {initiatorId: 0, responderId: 2, openingLine: "Hey!", ...}
[AGENT ⬅️ RECV] conversation for gator 0: [{speakerGatorId: 0, speech: "Hey!", thought: "..."}, ...]
```

### Inspect a Gator's State

In the browser console:
```javascript
// Get all living gators
import('./js/gator.js').then(m => console.log(m.living()));

// Or via the global state (available in simulation.js scope)
// Hover over a gator and click to pin the tooltip — this shows their full stats.
```

### Force a Conversation

Click the **🧪 Test Conv** button to immediately start a conversation between
two random living gators. Their positions are set to the center of the stage.

### Speed Up Testing

In `GameConstants.cs`:
```csharp
public const int GatorCount         = 2;    // Fewer gators = faster debug cycles
public const int ConvLimitForNightfall = 2; // Nightfall after only 2 conversations
public const int NightfallDelayMs   = 5000; // 5 seconds instead of 3 minutes
public const int DebateTicks        = 4;    // Shorter debate phase
```

### Add Logging to tick()

`simulation.js tick()` runs every 2.2s. Add a `console.log` inside it temporarily:
```javascript
function tick() {
	console.log(`[tick] phase=${state.gamePhase} timer=${state.cycleTimer} convs=${state.completedConvCount}`);
	// ...
}
```

---

*Next: [BACKEND.md](BACKEND.md) — .NET project reference*
*Back: [ARCHITECTURE.md](ARCHITECTURE.md) — System design overview*
