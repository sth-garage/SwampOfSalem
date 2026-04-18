import { PHASE, DAY_TICKS } from './gameConfig.js';

// ── Shared mutable state ──────────────────────────────────────
// Gathered into a single object so all modules can import & mutate it.
export const state = {
    gators:       [],
    houses:       [],
    tickInterval: null,
    rafId:        null,
    paused:       false,
    nextId:       0,
    talkLines:         new Map(),
    bubbles:           new Map(),
    thoughts:          new Map(),
    privateChatBubbles: new Map(),   // homeIndex → enclosure DOM element


    // Day/night
    isNight:      false,
    cycleTimer:   0,

    // Game
    gamePhase:     PHASE.DAY,
    murdererId:    null,
    deadIds:       new Set(),
    nightVictimId: null,
    voteTarget:    null,
    dayNumber:     1,

    // Sequential vote
    voteOrder:        [],
    voteIndex:        0,
    voteResults:      {},
    voteDisplayTimer: 0,
    voteHistory:      [],

    // Execute walk
    condemnedId:      null,
    executeTimer:     0
};

// ── Reset helper — called on respawn ──────────────────────────
export function resetGameState() {
    state.isNight       = false;
    state.gamePhase     = PHASE.DAY;
    state.cycleTimer    = DAY_TICKS;
    state.deadIds       = new Set();
    state.nightVictimId = null;
    state.voteTarget    = null;
    state.dayNumber     = 1;
    state.voteOrder        = [];
    state.voteIndex        = 0;
    state.voteResults      = {};
    state.voteDisplayTimer = 0;
    state.voteHistory      = [];
    state.condemnedId      = null;
    state.executeTimer     = 0;
    state.privateChatBubbles = state.privateChatBubbles ?? new Map();
}
