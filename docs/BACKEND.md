# ⚙️ Swamp of Salem — .NET Backend Reference

> **Audience:** Junior .NET developers who need to understand, modify, or extend the server-side code.
> **Prerequisite:** Read [ARCHITECTURE.md](ARCHITECTURE.md) for the big picture.

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Project Dependency Graph](#2-project-dependency-graph)
3. [SwampOfSalem.Shared — Contracts](#3-swampofsakemshared--contracts)
4. [SwampOfSalem.AppLogic — Game Rules](#4-swampofsakemapplogic--game-rules)
5. [SwampOfSalem.SK — AI Agents](#5-swampofsakemsk--ai-agents)
6. [SwampOfSalem.Web — Host & API](#6-swampofsakemweb--host--api)
7. [API Endpoint Reference](#7-api-endpoint-reference)
8. [The GameConfig Injection Pattern](#8-the-gameconfig-injection-pattern)
9. [Semantic Kernel Agent Lifecycle](#9-semantic-kernel-agent-lifecycle)
10. [Prompt Architecture](#10-prompt-architecture)
11. [Adding a New API Endpoint — Step by Step](#11-adding-a-new-api-endpoint--step-by-step)
12. [Security Notes](#12-security-notes)

---

## 1. Project Structure

```
SwampOfSalem/
│
├── 📦 SwampOfSalem.Shared/       ← No dependencies; shared by all projects
│   ├── DTOs/                     ← HTTP request/response contracts
│   ├── Enums/                    ← Activity, GamePhase, Personality
│   └── Models/                   ← Core domain models
│
├── ⚙️  SwampOfSalem.AppLogic/    ← Pure game logic; no AI, no web
│   ├── Constants/                ← All numeric constants (single source of truth)
│   └── Services/                 ← Stateless algorithm services
│
├── 🤖 SwampOfSalem.SK/           ← Semantic Kernel AI orchestration
│   ├── Agents/                   ← GatorAgentService (the main AI class)
│   ├── Plugins/                  ← KernelFunctions the LLM can call
│   └── Prompts/                  ← System prompt generators
│
└── 🌐 SwampOfSalem.Web/          ← ASP.NET Core host
	├── Program.cs                ← Entire server (~335 lines, no controllers)
	├── appsettings.json          ← LLM config structure
	└── wwwroot/                  ← Static files served to the browser
```

---

## 2. Project Dependency Graph

```
SwampOfSalem.Web
  ├── references SwampOfSalem.AppLogic
  ├── references SwampOfSalem.SK
  └── references SwampOfSalem.Shared

SwampOfSalem.AppLogic
  └── references SwampOfSalem.Shared

SwampOfSalem.SK
  ├── references SwampOfSalem.Shared
  └── NuGet: Microsoft.SemanticKernel
			 Microsoft.SemanticKernel.Agents.Core

SwampOfSalem.Shared
  └── (no references — leaf node)
```

> 📌 **The Shared project is the leaf node.** Nothing in `Shared` depends on anything else.
> This prevents circular dependencies. When you add a model or DTO, add it in `Shared`.

---

## 3. SwampOfSalem.Shared — Contracts

### Purpose

Pure data structures — no logic, no AI, no web code.
Every other project references `Shared` so they all speak the same language.

### DTOs — HTTP Request/Response Objects

All DTOs live in `SwampOfSalem.Shared/DTOs/`. They are plain C# records used
as API request bodies and response payloads.

| DTO File | Direction | Endpoint | Description |
|---|---|---|---|
| `AlligatorSpawnData.cs` | →  Request | `/api/agent/initialize` | One gator's setup data at game start |
| `AgentDialogRequest.cs` | →  Request | `/api/agent/dialog` | Ask one agent for one dialog line |
| `AgentDialogResponse.cs` | ← Response | `/api/agent/dialog` | Spoken text + private thought |
| `ChatConversationRequest.cs` | →  Request | `/api/agent/conversation` | Full multi-turn conversation request |
| `ChatConversationResponse.cs` | ← Response | `/api/agent/conversation` | All turns in one payload |
| `VoteRequest.cs` | →  Request | `/api/agent/vote` | Ask an agent to vote |
| `VoteResponse.cs` | ← Response | `/api/agent/vote` | Vote target ID |
| `NightReportRequest.cs` | →  Request | `/api/agent/night-report` | Trigger night reflections |
| `NightReportResponse.cs` | ← Response | `/api/agent/night-report` | All gators' night thoughts |
| `DebateRoundRequest.cs` | →  Request | *(unused in current impl)* | Debate round data |

> 💡 **Adding a new endpoint?** Create the request + response DTOs in `Shared/DTOs/` first,
> then implement the endpoint and service method.

### Enums

```csharp
// Activity.cs
public enum Activity { Moving, Talking, Hosting, Visiting, Resting, Debating }

// GamePhase.cs
public enum GamePhase { Day, Night, Dawn, Debate, Vote, Execute, GameOver }

// Personality.cs
public enum Personality { Cheerful, Grumpy, Lazy, Energetic, Introvert, Extrovert }
```

> ⚠️ These enums are serialised to/from JSON as strings (e.g. `"Day"`, `"Cheerful"`).
> The JS side uses string literals like `PHASE.DAY = 'Day'` (from `GameConstants.cs`).
> Always use `JsonStringEnumConverter` or manual lowercase mapping when serialising.

### Models

```csharp
// Alligator.cs — Server-side domain model
public class Alligator {
	public int       Id          { get; set; }
	public string    Name        { get; set; }
	public Personality Personality { get; set; }
	public bool      IsMurderer  { get; set; }  // SECRET
	public bool      IsLiar      { get; set; }
	public bool      IsAlive     { get; set; }
	public Dictionary<int, int>   Relations         { get; set; }  // -100 to +100
	public Dictionary<int, int>   PerceivedRelations { get; set; }
	public Dictionary<int, int>   Suspicion         { get; set; }  // 0–100
	public int       Money       { get; set; }
	// ... etc
}

// GameState.cs — Singleton shared between Web and SK projects
public class GameState {
	public List<Alligator>     Alligators    { get; set; }
	public GamePhase           Phase         { get; set; }
	public int                 DayNumber     { get; set; }
	public int?                MurdererId    { get; set; }
	public HashSet<int>        DeadIds       { get; set; }
	public int?                NightVictimId { get; set; }
	public List<int>           VoteOrder     { get; set; }
	public Dictionary<int,int> VoteResults   { get; set; }
}

// MemoryEntry.cs — One memory event for an AI agent
public class MemoryEntry {
	public int    Day               { get; set; }
	public string Type              { get; set; }  // 'murder', 'overheard', 'voted', etc.
	public string Detail            { get; set; }  // Human-readable description
	public int?   RelatedAlligatorId { get; set; } // Another gator's ID, if relevant
}
```

---

## 4. SwampOfSalem.AppLogic — Game Rules

### Purpose

Pure C# game logic. No ASP.NET, no Semantic Kernel, no external packages.
Everything in this project can be unit-tested without any infrastructure.

### Constants — The Single Source of Truth

All tuning values live here and are serialised to JSON for the browser
via `GameConfigProvider`. **Never hard-code numbers in the Web or JS layers.**

```
SwampOfSalem.AppLogic/Constants/

GameConstants.cs          ← Timing, sizing, phase lengths
  GatorSize               = 120    px sprite size
  GatorCount              = 6      alligators per game
  TickMs                  = 2200   ms per simulation tick
  TalkDist                = 300    px max conversation distance
  TalkStop                = 90     px face-to-face distance
  DayTicks                = 818    ticks max day length (~30 min)
  NightTicks              = 2      ticks night length (~4s)
  DawnTicks               = 6      ticks dawn length (~13s)
  DebateTicks             = 14     ticks debate length (~30s)
  ConvLimitForNightfall   = 7      conversations before nightfall timer
  NightfallDelayMs        = 180000 3-minute countdown
  HomeWarnTicks           = 5      ticks remaining at "go home!" warning
  ConvictionThreshold     = 55     suspicion score to accuse/vote against

PersonalityConstants.cs   ← Per-personality stats and weights
  ActivityWeights         { 'extrovert': { talking: 72, moving: 15, ... }, ... }
  SocialStatBase          { 'extrovert': 9, 'introvert': 4, ... }
  ThoughtStatBase         { 'grumpy': 7, 'lazy': 3, ... }
  WalkSpeed               { 'energetic': 2.2, 'lazy': 0.9, ... }
  MemoryStrength          { 'introvert': 8, 'cheerful': 4, ... }

AppearanceConstants.cs    ← Visual randomisation pools
  Names                   ['Bobby', 'Greta', 'Rex', 'Marge', 'Chomps', 'Bubba', ...]
  SkinTones               ['#7ec8a0', '#4a9e6b', ...]
  HatStyles               ['cap', 'beanie', 'tophat', 'hood', 'none']
  ShirtColors             ['#e74c3c', '#3498db', ...]
  HouseColors             ['#8B4513', '#2E8B57', ...]

RelationshipConstants.cs  ← Social dynamics
  LiarChance              = 0.15   15% of non-murderers are liars
  CompatMatrix            { 'cheerful_grumpy': -8, 'extrovert_introvert': -4, ... }
  DriftRange              [-6, +10]  min/max relation change per conversation
```

### Services

#### `GameConfigProvider` — C# → JSON Bridge

```csharp
public class GameConfigProvider {
	public string GetConfigJson() {
		// Uses reflection + manual construction to produce a flat JSON object
		// from all constants fields.
		// Returns:
		// {
		//   "GATOR_COUNT": 6,
		//   "TICK_MS": 2200,
		//   "PHASE": {"DAY": "Day", "NIGHT": "Night", ...},
		//   "ACTIVITY_WEIGHTS": {"extrovert": {"talking": 72, ...}, ...},
		//   ...
		// }
	}
}
```

#### `MurderService` — Victim Selection

```
SelectVictim(murderer, candidates)
  Scoring:
	score(candidate) =
	  (candidate.suspicion[murderer.Id] × 0.6)    ← targets highest suspectors
	  - (murderer.relations[candidate.Id] × 0.3)   ← prefers to kill disliked gators
	  + random(0, 20)                               ← small random factor

  Returns the candidate with the highest score.
```

#### `RelationshipService` — Post-Conversation Drift

```
DriftRelations(a, b)
  compat  = COMPAT_MATRIX[a.personality + "_" + b.personality]  (or 0 if not found)
  base    = compat + random(-6, +10)
  a.relations[b.Id] = clamp(a.relations[b.Id] + base, -100, +100)
  b.relations[a.Id] = clamp(b.relations[a.Id] + base, -100, +100)

  If liar: perceivedRelations[other] skewed by -(trueRelation × 0.6)
```

#### `VoteService` — Clockwise Voting

```
GetVoteOrder(alligators)
  Returns living alligators sorted by HomeIndex ascending.
  Ties broken by ID (stable sort).

TallyVotes(voteResults)
  Returns the gator ID with the most votes.
  Returns null on a tie (no execution).
```

#### `PhaseManager` — Win Condition Checking

```
CheckWinCondition(gameState)
  Returns:
	'TownWins'    if murderer is in deadIds
	'MurdererWins' if livingCount <= 1
	'Continue'    otherwise
```

---

## 5. SwampOfSalem.SK — AI Agents

### Purpose

All AI interactions go through this project.
No other project calls Semantic Kernel directly.

### GatorAgentService — The AI Backbone

This is the most complex class in the backend. It holds all six agent instances
and their persistent chat histories.

```csharp
public class GatorAgentService {
	// Four concurrent dictionaries — thread-safe for parallel night reports
	private readonly ConcurrentDictionary<int, ChatCompletionAgent> _agents;
	private readonly ConcurrentDictionary<int, ChatHistory>         _histories;
	private readonly ConcurrentDictionary<int, List<MemoryEntry>>   _memories;
	private readonly ConcurrentDictionary<int, List<string>>        _pendingTopicOpinions;

	private readonly Kernel    _kernel;      // Shared LLM connection
	private readonly GameState _gameState;   // Injected via DI
}
```

#### How Agents Are Initialized

```
POST /api/agent/initialize
  → InitializeFromSpawnData(IEnumerable<AlligatorSpawnData>)
		│
		├── _gameState.Alligators.Clear()   ← Reset game state
		│
		├── For each AlligatorSpawnData:
		│     Create Alligator domain object
		│     _gameState.Alligators.Add(gator)
		│     if (isMurderer) _gameState.MurdererId = gator.Id
		│
		├── InitializeAgents(alligators)
		│     For each living alligator:
		│       var clonedKernel = _kernel.Clone()     ← isolated kernel per agent
		│       RegisterSwampPlugin(clonedKernel, gator.Id)
		│       var systemPrompt = PersonalityPrompts.GetSystemPrompt(...)
		│       _agents[gator.Id] = new ChatCompletionAgent {
		│           Kernel = clonedKernel,
		│           Instructions = systemPrompt
		│       }
		│       _histories[gator.Id] = new ChatHistory(systemPrompt)
		│
		└── Inject topic opinions into each ChatHistory as context message
			  "Bobby's topic opinions: sports=Rockets, leadership=+40..."
```

#### GenerateFullConversationAsync — The Core AI Call

```
ChatConversationRequest {
  InitiatorId   : int
  ResponderId   : int
  OpeningLine   : string
  MaxTurns      : int  (1–9)
  Context       : string | null
}

Flow:
  1. Look up both agents + histories
  2. Build context message:
	   "Day {N} | Phase: Day | {InitiatorName} talking to {ResponderName}"
	   "Relations: {InitiatorName} feels {+XX} toward {ResponderName}"
	   "Context: {Context}"
  3. history[initiatorId].AddUserMessage(contextMessage)
  4. Invoke initiator's agent with instruction:
	   "Generate a {MaxTurns}-turn conversation between {InitiatorName} and
		{ResponderName}. Start with the opening line '{OpeningLine}'.
		Return a JSON array: [{speakerName, speech, thought}, ...]"
  5. LLM responds with JSON array
  6. ParseConversationMessages() — defensive parse
  7. Map speaker names → gator IDs (by matching against all alligator names)
  8. Store conversation in both gators' histories
  9. Return ChatConversationResponse { Messages: [...] }

Return DTO:
ChatConversationResponse {
  InitiatorId : int
  ResponderId : int
  Messages    : List<ConversationMessage>
}

ConversationMessage {
  SpeakerGatorId : int      ← mapped from speaker name
  Speech         : string   ← what was said aloud
  Thought        : string   ← private inner monologue
}
```

#### Defensive JSON Parsing — ParseConversationMessages

The AI does not always return perfectly formatted JSON. The parser
tries three strategies in order:

```
1. Direct parse:
   JsonSerializer.Deserialize<ConversationTurn[]>(rawText)

2. Markdown fence extraction:
   Find ```json ... ``` block → extract → try parse

3. Bracket extraction:
   Find first '[' and last ']' → extract → try parse

4. Last resort:
   Log "[ParseConversation] Malformed response:"
   Return empty list
   → JS client sees 0 turns → releases gators → no crash
```

#### GenerateNightReportAsync — Parallel AI Calls

Unlike conversations (one AI call), night reports fire one AI call per
living gator **in parallel**:

```csharp
var tasks = aliveIds.Select(id => GenerateSingleNightReportAsync(id));
var results = await Task.WhenAll(tasks);

// Each task:
//   Builds a night-reflection prompt
//   Calls the agent's ChatHistory with: "Reflect on today. Who do you suspect?"
//   Parses {topSuspectName, suspicionReason, innerThought}
//   Returns NightReportEntry
```

This is safe because `ConcurrentDictionary` is used for all agent storage
and each agent has its own isolated `ChatHistory`.

### SwampPlugin — KernelFunctions

The LLM can call these functions during inference to look up live game data:

```csharp
// SwampPlugin.cs
[KernelFunction]
public string GetRelationship(int myId, int otherId)
	→ "You feel: positive (+45). They show: neutral (+5)."

[KernelFunction]
public string GetSuspicion(int myId, int targetId)
	→ "You suspect them: 72/100 (very suspicious)"

[KernelFunction]
public string GetRecentMemories(int myId)
	→ "Day 2: You overheard Bobby say...\nDay 3: Rex was found dead..."

[KernelFunction]
public string GetAlligatorInfo(int targetId)
	→ "Greta | grumpy | alive | HomeIndex:2"
```

The plugin is registered on each agent's cloned kernel at initialization,
so plugin calls are scoped to the correct gator's context.

### PersonalityPrompts — System Prompt Structure

Every agent's system prompt has three parts:

```
PART 1 — Core Prompt (all agents)
  ┌──────────────────────────────────────────────────────────────────┐
  │ "You are {name}, an alligator in 'Swamp of Salem'."             │
  │ "Your personality is: {personality}."                           │
  │ "{One-sentence personality description}"                        │
  │ "YOU UNDERSTAND THIS IS A GAME. You LOVE playing."             │
  │                                                                  │
  │ Game rules (8 bullet points):                                   │
  │  - One gator is the murderer                                    │
  │  - Murderer kills one gator per night                           │
  │  - Day: talk, gossip, share suspicions                          │
  │  - Debate: accuse or defend                                     │
  │  - Vote: execute the most-suspected gator                       │
  │  - If murderer is executed → town wins                          │
  │  - If murderer is last standing → murderer wins                 │
  │                                                                  │
  │ Response format (STRICT JSON):                                  │
  │  {"spoken": "...", "thought": "..."}                           │
  └──────────────────────────────────────────────────────────────────┘

PART 2 — Murderer Secret (isMurderer only)
  ┌──────────────────────────────────────────────────────────────────┐
  │ "SECRET: You ARE the murderer. This is your most important      │
  │  secret — guard it with your life."                             │
  │ "Kill whoever suspects you most each night."                    │
  │ "During the day: act innocent, build false friendships,         │
  │  deflect suspicion onto others."                                │
  │ "In debate: name innocents others already suspect (safer)."     │
  └──────────────────────────────────────────────────────────────────┘

PART 3 — Liar Addon (isLiar && !isMurderer only)
  ┌──────────────────────────────────────────────────────────────────┐
  │ "You are a naturally deceptive gator."                          │
  │ "You sometimes spread false rumours about gators you dislike."  │
  │ "You occasionally pretend to like gators you actually dislike." │
  └──────────────────────────────────────────────────────────────────┘
```

**Per-Personality Descriptions:**

| Personality | System Prompt Description |
|---|---|
| Cheerful | "You are upbeat, friendly, and see the best in everyone. You use positive language and rarely say negative things even when you think them." |
| Grumpy | "You are blunt, irritable, and always suspicious. You voice complaints freely and hold grudges." |
| Lazy | "You are laid-back, vague, and easily distracted. You give short answers and prefer to avoid conflict." |
| Energetic | "You are enthusiastic, impulsive, and jump to conclusions. You talk fast and express strong opinions." |
| Introvert | "You are quiet, thoughtful, and guard your words carefully. You share only what is necessary." |
| Extrovert | "You are the life of the party — chatty, dominant, a gossip magnet. You love drama." |

---

## 6. SwampOfSalem.Web — Host & API

### Program.cs — The Entire Server

```csharp
// ── 1. LLM Provider ────────────────────────────────────────────────────────
var llmProvider = builder.Configuration["LLM:Provider"] ?? "OpenAI";

if (llmProvider == "AzureOpenAI") {
	builder.Services.AddAzureOpenAIChatCompletion(deploymentName, endpoint, apiKey);
} else {
	builder.Services.AddOpenAIChatCompletion(modelId, endpoint, apiKey);
}

// ── 2. DI Registrations ────────────────────────────────────────────────────
builder.Services.AddKernel();
builder.Services.AddSingleton<GameState>();
builder.Services.AddSingleton<GatorAgentService>();
// (GameConfigProvider, services etc. also registered)

// ── 3. Static Files ─────────────────────────────────────────────────────────
app.UseDefaultFiles();     // serves index.html for /
app.UseStaticFiles();      // serves wwwroot/**

// ── 4. Endpoints ────────────────────────────────────────────────────────────
var api = app.MapGroup("/api/agent");
api.MapPost("/initialize", ...);
api.MapPost("/conversation", ...);
api.MapPost("/memory/batch", ...);
// ...

app.MapGet("/api/game-config", (GameConfigProvider config) => {
	return Results.Content(config.GetConfigJson(), "application/json");
});

app.Run();
```

### The GameConfig Injection Pattern

The C# constants need to be available in JavaScript **before** any ES module loads.
Here is how that works:

```
Program.cs builds the app
   │
   ├── Registers GameConfigProvider in DI
   │
   ▼
GET /api/game-config
   → Returns JSON string from GameConfigProvider.GetConfigJson()

index.html (served by static files) contains:
  <script>
	// This is populated server-side at runtime (inline script in the HTML)
	// or fetched before ES modules load.
	window.GameConfig = {GATOR_COUNT:6, TICK_MS:2200, ...};
  </script>
  <script type="module" src="js/main.js"></script>

  The inline <script> runs before the ES module is parsed,
  so window.GameConfig is ready when gameConfig.js reads it.
```

---

## 7. API Endpoint Reference

All endpoints are defined in `Program.cs` with no controller classes.

### `POST /api/agent/initialize`

**When:** Called once at game start after gators are spawned in JS.

**Request body:** `AlligatorSpawnData[]`
```json
[
  {
	"id": 0,
	"name": "Bobby",
	"personality": "cheerful",
	"isMurderer": false,
	"isLiar": false,
	"topicOpinions": { "swamp_leadership": 40, "local_gossip": 20 },
	"sportsTeam": "Rockets"
  },
  ...
]
```

**Response:** `200 OK` (no body)

**What it does:** Resets `GameState`, creates one SK agent per gator, injects topic opinions into ChatHistory.

---

### `POST /api/agent/conversation`

**When:** Called when two gators start talking (via `agentQueue.requestFullConversation`).

**Request body:** `ChatConversationRequest`
```json
{
  "initiatorId": 0,
  "responderId": 2,
  "openingLine": "Hey Greta!",
  "maxTurns": 6,
  "context": "Private visit at Bobby's home. Topics: sports, leadership..."
}
```

**Response:** `ChatConversationResponse`
```json
{
  "initiatorId": 0,
  "responderId": 2,
  "messages": [
	{ "speakerGatorId": 0, "speech": "Hey Greta! Come on in!", "thought": "I hope she likes my swamp." },
	{ "speakerGatorId": 2, "speech": "Thanks Bobby! Nice place.", "thought": "It's actually quite messy." },
	...
  ]
}
```

---

### `POST /api/agent/memory/batch`

**When:** Called just before `requestFullConversation` to flush buffered memories.

**Request body:**
```json
{
  "alligatorId": 2,
  "entries": [
	{ "day": 3, "type": "overheard", "detail": "Heard Bobby say: Watch out for Rex!", "relatedId": 4 },
	{ "day": 3, "type": "conversation_end", "detail": "Finished talking with Bobby", "relatedId": 0 }
  ]
}
```

**Response:** `200 OK` (no body)

**What it does:** Calls `GatorAgentService.AddMemory()` for each entry, which injects the memory as a `ChatHistory` user message.

---

### `POST /api/agent/night-report`

**When:** Called after nightfall to get all gators' reflections.

**Request body:** `NightReportRequest`
```json
{ "aliveIds": [0, 1, 3, 4] }
```

**Response:** `NightReportResponse`
```json
{
  "entries": [
	{
	  "alligatorId": 0,
	  "topSuspectName": "Rex",
	  "suspicionReason": "Rex has been acting evasive and was seen near the crime scene.",
	  "innerThought": "I'm almost certain it's Rex. I need to convince the others tomorrow."
	},
	...
  ]
}
```

---

### `GET /api/game-config`

**When:** Called by the browser on page load to get all C# constants as JSON.

**Response:** Flat JSON object with all game constants (see `GameConfigProvider.GetConfigJson()`).

---

### `POST /api/agent/vote`

**When:** Called during the vote phase (currently always returns null — votes are JS-driven).

**Request:** `VoteRequest { AlligatorId, CandidateIds, DebateSummary }`
**Response:** `{ voteForId: null }`

> ⚠️ This endpoint exists for potential future AI-driven voting. Currently the JS client always
> ignores the null response and uses local suspicion scores to determine votes.

---

## 8. The GameConfig Injection Pattern

This is one of the most important patterns in the entire codebase.

```
WHY IS IT NEEDED?
  JavaScript needs game constants (tick rate, talk distance, etc.)
  These must be kept in sync with C# constants.
  Hard-coding them in JS would lead to drift and bugs.

HOW IT WORKS:
  Step 1: Define constants in C#
	// GameConstants.cs
	public const int TalkDist = 300;

  Step 2: Register GameConfigProvider in DI
	builder.Services.AddSingleton<GameConfigProvider>();

  Step 3: Expose via GET endpoint
	app.MapGet("/api/game-config", (GameConfigProvider config) =>
		Results.Content(config.GetConfigJson(), "application/json"));

  Step 4: index.html fetches it synchronously before modules load
	<script>
	  // (Injected at startup or fetched inline)
	  window.GameConfig = { TALK_DIST: 300, TICK_MS: 2200, ... };
	</script>
	<script type="module" src="js/main.js"></script>

  Step 5: gameConfig.js reads and re-exports
	export const TALK_DIST = window.GameConfig.TALK_DIST;

RESULT: Change one C# number → propagates to JS automatically.
```

---

## 9. Semantic Kernel Agent Lifecycle

```
Game Start
  POST /api/agent/initialize
	│
	▼
For each alligator:
  Kernel clonedKernel = _kernel.Clone()         ← separate plugin scope per gator
  SwampPlugin plugin = new SwampPlugin(gator.Id, _gameState)
  clonedKernel.Plugins.AddFromObject(plugin)

  string systemPrompt = PersonalityPrompts.GetSystemPrompt(
	  gator.Name, gator.Personality, gator.IsMurderer, gator.IsLiar)

  _agents[gator.Id] = new ChatCompletionAgent {
	  Kernel       = clonedKernel,
	  Instructions = systemPrompt,
	  Name         = gator.Name
  }

  _histories[gator.Id] = new ChatHistory(systemPrompt)

  ─────────────────────────────────────────────
  Agent is now ready. ChatHistory will grow as:
	systemPrompt message (at init)
	+ topic opinion context (at init)
	+ memory messages (flushed before each conv)
	+ conversation context (per conversation)
	+ conversation history (per conversation)
  ─────────────────────────────────────────────

During Game
  Every conversation: history grows
  Every memory flush: more user messages injected
  Night report: agent reflects on accumulated history

Game Over / Respawn
  POST /api/agent/initialize again
  All dictionaries cleared and rebuilt from scratch
  ChatHistory is reset (no memory carries over between games)
```

---

## 10. Prompt Architecture

### How a Full Conversation Prompt Is Built

When `GenerateFullConversationAsync` is called, this is the exact sequence of
messages added to the ChatHistory before the AI generates its response:

```
[ChatHistory contents at conversation time]

1. SYSTEM (set at agent init):
   "You are Bobby, a cheerful alligator in Swamp of Salem.
	You are upbeat, friendly, and see the best in everyone.
	YOU UNDERSTAND THIS IS A GAME. You LOVE playing.
	[8 game rules]
	RESPONSE FORMAT: {"spoken": "...", "thought": "..."}"

2. USER (set at agent init — topic opinions):
   "Your topic opinions:
	- Sports: You support the Rockets (local pride).
	- Swamp leadership: You approve (+40) of the current leaders.
	- Local gossip: You are mildly interested (+20) in village gossip.
	- Swamp activities: You love swamp activities (+60)."

3. USER (memory entries — flushed just before this conversation):
   "Day 2: You had a conversation with Greta."
   "Day 3: You overheard Rex say: 'Watch out for Bobby!'"
   "Day 4: Rex was found dead."

4. USER (conversation context — added at conversation start):
   "Day 4 | Phase: Day | Bobby talking to Marge
	Bobby's feelings toward Marge: +20 (likes)
	Marge's feelings toward Bobby: +5 (neutral)
	Context: Private visit at Bobby's home.
	Topics to discuss: Sports (Bobby: Rockets, Marge: Jets)..."

5. AGENT INSTRUCTION (the actual generation request):
   "Generate a 6-turn conversation between Bobby and Marge.
	Start with the opening line 'Come on in, Marge!'
	Return a JSON array of turns:
	[{"speakerName": "Bobby", "speech": "...", "thought": "..."}, ...]"

6. ASSISTANT (LLM output):
   "[{"speakerName":"Bobby","speech":"Come on in, Marge!","thought":"I hope she's not a Chowda fan."},
	 {"speakerName":"Marge","speech":"Thanks Bobby, love the place!","thought":"He's quite cheerful today."},
	 ...]"
```

---

## 11. Adding a New API Endpoint — Step by Step

Example: Add a `/api/agent/debug-state` endpoint that returns the current game state as JSON.

### Step 1 — Add a DTO in Shared (if needed)

```csharp
// SwampOfSalem.Shared/DTOs/DebugStateResponse.cs
public record DebugStateResponse(
	int DayNumber,
	string Phase,
	int? MurdererId,
	int AliveCount
);
```

### Step 2 — Add logic in AppLogic or SK (if needed)

```csharp
// SwampOfSalem.AppLogic/Services/DebugService.cs (example)
public class DebugService {
	private readonly GameState _gameState;
	public DebugService(GameState gs) => _gameState = gs;
	public DebugStateResponse GetDebugState() => new(
		_gameState.DayNumber,
		_gameState.Phase.ToString(),
		_gameState.MurdererId,
		_gameState.Alligators.Count(a => a.IsAlive));
}
```

### Step 3 — Register the service in Program.cs

```csharp
builder.Services.AddSingleton<DebugService>();
```

### Step 4 — Add the endpoint in Program.cs

```csharp
api.MapGet("/debug-state", (DebugService debug) => Results.Ok(debug.GetDebugState()));
```

### Step 5 — Call from JavaScript (agentBridge.js)

```javascript
export async function getDebugState() {
	try {
		const resp = await fetch('/api/agent/debug-state');
		return await resp.json();
	} catch (e) {
		console.warn('getDebugState failed:', e);
		return null;
	}
}
```

---

## 12. Security Notes

### API Keys

> ⚠️ **NEVER commit real API keys to source control.**

Use `dotnet user-secrets` during development:

```powershell
cd SwampOfSalem.Web
dotnet user-secrets set "LLM:AzureOpenAI:ApiKey"   "your-real-key-here"
dotnet user-secrets set "LLM:AzureOpenAI:Endpoint"  "https://your-resource.openai.azure.com/"
```

For production, use environment variables or Azure Key Vault.

### appsettings.json — Safe Placeholder Pattern

The checked-in `appsettings.json` should only contain structure + placeholder values:

```json
{
  "LLM": {
	"Provider": "OpenAI",
	"OpenAI": {
	  "ModelId": "llama3",
	  "Endpoint": "http://localhost:11434/v1",
	  "ApiKey": "not-needed"
	},
	"AzureOpenAI": {
	  "DeploymentName": "gpt-4o",
	  "Endpoint": "YOUR-ENDPOINT-HERE",
	  "ApiKey": "YOUR-KEY-HERE"
	}
  }
}
```

### CORS

This project does not configure CORS because the frontend is served by the same
ASP.NET Core process. If you separate the frontend to a different port (e.g. for
hot-reload development), add:

```csharp
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));
app.UseCors();
```

---

*Next: [GAME_MECHANICS.md](GAME_MECHANICS.md) — Phase math, suspicion formulas, vote algorithm*
*Back: [FRONTEND.md](FRONTEND.md) — JavaScript module reference*
*Back: [ARCHITECTURE.md](ARCHITECTURE.md) — System design overview*
