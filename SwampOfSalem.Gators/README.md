# SwampOfSalem.Gators

The **fully offline rule-based + neural engine**. A drop-in replacement for `SwampOfSalem.SK` — zero LLM calls, zero network I/O.

Every public method mirrors `GatorAgentService` exactly so `DialogRouter` in the Web project can switch between them transparently.

## Contents

| Folder / File | Responsibility |
|---------------|---------------|
| `GatorBrainService.cs` | Top-level service; mirrors `GatorAgentService`'s API |
| `Neural/` | Feed-forward neural net + background brain threads |
| `Thinking/` | Suspicion reasoning, mood evaluation, vote decisions, clique management |
| `Responses/` | Dialog generation, conversation building, night reports |
| `Phrases/` | Phrase banks keyed by personality + mood + dialog type |

## Neural engine

Each living gator runs a `GatorBrainThread` on a dedicated background thread:

```
GatorBrainThread loop (every ~200 ms):
  1. NeuralInput.Build(gator, gameState)   → float[64]
  2. GatorNeuralNet.Infer(input)           → float[48]
  3. NeuralOutput.Decode(output)           → suspicion nudges, mood suggestion, social delta
  4. NeuralBrainOrchestrator.ApplyOutputs → mutates Alligator fields
  5. Broadcast InterGatorSignal to neighbours
  6. Receive reward signal → GatorNeuralNet.Train()
```

**Architecture:** `input(64) → hidden(96) → output(48)`, sigmoid activation, gradient-descent backprop with learning rate 0.008.

Each gator's net is seeded from its `Id` — different weight initialisation per gator produces naturally divergent behaviours.

## Decision pipeline

When `GenerateDialogAsync(request)` is called:

```
1. NeuralBrainOrchestrator.ApplyOutputs()  ← apply latest neural outputs
2. MoodEvaluator.Evaluate()                ← refresh mood from memories
3. SuspicionReasoner.Update()              ← recalculate suspicion scores
4. DialogGenerator.Generate()             ← pick phrase from bank
5. ThoughtEngine.GenerateThought()         ← produce private thought
6. Record spoken line as MemoryEntry
```

## Phrase bank structure

```
PhraseBanks
  └── Dictionary<(Personality, string dialogType), string[]>
		↑ base phrases

MoodPhraseBanks
  └── Dictionary<(Mood, string dialogType), string[]>
		↑ mood overlay (blended 30/70 with base)

MurdererPhrases
  └── string[] deflections, false accusations, alibi builders
		↑ used only when IsMurderer = true
```

## When to use rule-based mode

- **Local development** — no LLM setup required, instant responses
- **Testing** — deterministic responses when seeded with fixed `Random`
- **Performance** — neural threads run in the background; dialog calls return in < 5 ms
- **Offline deployment** — no API keys, no internet

Set `"DialogSource": "RuleBased"` in `appsettings.json`, or hit `POST /api/dialog-source` at runtime.
