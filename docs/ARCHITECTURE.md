# 🏗️ Swamp of Salem — Architecture Deep Dive

> **Audience:** Junior developers joining the project.
> **Goal:** After reading this document you should understand how every layer of the
> system fits together, why each design decision was made, and where to look when
> something goes wrong.

---

## Table of Contents

1. [Big Picture — Four Layers](#1-big-picture--four-layers)
2. [Request Lifecycle](#2-request-lifecycle)
3. [The Two Clocks](#3-the-two-clocks)
4. [State Management](#4-state-management)
5. [The Constant Bridge](#5-the-constant-bridge-c--javascript)
6. [Conversation Pipeline](#6-conversation-pipeline)
7. [Memory System](#7-memory-system)
8. [Phase State Machine](#8-phase-state-machine)
9. [Circular Import Problem & Solution](#9-circular-import-problem--solution)
10. [Dependency Injection Setup](#10-dependency-injection-setup)
11. [Error Handling Strategy](#11-error-handling-strategy)
12. [Key Design Decisions — Why?](#12-key-design-decisions--why)

---

## 1. Big Picture — Four Layers

The entire application is structured in four layers that each have one clear job:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  LAYER 1 — FRONTEND (Browser)                                            │
│                                                                          │
│  Vanilla JavaScript ES Modules — no framework, no build step             │
│                                                                          │
│  Responsibilities:                                                       │
│    • Rendering 60fps animation via requestAnimationFrame                 │
│    • Running the simulation tick loop (every 2.2 seconds)                │
│    • Managing per-gator state (position, activity, conversations)        │
│    • Driving phase transitions based on timers                           │
│    • Buffering AI memories locally and flushing before AI calls          │
│                                                                          │
│  Does NOT:                                                               │
│    • Talk directly to an LLM                                             │
│    • Know which gator is the murderer until the game ends                │
│    • Hard-code any timing or balance constants                           │
└──────────────────────────────────────────────────────────────────────────┘
				   │  HTTP fetch() calls (JSON)
				   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  LAYER 2 — WEB HOST (ASP.NET Core 10, Program.cs)                        │
│                                                                          │
│  Minimal API — all endpoints are lambdas in Program.cs (~300 lines)      │
│                                                                          │
│  Responsibilities:                                                       │
│    • Serving static files (JS, CSS, HTML)                                │
│    • Deserializing inbound DTOs                                          │
│    • Delegating AI work to GatorAgentService (injected via DI)           │
│    • Injecting GameConfig JSON into index.html at startup                │
│    • Providing /api/config health check                                  │
│                                                                          │
│  Does NOT:                                                               │
│    • Contain game logic (that's AppLogic)                                │
│    • Contain AI logic (that's SK)                                        │
└──────────────────────────────────────────────────────────────────────────┘
				   │  Dependency Injection
				   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  LAYER 3 — APP LOGIC (SwampOfSalem.AppLogic)                             │
│                                                                          │
│  Pure C# — no ASP.NET, no AI, no external packages                       │
│                                                                          │
│  Responsibilities:                                                       │
│    • All numeric game constants (single source of truth)                 │
│    • C# → JSON serialisation of those constants for the browser          │
│    • Pure service algorithms: murder victim selection, vote tallying,    │
│      relationship drift, phase management                                │
│                                                                          │
│  Does NOT:                                                               │
│    • Make HTTP calls                                                     │
│    • Call AI / Semantic Kernel                                           │
└──────────────────────────────────────────────────────────────────────────┘
				   │  Dependency Injection
				   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  LAYER 4 — AI AGENTS (SwampOfSalem.SK)                                   │
│                                                                          │
│  Semantic Kernel — one ChatCompletionAgent per living gator              │
│                                                                          │
│  Responsibilities:                                                       │
│    • Maintaining per-gator ChatHistory (persistent memory)               │
│    • Generating full multi-turn conversations in one AI call             │
│    • Generating night reflections (parallel AI calls)                    │
│    • Accepting batched memories and injecting them into agent history    │
│                                                                          │
│  Does NOT:                                                               │
│    • Know about HTTP, routing, or ASP.NET                                │
│    • Access the database or file system                                  │
└──────────────────────────────────────────────────────────────────────────┘
				   │  Semantic Kernel → LLM provider
				   ▼
			   Azure OpenAI / OpenAI-compatible / Local model
```

---

## 2. Request Lifecycle

Here is what happens when two gators start a conversation, traced end-to-end through all four layers:

```
═══════════════════════════════════════════════════════════════════════════
STEP 1 — TRIGGER (Browser / simulation.js)
═══════════════════════════════════════════════════════════════════════════

  Every 2.2s: tick() runs in simulation.js
	→ Gator A's ticksLeft reaches 0 while activity='talking'
	→ Gator B is within TALK_DIST pixels
	→ state.activeConversation == false (no other AI conv running)
	→ calls: requestFullConversation(a, b, openingLine, maxTurns, context)

═══════════════════════════════════════════════════════════════════════════
STEP 2 — PRE-FLIGHT (Browser / agentQueue.js)
═══════════════════════════════════════════════════════════════════════════

  agentQueue.requestFullConversation():
	1. Check _conversationInProgress mutex → abort if locked
	2. Set _conversationInProgress = true
	3. Pause simulation (state.paused = true, clear setInterval)
	4. Freeze both gators (_conversationFrozen = true)
	5. Show thinking bubbles (isWaiting = true on both)
	6. await Promise.all([flushMemories(a.id), flushMemories(b.id)])
		 → POST /api/agent/memory/batch  ×2

═══════════════════════════════════════════════════════════════════════════
STEP 3 — MEMORY FLUSH (Server / Program.cs + GatorAgentService)
═══════════════════════════════════════════════════════════════════════════

  POST /api/agent/memory/batch  body: { alligatorId, entries[] }
	→ GatorAgentService.AddMemory(alligatorId, entry)
	→ Formats each entry as a ChatHistory user message:
		"Day 3: You overheard Greta say 'Watch out for Rex.'"
	→ history[alligatorId].AddUserMessage(formatted)

═══════════════════════════════════════════════════════════════════════════
STEP 4 — AI CALL (Browser → Server → LLM)
═══════════════════════════════════════════════════════════════════════════

  agentBridge.getFullConversation(a.id, b.id, openingLine, maxTurns, context)
	→ POST /api/agent/conversation
		 body: {
		   initiatorId: 0, responderId: 2,
		   openingLine: "Hey Greta!",
		   maxTurns: 6,
		   context: "Private visit at Bobby's home..."
		 }

  Server: GatorAgentService.GenerateFullConversationAsync()
	→ Looks up both agents in _agents dictionary
	→ BuildContextMessage():
		"Day 3 | Phase: Day | Bobby talking to Greta"
		"Bobby's feelings toward Greta: +45 (likes)"
		"Greta's feelings toward Bobby: +20 (likes)"
		"Context: Private visit..."
	→ history[initiatorId].AddUserMessage(contextMessage)
	→ Single Semantic Kernel invoke:
		"Generate a {maxTurns}-turn conversation. Return JSON array."
	→ LLM returns:
		[
		  { "speakerName": "Bobby", "speech": "Come in, Greta!", "thought": "I hope she likes my house." },
		  { "speakerName": "Greta", "speech": "Thanks Bobby!", "thought": "Hmm, this place is messy." },
		  ...
		]
	→ ParseConversationMessages() — defensive JSON extraction
	→ Map speaker names → gator IDs
	→ Return ChatConversationResponse { turns: [...] }

═══════════════════════════════════════════════════════════════════════════
STEP 5 — PLAYBACK (Browser / agentQueue._drainNextConvTurn)
═══════════════════════════════════════════════════════════════════════════

  Turns arrive → stored on initiator._convTurns[]
  Simulation unpauses
  _drainNextConvTurn() plays one turn every 2.2–4 seconds:
	┌─ for each turn:
	│    speaker.message = turn.speech    ← speech bubble appears
	│    speaker.thought = turn.thought   ← thought panel updates
	│    logChat(speaker, listener, ...)  ← chatLog + overhearing
	└─ after last turn: 3-second hold
		 → initiator._convHolding = false
		 → _conversationInProgress = false
		 → onComplete() called  ← triggers _onConversationCompleted()
```

---

## 3. The Two Clocks

The simulation uses **two independent timers** that run at completely different speeds.
Understanding why requires knowing what each clock is responsible for:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CLOCK 1: setInterval(tick, 2200ms)           LOGICAL clock             │
│                                                                         │
│  Fires every 2.2 seconds.                                               │
│  Updates "what should happen" — not "where things are on screen."       │
│                                                                         │
│  Handled by:  simulation.js tick()                                      │
│                                                                         │
│  Examples of what it manages:                                           │
│    ✓ Decrement cycleTimer (triggers phase changes when it hits 0)       │
│    ✓ Move a gator from activity 'moving' to 'talking'                   │
│    ✓ Start or end a conversation                                        │
│    ✓ Trigger nightfall when conv count limit + timer expires            │
│    ✓ Advance the vote cursor                                            │
│    ✗ Does NOT move pixels on screen                                     │
│    ✗ Does NOT update el.style.left / el.style.top                       │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  CLOCK 2: requestAnimationFrame(gameLoop)     VISUAL clock              │
│                                                                         │
│  Fires ~60 times per second (every ~16ms).                              │
│  Updates "where things look on screen" — not "what they're doing."      │
│                                                                         │
│  Handled by:  simulation.js gameLoop()                                  │
│                                                                         │
│  Examples of what it manages:                                           │
│    ✓ Move each gator a tiny step toward their targetX/targetY           │
│    ✓ Update el.style.left = `${p.x}px`                                  │
│    ✓ Move speech bubbles to track their gator                           │
│    ✓ Draw talk-lines between chatting pairs                             │
│    ✗ Does NOT decide what a gator is doing next                         │
│    ✗ Does NOT start or end conversations                                │
└─────────────────────────────────────────────────────────────────────────┘

WHY SEPARATE?
  Without separation, gators would teleport in 2.2-second jumps.
  With separation, tick() sets the *destination* (targetX/Y)
  and gameLoop() glides the gator toward it smoothly at 60fps.

  Pause behaviour:
	state.paused = true
	  → clearInterval (stops tick — no logic)
	  → gameLoop still runs (rAF continues — sprites stay on screen)
	  → Gators freeze visually because targetX = x (no destination change)
```

---

## 4. State Management

There is no Redux, no Zustand, no Vuex. The entire front-end state lives in one plain JS object exported from `state.js`:

```javascript
// state.js — the single source of truth
export const state = {
	gators:       [],   // All Person objects (alive + dead)
	houses:       [],   // House layout positions
	gamePhase:    'Day',
	murdererId:   null,
	deadIds:      new Set(),
	activeConversation: false,  // MUTEX: only 1 AI conv at a time
	// ... (see state.js for full list)
};
```

### Why Not a Framework?

```
React/Vue/Svelte ─► Re-render when state changes ─► Virtual DOM diffing
													  ↓
											Too slow for 60fps canvas

Swamp of Salem  ─► 60fps rAF loop reads state directly ─► Zero overhead
				   Tick loop mutates state directly      ─► Zero overhead
				   DOM updates only happen when needed   ─► Minimal work
```

### The Global Conversation Mutex

The most important piece of shared state is the conversation lock:

```
state.activeConversation  (in state.js)
_conversationInProgress   (private in agentQueue.js)

These are two separate flags that work together:
  state.activeConversation  → read by simulation.js to prevent NEW conversations starting
  _conversationInProgress   → read by agentQueue.js to prevent NEW AI calls starting

Both are set to true at conversation start and false after onComplete() fires.

  ┌────────────────────────────────────────────────────────────────────┐
  │  Why two flags?                                                    │
  │                                                                    │
  │  state.activeConversation is reset by simulation.js logic         │
  │  (e.g. in _onConversationCompleted and during forced nightfall)   │
  │                                                                    │
  │  _conversationInProgress is reset by agentQueue.js after the      │
  │  final turn + 3-second hold. This is the "real" lock.             │
  │                                                                    │
  │  Having separate flags means state.js doesn't need to import      │
  │  agentQueue.js (which would create a circular dependency).        │
  └────────────────────────────────────────────────────────────────────┘
```

---

## 5. The Constant Bridge: C# → JavaScript

**THE RULE: No magic numbers in JavaScript.** All tuning constants live in C# and flow to JS automatically.

```
┌─────────────────────────────────────────────┐
│  SwampOfSalem.AppLogic/Constants/           │
│                                             │
│  GameConstants.cs                           │
│    public const int GatorCount = 6;         │
│    public const int TickMs = 2200;          │
│    public const int TalkDist = 300;         │
│    ...                                      │
│                                             │
│  PersonalityConstants.cs                   │
│    ActivityWeights["extrovert"]["talking"]  │
│    = 72  (extroverts love talking)          │
│    ...                                      │
└──────────────────────┬──────────────────────┘
					   │  GameConfigProvider.GetConfigJson()
					   │  Serialises ALL constant fields via reflection
					   ▼
┌─────────────────────────────────────────────┐
│  SwampOfSalem.Web/Program.cs                │
│                                             │
│  GET /api/game-config                       │
│    → return GameConfigProvider              │
│         .GetConfigJson()                    │
│                                             │
│  index.html is served with:                 │
│    <script>                                 │
│      window.GameConfig = {JSON};            │
│    </script>                                │
└──────────────────────┬──────────────────────┘
					   │  Loaded before any ES module
					   ▼
┌─────────────────────────────────────────────┐
│  SwampOfSalem.Web/wwwroot/js/gameConfig.js  │
│                                             │
│  const G = window.GameConfig;              │
│  export const TICK_MS   = G.TICK_MS;       │
│  export const TALK_DIST = G.TALK_DIST;     │
│  export const GATOR_COUNT = G.GATOR_COUNT; │
│  ...                                        │
└──────────────────────┬──────────────────────┘
					   │  ES Module imports
					   ▼
				  simulation.js, phases.js,
				  rendering.js, helpers.js, ...
				  All import from gameConfig.js

RESULT: Change GatorCount from 6 → 8 in ONE C# file.
		All JS code automatically uses the new value.
		No JS changes required.
```

---

## 6. Conversation Pipeline

The full pipeline from "two gators are near each other" to "both gators walk away":

```
╔═══════════════════════════════════════════════════════════════════╗
║  STAGE A — TRIGGER                                                ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  simulation.js tick():                                            ║
║    • Both gators are 'free' (not locked in another activity)     ║
║    • Distance between them ≤ TALK_DIST pixels                    ║
║    • Neither has talked to the other within 60 seconds           ║
║    • state.activeConversation == false                           ║
║    • state.noNewConversations == false                           ║
║                                                                   ║
║  Set:                                                             ║
║    gator.activity  = 'talking'                                    ║
║    gator.talkingTo = partner.id                                   ║
║    state.activeConversation = true                                ║
║                                                                   ║
╠═══════════════════════════════════════════════════════════════════╣
║  STAGE B — APPROACH                                               ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  gameLoop() (60fps):                                              ║
║    • Both gators inch toward each other until d ≤ GATOR_SIZE×0.6║
║    • Then freeze: p.targetX = p.x (stop drifting)               ║
║                                                                   ║
╠═══════════════════════════════════════════════════════════════════╣
║  STAGE C — AI REQUEST                                             ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  agentQueue.requestFullConversation():                            ║
║    1. Lock _conversationInProgress = true                         ║
║    2. Pause simulation                                            ║
║    3. Freeze both gators in place                                 ║
║    4. Show "..." thinking bubbles                                 ║
║    5. Flush memories → POST /api/agent/memory/batch              ║
║    6. Send → POST /api/agent/conversation                        ║
║                                                                   ║
╠═══════════════════════════════════════════════════════════════════╣
║  STAGE D — AI GENERATION (Server-side)                            ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  GatorAgentService.GenerateFullConversationAsync():               ║
║    1. Build context string (phase, day, relations, topic, etc.)  ║
║    2. Inject context into agent ChatHistory                       ║
║    3. Single LLM call → request ALL turns at once               ║
║    4. Parse JSON response defensively                             ║
║    5. Map speaker names → gator IDs                              ║
║    6. Return [{speakerGatorId, speech, thought}, ...]            ║
║                                                                   ║
╠═══════════════════════════════════════════════════════════════════╣
║  STAGE E — PLAYBACK                                               ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  Back in browser:                                                 ║
║    1. Resume simulation (unpause)                                 ║
║    2. Load turns → initiator._convTurns[]                        ║
║    3. _drainNextConvTurn() every 2.2–4 seconds:                  ║
║         speaker.message = turn.speech   (speech bubble)          ║
║         speaker.thought = turn.thought  (thought panel)          ║
║         logChat(...)  → chatLog + overhearing                    ║
║                                                                   ║
╠═══════════════════════════════════════════════════════════════════╣
║  STAGE F — COMPLETION                                             ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  After last turn:                                                 ║
║    1. 3-second hold (_convHolding = true on both)                ║
║    2. Update recentTalkWith timestamps (60s cooldown)            ║
║    3. _conversationFrozen = false (gameLoop can move them)       ║
║    4. _convTurns = null (cleanup)                                ║
║    5. _conversationInProgress = false (unlock mutex)             ║
║    6. onComplete() → _onConversationCompleted()                  ║
║         → state.activeConversation = false                       ║
║         → state.completedConvCount++                             ║
║         → Maybe start nightfall countdown                        ║
╚═══════════════════════════════════════════════════════════════════╝
```

---

## 7. Memory System

Memories let the AI agents "remember" what happened between conversations.
Without memories, every conversation would start fresh with no context.

```
EVENT OCCURS IN SIMULATION
(e.g. overhear a conversation, witness a vote, see a murder victim)
		  │
		  ▼
agentQueue.recordMemory(alligatorId, day, type, detail, relatedId)
		  │
		  │  Stores locally — NO network call
		  │
		  ▼
_memoryBuffer  [Map: alligatorId → [{day, type, detail, relatedId}, ...]]
		  │
		  │  Lives in browser memory until the next conversation
		  │
		  ▼  (when a new conversation starts)
_flushMemoriesForGator(alligatorId)
		  │
		  ├─ If buffer is empty → do nothing (fast path)
		  │
		  ├─ Clear buffer immediately (prevents double-send)
		  │
		  ▼
POST /api/agent/memory/batch
body: {
  alligatorId: 2,
  entries: [
	{ day: 3, type: "overheard", detail: "Overheard Bobby say: 'I suspect Rex!'", relatedId: 4 },
	{ day: 3, type: "conversation_end", detail: "Finished talking with Greta", relatedId: 1 },
	{ day: 4, type: "dawn", detail: "Rex was found dead.", relatedId: 4 }
  ]
}
		  │
		  ▼
GatorAgentService.AddMemory(alligatorId, entry)
		  │
		  ▼
_histories[alligatorId].AddUserMessage(
  "Day 3: You overheard Bobby say: 'I suspect Rex!'"
)
		  │
		  │  Now part of the agent's persistent ChatHistory
		  │  The next AI call will have this context
		  ▼
Next conversation — AI "remembers" the overheard accusation
```

**Why buffer instead of send immediately?**

| Approach | Requests per day | Latency | Context freshness |
|---|---|---|---|
| Send immediately on every event | 50–200 per game | Very high | Always current |
| Buffer + flush before conversation | 2 per conversation | Low | Current at conversation start |

Buffering keeps the app fast and avoids rate-limiting while still ensuring the AI has
fresh context right before it speaks.

---

## 8. Phase State Machine

The game moves through six phases in order. Each phase has:
- A **cycleTimer** countdown (in ticks)
- A **trigger function** called when the timer hits zero
- **Special behaviors** while the phase is active

```
				 ┌─────────────────────────────┐
				 │         NEW GAME             │
				 │   resetGameState()           │
				 │   gamePhase = 'Day'          │
				 │   cycleTimer = DAY_TICKS     │
				 └─────────────┬───────────────┘
							   │
			  ┌────────────────▼────────────────────────────────────────┐
			  │  ☀️  DAY  (cycleTimer = 818 ticks, ~30 min max)          │
			  │                                                          │
			  │  Behavior: Gators roam, converse, gossip, host.          │
			  │  Nightfall triggers when EITHER:                         │
			  │    a) cycleTimer reaches 0  (max day length)             │
			  │    b) completedConvCount >= 7 AND 3-min timer expires    │
			  │       AND no conversations are in progress               │
			  └────────────────┬────────────────────────────────────────┘
							   │  triggerNightfall()
			  ┌────────────────▼────────────────────────────────────────┐
			  │  🌙 NIGHT  (cycleTimer = 2 ticks, ~4 seconds)           │
			  │                                                          │
			  │  Behavior: Murder victim selected (highest suspicion     │
			  │  of murderer gets killed). Night overlay shown.          │
			  │  Night report AI call → user reads reflections →         │
			  │  "Continue to Morning" button clicked.                   │
			  └────────────────┬────────────────────────────────────────┘
							   │  triggerDawn()
			  ┌────────────────▼────────────────────────────────────────┐
			  │  🌅 DAWN  (cycleTimer = 6 ticks, ~13 seconds)           │
			  │                                                          │
			  │  Behavior: Body revealed. All gators react.              │
			  │  Suspicion scores updated based on memory strength.      │
			  │  dayNumber++ (new day begins)                            │
			  └────────────────┬────────────────────────────────────────┘
							   │  triggerDebate()
			  ┌────────────────▼────────────────────────────────────────┐
			  │  💬 DEBATE  (cycleTimer = 14 ticks, ~30 seconds)        │
			  │                                                          │
			  │  Behavior: All gators go to their doors and accuse.      │
			  │  Each generates accusation lines on a per-gator timer.   │
			  │  Murderer targets innocents already suspected by others. │
			  │  Towngators target their highest suspicion score.        │
			  └────────────────┬────────────────────────────────────────┘
							   │  triggerVote()
			  ┌────────────────▼────────────────────────────────────────┐
			  │  🗳️  VOTE  (VOTE_DISPLAY_TICKS per voter)               │
			  │                                                          │
			  │  Behavior: Sequential clockwise voting (by homeIndex).   │
			  │  Each gator votes for highest suspicion target.          │
			  │  showNextVoter() advances cursor on a timer.             │
			  └────────────────┬────────────────────────────────────────┘
							   │  triggerExecute()
			  ┌────────────────▼────────────────────────────────────────┐
			  │  ⚰️  EXECUTE                                             │
			  │                                                          │
			  │  Behavior: Most-voted gator walks to center stage.       │
			  │  Once within 20px of center: executeTimer countdown.     │
			  │  After timer: finaliseExecution()                        │
			  │    → Add to deadIds                                      │
			  │    → Check win conditions                                │
			  │    → If game over: show overlay                          │
			  │    → Otherwise: back to Day (cycleTimer = DAY_TICKS)    │
			  └────────────────┬────────────────────────────────────────┘
							   │
			  ┌────────────────▼────────────────────────────────────────┐
			  │  Check Win Conditions                                    │
			  │                                                          │
			  │  Murderer executed?  →  TOWN WINS  🏆                   │
			  │  Murderer ≤ 2 alive? →  MURDERER WINS  🔪               │
			  │  Otherwise          →  ☀️ Back to DAY                   │
			  └──────────────────────────────────────────────────────────┘
```

---

## 9. Circular Import Problem & Solution

`agentQueue.js` and `simulation.js` need each other:

```
agentQueue.js imports:
  logChat from simulation.js   ← to log conversation turns

simulation.js imports:
  requestFullConversation      ← to start AI conversations
  recordMemory                 ← to buffer memories
  from agentQueue.js
```

This would normally create a circular ES module dependency that causes
undefined references at runtime.

**Solution: Runtime function injection**

```javascript
// simulation.js — at init time
import { setTickFunction } from './agentQueue.js';

export function initSimulation() {
	// Break the circle: hand agentQueue a direct reference to tick()
	// at runtime, AFTER both modules have fully loaded.
	setTickFunction(tick);
	// ...
}

// agentQueue.js — stores the reference
let _tickFunction = null;
export function setTickFunction(fn) {
	_tickFunction = fn;
}

// agentQueue.js — uses it to restart the sim after AI call
if (!state.tickInterval && _tickFunction) {
	state.tickInterval = setInterval(_tickFunction, TICK_MS);
}
```

`logChat` is imported normally (ES static imports resolve circular deps for
function references as long as the function is called after both modules load,
which is always true here since logChat is only called inside `_drainNextConvTurn`
which runs asynchronously after init).

---

## 10. Dependency Injection Setup

All server-side services are registered as singletons in `Program.cs`:

```csharp
// One LLM provider (Azure OpenAI or OpenAI-compatible)
builder.Services.AddSingleton<Kernel>(kernelInstance);

// One GameState per application lifetime
// (all requests share the same in-memory game state)
builder.Services.AddSingleton<GameState>();

// One GatorAgentService holds all 6 agent instances
builder.Services.AddSingleton<GatorAgentService>();

// Pure logic services (stateless — could be Transient, but Singleton is fine)
builder.Services.AddSingleton<GameConfigProvider>();
builder.Services.AddSingleton<MurderService>();
builder.Services.AddSingleton<PhaseManager>();
builder.Services.AddSingleton<RelationshipService>();
builder.Services.AddSingleton<VoteService>();
```

**Why everything is Singleton:**
- `GameState` is inherently a singleton (one game at a time).
- `GatorAgentService` must hold in-memory `ChatHistory` objects — they must persist
  across HTTP requests.
- Logic services are stateless (pure functions), so singleton wastes no resources.

---

## 11. Error Handling Strategy

The simulation is designed to **degrade gracefully** when AI calls fail:

```
agentBridge.js: All fetch() calls are wrapped in try/catch.
  On error:
	- Log warning to console: 'Agent dialog failed:', err
	- Return null / empty fallback
	- Caller receives null and falls back to scripted dialogue or no-op

agentQueue.requestFullConversation():
  On error:
	- Release both gators immediately (reset to 'moving')
	- Unfreeze both gators
	- Release conversation mutex
	- Resume simulation
	- Game continues without that conversation

GatorAgentService (C#):
  All AI calls wrapped in try/catch in Program.cs endpoints:
	return Results.Problem() on exceptions
	JS catches non-200 status and falls through to fallback

ParseConversationMessages():
  Three-layer defensive parsing:
	1. Try JSON.parse on the raw response
	2. Extract [...] substring if wrapped in markdown code fences
	3. Log "Malformed AI response" and return empty list as last resort
```

---

## 12. Key Design Decisions — Why?

### Why Minimal API (no controllers)?

The server is intentionally thin. It receives DTOs, delegates to `GatorAgentService`,
and returns results. There is no business logic in the API layer. With only 7 endpoints
that each do one thing, a full MVC controller hierarchy would add complexity with no benefit.

### Why Vanilla JS (no React/Vue)?

- The simulation runs a `requestAnimationFrame` loop at 60fps.
- It mutates gator objects in-place every frame.
- A virtual DOM reconciler would add significant overhead.
- ES Modules provide excellent code organization without a bundler.
- No build step = no Webpack config, no transpilation, no source maps needed.

### Why Single Full Conversation Call?

Making one AI call that returns all turns eliminates:
- N×2 round trips (N API calls × wait time each)
- Conversation incoherence (each separate call might contradict previous ones)
- Race conditions (multiple in-flight AI requests for the same pair)

The trade-off: the game must pause while the AI thinks. This is hidden with
thinking bubbles and the simulation is unpaused the moment the response arrives.

### Why Buffer Memories Locally?

Sending a network request for every `recordMemory()` call would generate
50–200 requests per game day. The LLM already has a latency cost; adding HTTP
latency on top of every event would make the simulation feel sluggish. Batching
brings this down to 2 requests per conversation start.

---

*Next: [FRONTEND.md](FRONTEND.md) — JavaScript module deep-dive*
*Next: [BACKEND.md](BACKEND.md) — .NET project reference*
*Next: [GAME_MECHANICS.md](GAME_MECHANICS.md) — Game rules and formulas*
