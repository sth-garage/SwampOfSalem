/**
 * @fileoverview state.js — Shared mutable simulation state.
 *
 * This module exports a single `state` object that acts as the "single source
 * of truth" for the entire frontend simulation. Every other module imports this
 * object and reads/writes to it directly — there is no state-management library.
 *
 * Why a single mutable object?
 *   The simulation is a real-time tick loop, not a React-style UI. Every tick
 *   needs to read dozens of values cheaply. A plain JS object with direct
 *   property access is the fastest and simplest approach for this use case.
 *
 * Key sub-sections of state:
 *   @property {Array}   gators              - All alligator Person objects (alive + dead)
 *   @property {Array}   houses              - All house layout objects
 *   @property {string}  gamePhase           - Current phase string (matches PHASE constants)
 *   @property {boolean} activeConversation  - Global lock: only 1 AI conversation at a time
 *   @property {number}  murdererId          - ID of the secret murderer gator
 *   @property {Set}     deadIds             - IDs of all eliminated gators
 *   @property {Array}   voteOrder           - Clockwise voting sequence for current round
 *
 * @module state
 */
import { PHASE, DAY_TICKS } from './gameConfig.js';

// ── Shared mutable state ──────────────────────────────────────
// All simulation state lives in this one object, imported by every module.
// There is no framework — just plain JS object access.
//
// GROUPINGS:
//   Core simulation   — gators, houses, loop handles
//   Visual maps       — DOM references for bubbles, talk lines, chat enclosures
//   Day management    — conversation counters and nightfall timers
//   Phase state       — which phase is active, cycle timer
//   Game identifiers  — who the murderer is, who has died
//   Vote ceremony     — vote order, results, history
//   Execute walk      — who is condemned, animation timer
export const state = {
    // ── Core simulation ───────────────────────────────────────────────────
    gators:       [],    // Array<Person> — ALL gators (living + dead). Use living() to filter.
    houses:       [],    // Array<HouseLayout> — positions for all 6 house slots.
    tickInterval: null,  // Handle returned by setInterval(tick, TICK_MS). Cleared on pause.
    rafId:        null,  // Handle returned by requestAnimationFrame(gameLoop). Cleared on game-over.
    paused:       false, // true = tick loop and rAF logic skip all work.
    nextId:       0,     // Monotonically increasing counter used by createGator() to assign gator IDs.

    // ── Visual maps ───────────────────────────────────────────────────────
    // These Map objects hold references to DOM elements created per-gator.
    // Keyed by gator ID (or homeIndex for privateChatBubbles).
    talkLines:          new Map(), // gatorId → SVG <line> element connecting chatting pairs.
    bubbles:            new Map(), // gatorId → speech bubble DOM element.
    thoughts:           new Map(), // gatorId → thought bubble DOM element.
    privateChatBubbles: new Map(), // homeIndex → enclosure DOM element wrapping a hosting pair.

    // ── Day management ────────────────────────────────────────────────────
    // Controls when the Day phase ends and nightfall begins.
    // Night is NOT triggered purely by cycleTimer — it also requires
    // completing enough conversations (CONV_LIMIT_FOR_NIGHTFALL).
    completedConvCount:   0,     // How many full AI conversations have finished today.
    dayEndTimerActive:    false, // true once CONV_LIMIT_FOR_NIGHTFALL conversations have completed.
    dayEndTimerExpiresAt: 0,     // Date.now() timestamp when the nightfall delay expires.
    noNewConversations:   false, // true when nightfall delay expires → no new convs can start.

    // ── Conversation mutex ────────────────────────────────────────────────
    // Only ONE full AI conversation can run at a time.
    // This flag is read by simulation.js tick() before starting any conversation.
    // agentQueue.js has its own _conversationInProgress mirror for internal use.
    activeConversation: false,

    // ── Phase state ───────────────────────────────────────────────────────
    isNight:    false,      // true while gamePhase === 'Night' (triggers visual darkness).
    cycleTimer: 0,          // Ticks remaining in the current phase. Decremented each tick().
                            // Reaches 0 → phase transition fires.

    // ── Game identifiers ──────────────────────────────────────────────────
    gamePhase:     PHASE.DAY,   // Current phase string. One of the PHASE constants.
    murdererId:    null,        // ID of the one secret killer gator.
    deadIds:       new Set(),   // Set<number> of eliminated gator IDs. Fast O(1) alive check.
    nightVictimId: null,        // ID of the gator killed last night (revealed at dawn).
    voteTarget:    null,        // ID of the gator condemned by the most votes.
    dayNumber:     1,           // Current in-game day. Increments at triggerDawn().

    // ── Vote ceremony ─────────────────────────────────────────────────────
    // Sequential: showNextVoter() is called each time voteDisplayTimer hits 0.
    voteOrder:        [],  // Array<Person> — living gators in clockwise house-index order.
    voteIndex:        0,   // Index into voteOrder of the currently-displaying voter.
    voteResults:      {},  // { [gatorId]: voteCount } — running tally.
    voteDisplayTimer: 0,   // Ticks until the next voter is shown (set to VOTE_DISPLAY_TICKS each turn).
    voteHistory:      [],  // Array<{voterId, targetId}> — for post-round resentment calculation.

    // ── Execute animation ─────────────────────────────────────────────────
    // The condemned gator walks to centre stage; once close enough, executeTimer counts down.
    condemnedId:  null, // ID of the gator walking to their execution.
    executeTimer: 0,    // Ticks after the condemned reaches centre before finaliseExecution() fires.
};

// ── Reset helper — called on respawn ──────────────────────────
/**
 * Resets all game-progression fields in `state` back to Day 1 defaults.
 *
 * Called by simulation.js spawnGators() at the start of every new game.
 * Does NOT reset gators[] or houses[] — those are rebuilt by spawnGators()
 * separately. Only resets counters, flags, timers, and phase-tracking fields.
 *
 * WHY a separate reset function instead of re-assigning `state`?
 *   All other modules hold a live reference to the `state` object via ES import.
 *   If we replaced `state` with a new object, those references would point to the
 *   old stale object. Mutating in-place keeps all references valid.
 */
export function resetGameState() {
    state.completedConvCount   = 0;
    state.dayEndTimerActive    = false;
    state.dayEndTimerExpiresAt = 0;
    state.noNewConversations   = false;
    state.activeConversation   = false;
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
