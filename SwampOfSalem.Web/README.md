# SwampOfSalem.Web

The ASP.NET Core host. Contains **all API endpoints** (Minimal API style in `Program.cs`) and the entire JavaScript frontend in `wwwroot/`.

## Startup sequence

```
Program.cs
  1. AddKernel()                          → register Semantic Kernel
  2. AddAzureOpenAIChatCompletion / AddOpenAIChatCompletion
  3. AddSingleton<GameState>()            → shared mutable game snapshot
  4. AddSingleton<GatorAgentService>()    → AI engine
  5. AddSingleton<GatorBrainService>()    → rule-based engine
  6. AddSingleton<DialogRouter>()         → routes to AI or rules based on Mode
  7. UseDefaultFiles() + UseStaticFiles() → serve wwwroot/a
  8. Map all 14 endpoints
  9. app.Run()
```

## API endpoints
a
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agent/initialize` | Spawn all gators and initialise agents |
| `POST` | `/api/agent/dialog` | Get one spoken line + thought |
| `POST` | `/api/agent/thought` | Get one inner thought (dialog with type="thought") |
| `POST` | `/api/agent/conversation` | Full multi-turn conversation between two gators |
| `POST` | `/api/agent/vote` | Get a gator's vote decision |
| `POST` | `/api/agent/memory` | Inject one memory entry |
| `POST` | `/api/agent/memory/batch` | Inject multiple memory entries at once |
| `POST` | `/api/agent/night-report` | Get all gators' night reflections |
| `POST` | `/api/agent/test-chat` | Direct LLM test (connection test panel) |
| `POST` | `/api/agent/get-gator` | AI-generate a random character |
| `GET`  | `/api/game-config` | All C# game constants as JSON |
| `GET`  | `/api/config` | Active LLM provider info |
| `GET`  | `/api/dialog-source` | Current engine mode ("AI" or "RuleBased") |
| `POST` | `/api/dialog-source` | Switch engine mode at runtime |

## Frontend (wwwroot/js/)

The entire frontend is plain ES-module JavaScript — no framework, no bundler.

| Module | Lines | Role |
|--------|-------|------|
| `main.js` | 14 | Entry point; re-exports `initSimulation` |
| `simulation.js` | ~1340 | Core tick loop, movement, conversation detection |
| `phases.js` | ~1400 | Phase transitions (Night/Dawn/Debate/Vote/Execute) |
| `agentQueue.js` | ~400 | HTTP request queue, conversation playback buffer |
| `agentBridge.js` | ~150 | Thin `fetch()` wrapper for all API calls |
| `state.js` | ~170 | Single mutable state object |
| `gator.js` | ~300 | Person constructor, relation math, social weights |
| `rendering.js` | ~600 | All SVG/DOM writes, tooltips, house guests |
| `helpers.js` | ~400 | Pure utilities (layout, topics, distance, SVG) |
| `gameConfig.js` | ~50 | Fetches `/api/game-config` and re-exports as constants |
| `gatorBabylon.js` | ~200 | Optional Babylon.js 3-D island view |

## Configuration

`appsettings.json`:

```jsonc
{
  "LLM": {
	"Provider": "OpenAI",           // "OpenAI" | "AzureOpenAI"
	"OpenAI": {
	  "ModelId": "llama3",
	  "Endpoint": "http://localhost:11434/v1",
	  "ApiKey": "not-needed"
	},
	"AzureOpenAI": {
	  "DeploymentName": "gpt-4o",
	  "Endpoint": "",
	  "ApiKey": ""                  // Use dotnet user-secrets in production
	}
  },
  "DialogSource": "AI"              // "AI" | "RuleBased"
}
```

## Running locally

```powershell
cd SwampOfSalem.Web
dotnet run
```

Navigate to `https://localhost:5001` (port shown in terminal output).

For offline/fast iteration: set `"DialogSource": "RuleBased"` — no LLM needed.
