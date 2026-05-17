# SwampOfSalem.SK

The **Semantic Kernel AI layer**. Provides one `ChatCompletionAgent` per living alligator, each with its own persistent `ChatHistory` and scoped `SwampPlugin`.

## Contents

| File | Responsibility |
|------|---------------|
| `Agents/GatorAgentService.cs` | Central AI orchestration service; owns all agents and histories |
| `Plugins/SwampPlugin.cs` | Kernel plugin that gives the LLM read access to live game state |
| `Prompts/PersonalityPrompts.cs` | Builds the system-prompt string for each personality × mood × role |

## How it works

### Agent lifecycle

```
POST /api/agent/initialize
  → GatorAgentService.InitializeFromSpawnData()
	→ For each gator: CreateAgent()
	  → new ChatCompletionAgent { Instructions = PersonalityPrompts.GetSystemPrompt(...) }
	  → new ChatHistory()
	  → agentKernel.Plugins.AddFromObject(new SwampPlugin(gatorId, ...))
```

Each agent shares the same `Kernel` instance (same LLM connection) but gets a **cloned kernel** with its own `SwampPlugin` so plugin calls are scoped to the correct gator.

### Memory injection

When `AddMemory(id, entry)` is called:
1. Entry is appended to `_memories[id]`
2. A `history.AddSystemMessage(...)` call injects it into the agent's `ChatHistory` — the LLM will see it as if it were part of the conversation
3. On significant event types (`death`, `vote`, `conviction`, `night_report`), `RefreshAgentMood()` rebuilds the agent's `Instructions` to reflect the current `Mood`

### Prompt structure

```
[Core identity: name, personality, speech style]
[Murderer instructions — only if IsMurderer]
[Liar instructions — only if IsLiar]
[Current mood modifier]
[Recent memories bullet list]
[Output format: SPEECH: <text> / THOUGHT: <text>]
```

## Supported LLM providers

Configured in `appsettings.json` → `"LLM:Provider"`:

| Value | Endpoint |
|-------|---------|
| `"OpenAI"` | Any OpenAI-compatible API (Ollama, LM Studio, OpenAI itself) |
| `"AzureOpenAI"` | Azure OpenAI Service |

## Dependencies

- `Microsoft.SemanticKernel` 1.54.0+
- `SwampOfSalem.Shared` (for `Alligator`, `GameState`, `MemoryEntry`, all DTOs)
