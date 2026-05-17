# 🐊 Class Reference — Swamp of Salem

> A complete guide to every C# class in the solution: what it does, its key methods and properties, and how it connects to other classes.

---

## Table of Contents

- [SwampOfSalem.Shared](#swampofsalemshared)
  - [Alligator](#alligator)
  - [GameState](#gamestate)
  - [MemoryEntry](#memoryentry)
  - [Clique](#clique)
  - [DTOs](#dtos)
  - [Enums](#enums)
- [SwampOfSalem.AppLogic](#swampofsalemapplogic)
  - [GameConstants](#gameconstants)
  - [AppearanceConstants](#appearanceconstants)
  - [PersonalityConstants](#personalityconstants)
  - [RelationshipConstants](#relationshipconstants)
  - [GameConfigProvider](#gameconfigprovider)
  - [PhaseManager](#phasemanager)
  - [MurderService](#murderservice)
  - [VoteService](#voteservice)
  - [RelationshipService](#relationshipservice)
- [SwampOfSalem.SK](#swampofsalemsk)
  - [GatorAgentService](#gatoragentservice)
  - [SwampPlugin](#swampplugin)
  - [PersonalityPrompts](#personalityprompts)
- [SwampOfSalem.Gators](#swampofsalemgators)
  - [GatorBrainService](#gatorbrainservice)
  - [GatorNeuralNet](#gatorneuralnet)
  - [NeuralLayer](#neurallayer)
  - [GatorBrainThread](#gatorbrainthread)
  - [NeuralBrainOrchestrator](#neuralbrainorchestrator)
  - [NeuralInput](#neuralinput)
  - [NeuralOutput](#neuraloutput)
  - [InterGatorSignal](#intergatorsignal)
  - [DialogGenerator](#dialoggenerator)
  - [ConversationBuilder](#conversationbuilder)
  - [NightReporter](#nightreporter)
  - [ThoughtEngine](#thoughtengine)
  - [SuspicionReasoner](#suspicionreasoner)
  - [MoodEvaluator](#moodevaluator)
  - [VoteDecider](#votedecider)
  - [CliqueService](#cliqueservice)
  - [PhraseBanks / MoodPhraseBanks / MurdererPhrases](#phrasebanks)
- [SwampOfSalem.Web](#swampofsalemweb)
  - [Program.cs — Endpoints](#programcs--endpoints)
  - [DialogRouter](#dialogrouter)

---

## SwampOfSalem.Shared

### Alligator

**File:** `SwampOfSalem.Shared/Models/Alligator.cs`

The central domain model. Every living and dead participant in the simulation is an `Alligator` instance held in `GameState.Alligators`.

| Property | Type | Description |
|----------|------|-------------|
| `Id` | `int` | Unique identifier. Used as key in all dictionaries. |
| `Name` | `string` | Display name (e.g. "Chomps", "Gnarla"). |
| `Personality` | `Personality` | Fixed archetype (Cheerful, Grumpy, Lazy, Energetic, Introvert, Extrovert). Controls AI prompt tone and stat baselines. |
| `Mood` | `Mood` | Dynamic emotional state. Shifts after murders, votes, betrayals. |
| `MoodSetDay` | `int` | Day the current mood was set; used to expire temporary moods. |
| `HomeIndex` | `int` | Zero-based position on the cul-de-sac. Doubles as vote order. |
| `IsAlive` | `bool` | `false` = excluded from all logic. |
| `IsMurderer` | `bool` | Exactly one gator per game. Gets a deception system prompt. |
| `IsLiar` | `bool` | Non-murderer deceivers; ~20% of the roster. |
| `CurrentActivity` | `Activity` | `Moving`, `Talking`, `Hosting`, `Visiting`. Drives JS animation. |
| `ThoughtStat` | `int 1–10` | Perceptiveness. High = more analytical inner thoughts. |
| `SocialStat` | `int 1–10` | Social drive. High = seeks conversation more aggressively. |
| `SocialNeed` | `int 0–100` | Decays per tick; refills during conversation. |
| `Money` | `int` | Swamp currency. |
| `Apples` / `Oranges` | `int` | Trade goods. |
| `Debt` | `int` | Outstanding debts. |
| `OrangeLover` | `bool` | Personality quirk for dialogue flavour. |
| `Relations` | `Dictionary<int,double>` | True feelings toward each other gator (−100 to +100). |
| `PerceivedRelations` | `Dictionary<int,double>` | Believed feelings of others toward this gator (may be wrong). |
| `Suspicion` | `Dictionary<int,double>` | How much this gator suspects each other of murder (0–100). Once > 55 (`CONVICTION_THRESHOLD`) they openly accuse. |
| `CliqueId` | `int?` | Social group membership. `null` = unaffiliated. |

**Used by:** `GatorAgentService`, `GatorBrainService`, `PhaseManager`, `MurderService`, `VoteService`, `RelationshipService`, `PersonalityPrompts`, all Thinking classes.

---

### GameState

**File:** `SwampOfSalem.Shared/Models/GameState.cs`

Singleton shared across all services. The live snapshot of a game session.

| Property | Type | Description |
|----------|------|-------------|
| `Alligators` | `List<Alligator>` | Full roster (alive + dead). Filter with `.Where(a => a.IsAlive)`. |
| `Phase` | `GamePhase` | Current phase. Advanced by `PhaseManager.AdvancePhase()`. |
| `DayNumber` | `int` | Monotonically increasing. Starts at 1. |
| `MurdererId` | `int?` | ID of the killer, or `null` if they've been executed. |
| `DeadIds` | `HashSet<int>` | O(1) alive check. |
| `NightVictimId` | `int?` | Last night's kill target. Revealed at Dawn. |
| `VoteTarget` | `int?` | Currently condemned gator. |
| `VoteOrder` | `List<int>` | Clockwise sequence (ascending `HomeIndex`). |
| `StartingPopulation` | `int` | Used by `GatorBrainService` for panic-escalation math. |

**Registered as:** `builder.Services.AddSingleton<GameState>()`

---

### MemoryEntry

**File:** `SwampOfSalem.Shared/Models/MemoryEntry.cs`

A single memorable event injected into an alligator's AI context.

| Field | Type | Description |
|-------|------|-------------|
| `Day` | `int` | When it happened |
| `Type` | `string` | `"death"`, `"vote"`, `"conversation"`, `"conviction"`, `"night_report"` |
| `Detail` | `string` | Human-readable description fed to the LLM |
| `RelatedAlligatorId` | `int?` | The other party involved |

**Used by:** `GatorAgentService.AddMemory()`, `GatorBrainService.AddMemory()`, `PersonalityPrompts` (for context building).

---

### Clique

**File:** `SwampOfSalem.Shared/Models/Clique.cs`

A social group formed among alligators with compatible relations.

| Property | Type | Description |
|----------|------|-------------|
| `Id` | `int` | Unique identifier |
| `MemberIds` | `List<int>` | Alligator IDs in this clique |
| `LeaderId` | `int?` | Most socially dominant member (highest SocialStat) |

**Used by:** `CliqueService.FormCliques()` (Gators project), referenced from `Alligator.CliqueId`.

---

### DTOs

All DTOs live in `SwampOfSalem.Shared/DTOs/`. They are plain C# records used as the JSON contract between the JS frontend and the .NET API.

| DTO | Direction | Purpose |
|-----|-----------|---------|
| `AlligatorSpawnData` | JS → .NET | Initial gator creation data (name, personality, IsMurderer, TopicOpinions, etc.) |
| `AgentDialogRequest` | JS → .NET | Request a single spoken line (`AlligatorId`, `DialogType`, `TargetAlligatorId`, context) |
| `AgentDialogResponse` | .NET → JS | Spoken `Message` + private `Thought` |
| `ChatConversationRequest` | JS → .NET | Full multi-turn conversation (`InitiatorId`, `ResponderId`, `MaxTurns`) |
| `ChatConversationResponse` | .NET → JS | List of `ConversationMessage` (each has `SpeakerId` + `Text`) |
| `VoteRequest` | JS → .NET | Who is voting and who the candidates are |
| `VoteResponse` | .NET → JS | `VoteForId` — who the gator chose |
| `NightReportRequest` | JS → .NET | List of alive gator IDs |
| `NightReportResponse` | .NET → JS | Array of `NightReportEntry` (per-gator night reflection) |
| `DebateRoundRequest` | JS → .NET | Debate context (accuser ID, suspect ID, phase context) |
| `DebateRoundResponse` | .NET → JS | Spoken debate line |

---

### Enums

| Enum | Values | Used for |
|------|--------|---------|
| `GamePhase` | `Day, Night, Dawn, Debate, Vote, Execute, GameOver` | Phase state machine |
| `Personality` | `Cheerful, Grumpy, Lazy, Energetic, Introvert, Extrovert` | AI prompt selection, stat baselines |
| `Mood` | `Normal, Happy, Sad, Angry, Fearful, Suspicious` | Dialogue tone modifier |
| `Activity` | `Moving, Talking, Hosting, Visiting` | JS animation state |

---

## SwampOfSalem.AppLogic

### GameConstants

**File:** `SwampOfSalem.AppLogic/Constants/GameConstants.cs`

All game timing and sizing constants. **Single source of truth** — automatically serialised to JavaScript via `GameConfigProvider` so both sides always agree.

Key constants:

| Constant | Value | Meaning |
|----------|-------|---------|
| `GatorSize` | 120 px | SVG sprite size |
| `GatorCount` | 2 (default) | Gators per session |
| `TickMs` | 2200 ms | Simulation tick interval |
| `TalkDist` | 300 px | Max range to start a conversation |
| `TalkStop` | 90 px | Distance at which gators stop and face each other |
| `DayTicks` | 136 | ~5 minute days |
| `NightTicks` | 2 | ~4 s black screen |
| `DawnTicks` | 6 | ~13 s body reveal |
| `DebateTicks` | 55 | ~2 min debate |
| `SocialDecay` | 12 | Social need drained per idle tick |
| `SocialGain` | 22 | Social need restored per talking tick |
| `ConvictionThreshold` | 55 | Suspicion level triggering open accusation |

---

### AppearanceConstants

**File:** `SwampOfSalem.AppLogic/Constants/AppearanceConstants.cs`

Name pools, colour palettes, and sprite variant lists used when spawning new gators.

---

### PersonalityConstants

**File:** `SwampOfSalem.AppLogic/Constants/PersonalityConstants.cs`

Stat baselines and activity weight distributions per personality archetype. Controls how fast a gator walks, how socially driven they are, and how often they choose to move vs. host vs. talk.

---

### RelationshipConstants

**File:** `SwampOfSalem.AppLogic/Constants/RelationshipConstants.cs`

Drift rates, compatibility bonuses, and decay values for the relationship system.

---

### GameConfigProvider

**File:** `SwampOfSalem.AppLogic/Services/GameConfigProvider.cs`

Serialises all `*Constants` classes to a flat JSON object, served at `GET /api/game-config`. The JS module `gameConfig.js` fetches this at boot, making all C# tuning values available in JavaScript without manual duplication.

**Key method:**
```csharp
public static string GetConfigJson()
```
Uses reflection to read every `public const` field from all constants classes and merges them into one JSON blob.

---

### PhaseManager

**File:** `SwampOfSalem.AppLogic/Services/PhaseManager.cs`

Server-side phase state machine. Mutates `GameState.Phase` and checks win conditions.

```csharp
GamePhase AdvancePhase(GameState state)
bool      CheckGameOver(GameState state)
```

**Phase cycle:** `Day → Night → Dawn → Debate → Vote → Execute → Day`

**Win conditions:**
- ≤ 2 alive gators → murderer wins
- Murderer is dead → town wins

---

### MurderService

**File:** `SwampOfSalem.AppLogic/Services/MurderService.cs`

Implements the murderer's victim selection algorithm.

```csharp
Alligator? SelectVictim(GameState state)
```

**Victim scoring formula:**
```
score(candidate) =
  candidate.suspicion[murdererId] × 0.6   ← targets whoever suspects the killer most
  - killer.relations[candidate.id] × 0.3  ← prefers to kill disliked gators
  + random(0, 20)                          ← small unpredictability factor
```
The candidate with the highest score is killed.

---

### VoteService

**File:** `SwampOfSalem.AppLogic/Services/VoteService.cs`

Establishes vote order and tallies results.

```csharp
List<int> EstablishVoteOrder(GameState state)
int?      TallyVotes(Dictionary<int,int> votes)
```

Vote order = ascending `HomeIndex` (clockwise around the cul-de-sac). Tally returns the ID with the most votes (ties broken by highest `HomeIndex`).

---

### RelationshipService

**File:** `SwampOfSalem.AppLogic/Services/RelationshipService.cs`

Updates `Alligator.Relations` after each conversation based on topic compatibility.

```csharp
void DriftRelations(Alligator a, Alligator b, string topic, GameState state)
```

Two gators with compatible topic opinions will drift closer; incompatible opinions push them apart. Clique membership also amplifies positive drift.

---

## SwampOfSalem.SK

### GatorAgentService

**File:** `SwampOfSalem.SK/Agents/GatorAgentService.cs`

The AI orchestration layer. Each living gator gets a dedicated `ChatCompletionAgent` with its own `ChatHistory` and `SwampPlugin` instance.

**Key methods:**

| Method | Description |
|--------|-------------|
| `InitializeFromSpawnData(spawnData)` | Resets game state; creates `Alligator` objects and SK agents from JS spawn data |
| `InitializeAgents()` | (Re-)creates all agents without changing game state |
| `AddMemory(id, memory)` | Adds to `_memories[id]` AND injects into `ChatHistory` as a system message; triggers mood refresh on significant events |
| `RefreshAgentMood(id)` | Rebuilds agent `Instructions` to reflect current `Mood` without restarting the agent |
| `GenerateDialogAsync(request)` | Returns one spoken line + inner thought; parses `SPEECH:` and `THOUGHT:` markers from LLM response |
| `GenerateFullConversationAsync(request)` | Generates all turns of a multi-gator conversation in one LLM call |
| `GetVoteAsync(request)` | Returns the gator's vote target for the current round |
| `GenerateNightReportAsync(aliveIds)` | Generates all gators' night reflections **in parallel** using `Task.WhenAll` |
| `RunDebateRoundAsync(request)` | Returns one debate accusation or defence |

**Internal data structures:**

```csharp
ConcurrentDictionary<int, ChatCompletionAgent> _agents
ConcurrentDictionary<int, ChatHistory>         _histories
ConcurrentDictionary<int, List<MemoryEntry>>   _memories
```

All three use `ConcurrentDictionary` to support parallel night-report generation.

---

### SwampPlugin

**File:** `SwampOfSalem.SK/Plugins/SwampPlugin.cs`

A Semantic Kernel plugin (a class with `[KernelFunction]`-decorated methods) that gives the LLM access to live game state. Each agent gets its own plugin instance scoped to its gator ID.

**Functions exposed to the LLM:**

| Function | Description |
|----------|-------------|
| `GetMyStats()` | Returns this gator's current mood, stats, and economy |
| `GetRelationship(otherId)` | Returns this gator's relation score toward another |
| `GetSuspicion(suspectId)` | Returns this gator's suspicion score for another |
| `GetMemories()` | Returns recent memory entries for context |

The LLM can call these during generation to ground its response in actual game state rather than hallucinating values.

---

### PersonalityPrompts

**File:** `SwampOfSalem.SK/Prompts/PersonalityPrompts.cs`

Generates the `Instructions` (system prompt) string for a `ChatCompletionAgent`.

```csharp
public static string GetSystemPrompt(
	string name, Personality personality,
	bool isMurderer, bool isLiar,
	Mood mood, List<MemoryEntry> memories)
```

**Prompt sections:**
1. **Core identity** — name, personality archetype description, speech style
2. **Murderer layer** (if `isMurderer`) — hidden instructions to deflect suspicion and plan strategically
3. **Liar layer** (if `isLiar`) — instructions to misdirect and state false opinions
4. **Mood modifier** — tonal shift based on current `Mood`
5. **Recent memories** — last N memory entries as bullet points
6. **Output format instructions** — requires `SPEECH: <text>` and `THOUGHT: <text>` markers

---

## SwampOfSalem.Gators

### GatorBrainService

**File:** `SwampOfSalem.Gators/GatorBrainService.cs`

The fully offline alternative to `GatorAgentService`. Mirrors every public method exactly so `DialogRouter` can swap between them transparently.

In addition to rule-based response generation, each living gator also runs a `GatorBrainThread` on a dedicated background thread that continuously evaluates suspicion, mood, and social signals via the neural net.

**Key differences from `GatorAgentService`:**
- No LLM, no network calls — all responses come from phrase banks and scoring logic
- Neural threads run continuously in the background; AI agents are called on demand
- Topic opinions from spawn data are seeded directly into `Alligator.Relations` where gator names appear in topic strings

---

### GatorNeuralNet

**File:** `SwampOfSalem.Gators/Neural/GatorNeuralNet.cs`

A two-layer feed-forward neural network backing a single alligator's reasoning in rule-based mode.

**Architecture:** `input(64) → hidden(96) → output(48)` — both layers use sigmoid activation.

**Learning:** Scalar reward signal `r ∈ [−1, +1]`. Output error = `−r × (output − 0.5)`. Reward pulls outputs toward 1.0; punishment toward 0.0.

**Usage:** Called by `GatorBrainThread` in a tight loop. Each inference produces `NeuralOutput` values (suspicion nudges, mood suggestions, social-need changes). Thread safety: each gator owns exactly one `GatorNeuralNet`, only touched from its own thread.

---

### NeuralLayer

**File:** `SwampOfSalem.Gators/Neural/NeuralLayer.cs`

A single dense fully-connected layer with configurable input/output dimensions, sigmoid activation, and gradient-descent backprop. Reused for both hidden and output layers in `GatorNeuralNet`.

---

### GatorBrainThread

**File:** `SwampOfSalem.Gators/Neural/GatorBrainThread.cs`

A long-running background `Thread` (one per living gator) that:
1. Builds `NeuralInput` from current `Alligator` and `GameState`
2. Calls `GatorNeuralNet.Infer()`
3. Applies `NeuralOutput` via `NeuralBrainOrchestrator.ApplyOutputs()`
4. Receives reward/punishment signals and calls `GatorNeuralNet.Train()`
5. Sleeps for a short interval and repeats

Started by `GatorBrainService.InitializeFromSpawnData()`. Stopped by `Dispose()`.

---

### NeuralBrainOrchestrator

**File:** `SwampOfSalem.Gators/Neural/NeuralBrainOrchestrator.cs`

Manages all `GatorBrainThread` instances (one per living gator). Handles start/stop lifecycle and translates `NeuralOutput` vectors into mutations on `Alligator` properties (suspicion adjustments, mood changes, social-need deltas) and `InterGatorSignal` broadcasts.

---

### NeuralInput

**File:** `SwampOfSalem.Gators/Neural/NeuralInput.cs`

Encodes an `Alligator`'s current state into a fixed-length float vector (64 elements) suitable for `GatorNeuralNet.Infer()`. Inputs include: relation scores, suspicion scores, social stats, mood encoding, day number, alive count, and economy values — all normalised to [0, 1].

---

### NeuralOutput

**File:** `SwampOfSalem.Gators/Neural/NeuralOutput.cs`

Decodes the 48-element output vector from `GatorNeuralNet` into named signals:
- `SuspicionNudges[id]` — ±adjustment to `Alligator.Suspicion[id]`
- `MoodSuggestion` — float in [0,1] mapped to `Mood` enum
- `SocialNeedDelta` — adjustment to `SocialNeed`
- `VoteScore[id]` — used by `VoteDecider` as a tiebreaker

---

### InterGatorSignal

**File:** `SwampOfSalem.Gators/Neural/InterGatorSignal.cs`

A value-type signal emitted by one gator's neural thread and consumed by other gators' threads. Models social influence: a confident accusation from a high-`ThoughtStat` gator nudges nearby gators' suspicion in the same direction.

---

### DialogGenerator

**File:** `SwampOfSalem.Gators/Responses/DialogGenerator.cs`

Generates a single spoken line and thought for rule-based mode, replacing `GatorAgentService.GenerateDialogAsync()`.

```csharp
static AgentDialogResponse Generate(
	AgentDialogRequest request, Alligator gator,
	GameState state, List<MemoryEntry> memories, Random rng)
```

Logic:
1. Selects the appropriate phrase bank based on `DialogType` (`greeting`, `gossip`, `accusation`, `defense`, etc.)
2. Applies personality and mood filters
3. Substitutes name tokens for specific alligators
4. Constructs a thought string from `ThoughtEngine`

---

### ConversationBuilder

**File:** `SwampOfSalem.Gators/Responses/ConversationBuilder.cs`

Builds multi-turn conversations for rule-based mode, replacing `GatorAgentService.GenerateFullConversationAsync()`. Alternates between two gators' phrase banks, applies topic compatibility scoring to select relevant turns, and models natural conversation rhythm (greeting → topic → reaction → farewell).

---

### NightReporter

**File:** `SwampOfSalem.Gators/Responses/NightReporter.cs`

Generates each gator's night reflection for rule-based mode. Uses `MoodPhraseBanks` and `MurdererPhrases` to produce personality-appropriate reactions to the night's events.

---

### ThoughtEngine

**File:** `SwampOfSalem.Gators/Thinking/ThoughtEngine.cs`

Generates the private inner thought for a gator's response. Reads `Alligator.Suspicion` and `Relations` scores to produce an analytical observation (e.g. "Chomps is being too helpful — that's suspicious" or "Gnarla protected me in the vote; I trust them").

---

### SuspicionReasoner

**File:** `SwampOfSalem.Gators/Thinking/SuspicionReasoner.cs`

Calculates how much suspicion to add or remove based on observed events. Called after each speech act, memory injection, and vote result.

Key heuristics:
- Gator who deflects/changes subject: +suspicion
- Gator who accurately predicts a murder before it happens: +suspicion
- Gator who speaks in defense of a known liar: +suspicion toward both
- Gator who mourns loudly at Dawn: −suspicion (reliable grief signal)

---

### MoodEvaluator

**File:** `SwampOfSalem.Gators/Thinking/MoodEvaluator.cs`

Recalculates an alligator's `Mood` whenever a new `MemoryEntry` is added. Uses memory type and recency to pick an appropriate mood:
- Recent `"death"` memory → `Fearful` or `Angry` (personality-dependent)
- `"conviction"` memory about self → `Angry`
- `"vote"` memory where self was targeted → `Suspicious`
- No recent significant memories → `Normal`

Also enforces mood expiry: moods set more than one day ago revert to `Normal`.

---

### VoteDecider

**File:** `SwampOfSalem.Gators/Thinking/VoteDecider.cs`

Picks a vote target for rule-based mode. Combines `Alligator.Suspicion` scores with `NeuralOutput.VoteScore` weights to select the most-suspected gator. Murderers use `MurderService.SelectVictim` logic to pick an innocent who is already publicly suspected (safer deflection).

---

### CliqueService

**File:** `SwampOfSalem.Gators/Thinking/CliqueService.cs`

Forms social groups (`Clique` objects) from the population based on relation scores. Gators with mutual `Relations > CLIQUE_THRESHOLD` are grouped together; the highest-`SocialStat` member becomes leader.

```csharp
static void FormCliques(GameState state)
static void UpdateCliquesOnDeath(GameState state, int deadId)
```

Cliques influence debate speeches (members defend each other) and suspicion spread (members share suspicion scores).

---

### PhraseBanks

**File:** `SwampOfSalem.Gators/Phrases/PhraseBanks.cs`  
**File:** `SwampOfSalem.Gators/Phrases/MoodPhraseBanks.cs`  
**File:** `SwampOfSalem.Gators/Phrases/MurdererPhrases.cs`

Static dictionaries mapping `(Personality, DialogType)` → `string[]` phrase arrays. `DialogGenerator` picks randomly from the appropriate array.

`MoodPhraseBanks` adds a mood-keyed layer on top: `(Mood, DialogType)` → phrases, blended with personality phrases at a configurable ratio.

`MurdererPhrases` contains deflection phrases, false accusation templates, and alibi-building lines used only when `IsMurderer = true`.

---

## SwampOfSalem.Web

### Program.cs — Endpoints

`Program.cs` is the entire server. All 14 endpoints are one-liner lambdas. Key endpoints:

| Method | Path | Handler |
|--------|------|---------|
| `POST` | `/api/agent/initialize` | `agents.InitializeFromSpawnData(alligators)` |
| `POST` | `/api/agent/dialog` | `agents.GenerateDialogAsync(request)` |
| `POST` | `/api/agent/thought` | Same as dialog with `DialogType = "thought"` |
| `POST` | `/api/agent/conversation` | `agents.GenerateFullConversationAsync(request)` |
| `POST` | `/api/agent/vote` | `agents.GetVoteAsync(request)` |
| `POST` | `/api/agent/memory` | `agents.AddMemory(request.AlligatorId, entry)` |
| `POST` | `/api/agent/memory/batch` | `AddMemory` for each entry in batch |
| `POST` | `/api/agent/night-report` | `agents.GenerateNightReportAsync(aliveIds)` |
| `POST` | `/api/agent/test-chat` | Direct SK `IChatCompletionService` call (test panel) |
| `POST` | `/api/agent/get-gator` | AI-generated alligator character creator |
| `GET`  | `/api/game-config` | `GameConfigProvider.GetConfigJson()` |
| `GET`  | `/api/config` | Active LLM provider info |
| `GET`  | `/api/dialog-source` | `router.Mode` |
| `POST` | `/api/dialog-source` | Sets `router.Mode` at runtime |

---

### DialogRouter

**File:** `Program.cs` (declared as a file-scoped class at the bottom of the file)

Strategy pattern wrapper. Routes every agent call to either `GatorAgentService` (AI) or `GatorBrainService` (rule-based) based on `Mode`.

```csharp
class DialogRouter(GatorAgentService ai, GatorBrainService brain, string initialMode)
{
	public string Mode { get; set; } = initialMode;
	private bool UseAi => !Mode.Equals("RuleBased", ...);
	// ... delegates all methods to ai or brain
}
```

Registered as a singleton in DI. `Mode` can be changed at runtime via `POST /api/dialog-source`.
