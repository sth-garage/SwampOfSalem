# SwampOfSalem.AppLogic

Pure game rules, constants, and services. **No AI dependency, no HTTP, no UI.** This project can be unit-tested in complete isolation.

## Contents

| Folder | What's in it |
|--------|-------------|
| `Constants/` | All tuning values for the simulation |
| `Services/` | Game-rule services (phase transitions, murder, voting, relationships) |

## Constants (serialised to JavaScript at boot)

All `public const` fields are automatically picked up by `GameConfigProvider` and served as JSON at `GET /api/game-config`. The JavaScript `gameConfig.js` module fetches this at startup — no manual duplication of values.

| Class | Controls |
|-------|---------|
| `GameConstants` | Tick rate, distances, social stats, phase durations |
| `AppearanceConstants` | Name pools, colour palettes, sprite variants |
| `PersonalityConstants` | Stat baselines and activity weights per archetype |
| `RelationshipConstants` | Drift rates, compatibility bonuses, decay values |

## Services

| Service | Responsibility |
|---------|---------------|
| `GameConfigProvider` | Reflects all constants → JSON for the JS client |
| `PhaseManager` | Advances `GameState.Phase` through the cycle; checks win conditions |
| `MurderService` | Selects the murderer's next victim (weighted scoring algorithm) |
| `VoteService` | Establishes vote order and tallies results |
| `RelationshipService` | Updates `Alligator.Relations` after conversations |

## Adding new constants

1. Add the `public const` field to the appropriate class in `Constants/`.
2. That's it — `GameConfigProvider` will include it in the next `/api/game-config` response and `gameConfig.js` will make it available as a named export.
