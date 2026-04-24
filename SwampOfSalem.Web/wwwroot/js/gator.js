/**
 * @fileoverview gator.js — Alligator factory and relationship management.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * OVERVIEW FOR JUNIOR DEVELOPERS
 * ═══════════════════════════════════════════════════════════════════════
 *
 * This module creates and manages the "Person" objects that represent each
 * alligator on the simulation canvas. Think of a Person object as the
 * front-end equivalent of the C# `Alligator` class — it holds everything
 * the simulation needs to know about one character: where they are, what
 * they're doing, how they feel about everyone else, and all their history.
 *
 * KEY CONCEPT — The Person Object
 * ─────────────────────────────────────────────────────────────────────
 * Every time spawnGators() runs, it calls createGator() for each alligator
 * slot. The resulting objects live in `state.gators[]` and are mutated
 * directly throughout the simulation (no immutability). Modules like
 * simulation.js, phases.js, and rendering.js all read from and write to
 * these objects.
 *
 * Responsibilities exported from this module:
 *
 *   createGator(index, house)
 *     ↳ Builds one complete Person object. Picks a random personality,
 *       assigns stat baselines from PersonalityConstants, generates topic
 *       opinions, picks appearance data, and places the gator near their
 *       assigned house door.
 *
 *   initRelations()
 *     ↳ Called once after all gators are spawned. Resets every gator's
 *       `relations`, `perceivedRelations`, and `met` to clean starting
 *       values and randomly decides which gators become liars.
 *
 *   driftRelations(a, b)
 *     ↳ Called by simulation.js at the END of every conversation.
 *       Nudges both gators' relationship scores based on personality
 *       compatibility + random noise. Also updates perceivedRelations for
 *       liars (they hide their true feelings).
 *       Mirrors the C# RelationshipService.DriftRelations() algorithm.
 *
 *   socialWeights(gator)
 *     ↳ Returns the activity probability weights for weighted-random
 *       activity selection. Simply returns the gator's personality weights
 *       (extroverts talk more, introverts move more, etc.).
 *
 *   living()
 *     ↳ Returns only the gators not in `state.deadIds`. Used everywhere
 *       as the safe way to get "gators who can still act".
 *
 * IMPORTANT: The Person object fields are NOT documented on the C# model
 * because the frontend adds many extra fields (convTurns, _convHolding,
 * etc.) needed for conversation playback. See createGator() for the full
 * field inventory.
 *
 * @module gator
 */
import {
    GATOR_SIZE, ACTIVITY_WEIGHTS, WALK_SPEED,
    LIAR_CHANCE, COMPAT, PERSONALITIES, NAMES,
    THOUGHT_STAT_BASE
} from './gameConfig.js';
import {
    rnd, rndF, hsl, rndTicks, randomAppearance, stageBounds,
    thoughtDelayMs, generateTopicOpinions
} from './helpers.js';
import { state } from './state.js';

// ── Person factory ────────────────────────────────────────────
/**
 * Creates a fully-initialised Person object for one alligator slot.
 *
 * DESIGN NOTE — why one big factory function?
 *   All initial field values are set here in one place. If you need to add a
 *   new field to the Person object, add it here and it will exist on every
 *   gator from spawn-time forward. This avoids bugs from "undefined" fields.
 *
 * @param {number} index  - Slot index (0-based), used as homeIndex / house array index.
 * @param {{doorX:number, doorY:number}} house - The gator's assigned house position.
 * @returns {object} A fully-initialised Person object.
 */
export function createGator(index, house) {
    // Pick a personality at random from the available archetypes.
    // Personality drives walk speed, activity weights, AI prompt tone, and
    // social stat baselines. See PersonalityConstants.cs for the full spec.
    const personality = PERSONALITIES[rnd(PERSONALITIES.length)];

    // Start the gator near their front door (± 10px jitter so they don't overlap).
    const x = house.doorX + rndF(20) - 10;
    const y = house.doorY + rndF(20) - 10;
    const { W, H } = stageBounds();

    // thoughtStat: how perceptive / introspective this gator is (1–10 scale).
    // Base comes from the personality constant, then ±1 random variation.
    // Introverts and Grumpy gators trend toward 7–10; Extroverts/Cheerful trend 2–5.
    const thoughtStat = Math.max(1, Math.min(10, THOUGHT_STAT_BASE[personality] + rnd(3) - 1));

    // Spread initial thought timers across a wide window (1.5–19.5 s) so no two
    // gators think at exactly the same time when the simulation first starts.
    const nextThoughtAt = Date.now() + Math.round(Math.random() * 18000 + 1500);

    return {
        // ── Identity ───────────────────────────────────────────────────────
        id: state.nextId++,                            // Monotonically increasing integer ID.
        name: NAMES[(state.nextId-1) % NAMES.length], // Name from the shared name pool.
        color: hsl(),                                  // Random bright HSL color (used as accent).
        personality,                                   // Archetype string, e.g. "cheerful".
        appearance: randomAppearance(index),           // Hat, shirt color, skin tone.

        // ── Position & layout ──────────────────────────────────────────────
        homeIndex: index,  // Which house slot this gator owns (culde-sac index).
        indoors: false,    // true when gator is inside their house (hosting/visiting).
        guestOfIndex: null,// homeIndex of the house they're visiting, or null.
        x: Math.max(0, Math.min(W, x)),  // Current pixel X (clamped to stage bounds).
        y: Math.max(0, Math.min(H, y)),  // Current pixel Y.
        targetX: house.doorX,            // Where the gator is moving toward.
        targetY: house.doorY,

        // ── Movement ───────────────────────────────────────────────────────
        speed: WALK_SPEED[personality], // Pixels per animation frame. Energetic gators move fast.

        // ── Activity & tick state ──────────────────────────────────────────
        // The `activity` field drives rendering class, AI dialog type selection,
        // and which branch of the tick loop runs for this gator.
        activity: 'moving',    // Current state: 'moving'|'talking'|'hosting'|'visiting'|'debating'|'resting'
        talkingTo: null,       // ID of conversation partner, or null.
        ticksLeft: rndTicks('moving'), // How many ticks remain in the current activity.

        // ── Visible speech & thought ───────────────────────────────────────
        message: null,   // Currently displayed speech bubble text (or null = no bubble).
        thought: null,   // Currently displayed thought bubble text (private, only in the panel).

        // ── AI timing controls ─────────────────────────────────────────────
        // These use real-time timestamps (Date.now()) rather than tick counts
        // so speech and thought timing is smooth regardless of tick rate.
        nextThoughtAt,    // Timestamp after which this gator may generate a new thought.
        nextSpeakAt: 0,   // Timestamp after which this gator may speak again (debate cooldown).

        // ── Stats (1–10 scale) ─────────────────────────────────────────────
        // thoughtStat = how perceptive/analytical the gator is.
        // High = notices clues, more analytical thoughts, harder to fool.
        thoughtStat,

        // ── Social tracking ────────────────────────────────────────────────
        // recentTalkWith: partner ID → timestamp of last conversation end.
        // Enforces the 60-second cooldown between the same two gators talking again.
        recentTalkWith: {},

        // ── Relationships ──────────────────────────────────────────────────
        // Both start empty; populated by initRelations() and grown by driftRelations().
        relations: {},          // How THIS gator truly feels about others. Key = other ID, Value = -100..+100.
        perceivedRelations: {}, // How THIS gator PRESENTS their feelings (liars skew this).

        // ── Liar flag ─────────────────────────────────────────────────────
        // Assigned by initRelations() based on personality-specific liar chance.
        // Liars flip their perceivedRelations when they dislike someone.
        liar: false,

        // ── Suspicion & voting ────────────────────────────────────────────
        // suspicion: how much this gator suspects each other of being the murderer.
        // Key = suspect ID, Value = 0..100. Above CONVICTION_THRESHOLD (55) = will accuse.
        suspicion: {},
        conviction: 0,      // Highest current suspicion score (updated each debate tick).
        voteMemory: [],     // [{voterId, targetId}] for all votes this gator witnessed.

        // ── History logs ──────────────────────────────────────────────────
        // history: structured activity log used in end-game summary report.
        history: [],
        // chatLog: detailed record of every message/thought for the gator panel.
        // Each entry: { day, from, to, message, thought, ts, type }
        chatLog: [],
        // gameLog: high-level per-tick events.
        gameLog: [],

        // ── Topic opinions ────────────────────────────────────────────────
        // Four-key object generated by helpers.generateTopicOpinions().
        // Example: { sports_team: 'Rockets', local_gossip: 45, swamp_leadership: -30, ... }
        topicOpinions: generateTopicOpinions(personality),

        // ── First-meeting tracking ─────────────────────────────────────────
        // met: Set of gator IDs this gator has been formally introduced to.
        // Used to decide whether to use 'introduction' or 'conversation' dialog type.
        met: new Set(),

        // ── AI conversation playback state ────────────────────────────────
        // These fields are set by agentQueue.requestFullConversation() and
        // cleared once the last turn has been displayed.
        // _convTurns:      Array of turn objects from the AI response.
        // _convTurnIndex:  Index of the next turn to display.
        // _convPartner:    The other gator in the current AI conversation.
        // _convIsPrivate:  Whether this is a hosting (private) conversation.
        // _convOnComplete: Callback fired after the last turn + 3-second hold.
        // _convHolding:    true during the 3-second post-conversation hold.
        isWaiting: false,   // true while the AI HTTP call is in-flight (shows spinning dots).
    };
}

// ── Relationship init & drift ─────────────────────────────────
/**
 * Seeds all relationship dictionaries to neutral (0) for every gator pair
 * and randomly assigns liar flags. Called ONCE after spawnGators() creates
 * all Person objects.
 *
 * WHY call this separately from createGator()?
 *   Because relationships are bidirectional — gator A's entry for gator B
 *   and gator B's entry for gator A must both be set. That requires ALL
 *   gators to exist first. So createGator() creates the empty dicts and
 *   initRelations() populates them in a second pass.
 */
export function initRelations() {
    for (const p of state.gators) {
        // Liar chance is personality-specific (from PersonalityConstants / gameConfig.js).
        // About 10–45% of gators become liars depending on personality.
        p.liar = Math.random() < LIAR_CHANCE[p.personality];

        // Reset everything to clean neutral state.
        p.relations          = {};
        p.perceivedRelations = {};
        p.met                = new Set(); // Clear any prior introductions.

        for (const q of state.gators) {
            if (p.id === q.id) continue; // Skip self-relation.

            // All alligators start neutral toward each other.
            // Relations evolve through first-meeting introductions and drift.
            p.relations[q.id]          = 0;
            p.perceivedRelations[q.id] = 0;
        }
    }
}

/**
 * Applies post-conversation relationship drift to BOTH gators.
 *
 * ALGORITHM (mirrors C# RelationshipService.DriftRelations):
 * ──────────────────────────────────────────────────────────
 *  compatBonus = COMPAT[a.personality][b.personality] * 0.5
 *     (e.g. Cheerful+Extrovert = +9*0.5 = +4.5; Grumpy+Energetic = -8*0.5 = -4)
 *
 *  driftA = compatBonus + Random(-6..+10)   (mean ≈ +2)
 *  driftB = compatBonus + Random(-6..+10)   (asymmetric noise — each feels differently)
 *
 *  New relation = clamp(old + drift, -100, +100)
 *
 * ALIGNMENT BONUS:
 *   For every third gator C, if A and B both feel similarly about C,
 *   their relation with each other gets a small positive nudge.
 *   ("We both like/hate the same person — we must agree on something!")
 *   This creates emergent friend-groups and rival factions over time.
 *
 * LIAR SKEW:
 *   If a gator is a liar AND dislikes the other (relation < -20),
 *   they flip their perceivedRelations to appear friendly — their
 *   displayed attitude is the opposite of their true feeling.
 *
 * @param {object} a - First gator (Person object).
 * @param {object} b - Second gator (Person object).
 */
export function driftRelations(a, b) {
    // Step 1: Get the base compatibility bonus from the personality pair.
    // COMPAT is a nested dict imported from gameConfig.js (mirrors C# RelationshipService.Compat).
    const compatBonus = (COMPAT[a.personality][b.personality] || 0) * 0.5;

    // Step 2: Compute per-gator drift with independent random noise.
    // Range: [-6, +10], mean ≈ +2 (slightly positive drift encourages eventual bonding).
    const driftA = compatBonus + (Math.random() * 16 - 6);
    const driftB = compatBonus + (Math.random() * 16 - 6);

    // Step 3: Alignment bonus — if A and B both feel the same way about C,
    // their relationship nudges slightly closer.
    for (const p of state.gators) {
        if (p.id === a.id || p.id === b.id) continue;
        const bFeelsP = b.relations[p.id] ?? 0;
        const aFeelsP = a.relations[p.id] ?? 0;
        // Multiply both sentiments (both positive → positive product, both negative → positive).
        // Divides by 100² to normalise, multiplied by 6 for a gentle push.
        const alignment = (bFeelsP / 100) * (aFeelsP / 100) * 6;
        a.relations[b.id] = Math.max(-100, Math.min(100, (a.relations[b.id] ?? 0) + alignment));
    }

    // Step 4: Apply the drift to both directions (clamped to [-100, +100]).
    const prevA = a.relations[b.id] ?? 0;
    const prevB = b.relations[a.id] ?? 0;
    a.relations[b.id] = Math.max(-100, Math.min(100, prevA + driftA));
    b.relations[a.id] = Math.max(-100, Math.min(100, prevB + driftB));

    // Record notable drift into history so the summary can explain reputation changes
    const deltaA = Math.round(a.relations[b.id] - prevA);
    const deltaB = Math.round(b.relations[a.id] - prevB);
    if (Math.abs(deltaA) >= 5) {
        a.history.push({ day: state.dayNumber, type: 'relation_drift', with: b.id, delta: deltaA, detail: `Relationship with ${b.name} shifted by ${deltaA > 0 ? '+' : ''}${deltaA} after spending time together.` });
    }
    if (Math.abs(deltaB) >= 5) {
        b.history.push({ day: state.dayNumber, type: 'relation_drift', with: a.id, delta: deltaB, detail: `Relationship with ${a.name} shifted by ${deltaB > 0 ? '+' : ''}${deltaB} after spending time together.` });
    }

    // Step 5: Update perceivedRelations to account for liars.
    // A liar with a strongly negative relation pretends to feel positive — they hide hatred.
    if (a.liar && a.relations[b.id] < -20) {
        // Perceived = positive (roughly the negative flipped + noise), capped at 100.
        a.perceivedRelations[b.id] = Math.min(100, -a.relations[b.id] * 0.4 + rnd(20));
    } else {
        a.perceivedRelations[b.id] = a.relations[b.id]; // Honest gators show their real feeling.
    }
    if (b.liar && b.relations[a.id] < -20) {
        b.perceivedRelations[a.id] = Math.min(100, -b.relations[a.id] * 0.4 + rnd(20));
    } else {
        b.perceivedRelations[a.id] = b.relations[a.id];
    }
}

// ── Social helpers ────────────────────────────────────────────
/**
 * Returns the weighted-activity probability object for a gator.
 *
 * The simulation uses `weightedPick(socialWeights(gator))` in the tick loop
 * to choose what a gator should do next when their current activity ends.
 *
 * The weights come from PersonalityConstants.ActivityWeights:
 *   - Extrovert: { moving:15, talking:65, hosting:20 } — loves to chat & host
 *   - Introvert: { moving:50, talking:35, hosting:15 } — prefers wandering alone
 *   - Energetic: { moving:45, talking:45, hosting:10 } — always on the move or talking
 *   (etc.)
 *
 * NOTE: The weights do NOT currently adapt to SocialNeed. A future enhancement
 * could increase the 'talking' weight when socialNeed is high.
 *
 * @param {object} gator - Person object.
 * @returns {{ moving:number, talking:number, hosting:number }} Activity probability weights.
 */
export function socialWeights(gator) {
    // Simply return the personality-specific preset — no current runtime adaptation.
    return { ...ACTIVITY_WEIGHTS[gator.personality] };
}

/**
 * Returns the array of living (non-dead) gators from global state.
 *
 * Usage pattern throughout the codebase:
 *   `for (const p of living()) { ... }`
 *   `living().filter(q => q.id !== someid)`
 *
 * WHY NOT just use state.gators.filter()?
 *   Because this function encapsulates the dead-check logic. If the
 *   definition of "living" ever changes (e.g. spectators, ghosts), only
 *   this one function needs updating.
 *
 * @returns {object[]} Filtered array of Person objects that are not in state.deadIds.
 */
export function living() { return state.gators.filter(p => !state.deadIds.has(p.id)); }


