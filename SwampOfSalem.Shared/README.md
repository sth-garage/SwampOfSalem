# SwampOfSalem.Shared

Shared domain models, DTOs, and enums. **No dependencies on any other project in this solution.**

This project is the common contract that lets `SwampOfSalem.SK`, `SwampOfSalem.Gators`, `SwampOfSalem.AppLogic`, and `SwampOfSalem.Web` all communicate without circular references.

## Contents

| Folder | What's in it |
|--------|-------------|
| `Models/` | `Alligator`, `GameState`, `MemoryEntry`, `Clique` — core domain objects |
| `DTOs/` | Request/response records for every API endpoint |
| `Enums/` | `GamePhase`, `Personality`, `Mood`, `Activity` |

## Key types

- **`Alligator`** — the central domain model; one instance per participant
- **`GameState`** — singleton snapshot of the live game (phase, day, who's dead, vote order)
- **`MemoryEntry`** — a single memorable event injected into an AI agent's context
- **`AlligatorSpawnData`** DTO — what the JS frontend sends to create gators

## Design notes

All types are plain C# classes/records with no logic — pure data. Services in other projects operate on these types but the types themselves have no methods beyond property getters/setters.
