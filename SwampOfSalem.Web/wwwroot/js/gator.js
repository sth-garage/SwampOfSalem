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
export function createGator(index, house) {
    const personality = PERSONALITIES[rnd(PERSONALITIES.length)];
    const x = house.doorX + rndF(20) - 10;
    const y = house.doorY + rndF(20) - 10;
    const { W, H } = stageBounds();

    // Fixed personality traits: 1–10 scale, base ± up to 2
    const thoughtStat = Math.max(1, Math.min(10, THOUGHT_STAT_BASE[personality] + rnd(3) - 1));

    // Spread initial thought times across a wide window so no two gators think together at spawn
    const nextThoughtAt = Date.now() + Math.round(Math.random() * 18000 + 1500);

    return {
        id: state.nextId++,
        name: NAMES[(state.nextId-1) % NAMES.length],
        color: hsl(),
        personality,
        appearance: randomAppearance(index),
        homeIndex: index,
        indoors: false,
        guestOfIndex: null,
        activity: 'moving',
        talkingTo: null,
        message: null,
        thought: null,
        nextThoughtAt,      // real-time ms timestamp (replaces thoughtTimer)
        thoughtStat,
        ticksLeft: rndTicks('moving'),
        x: Math.max(0, Math.min(W, x)),
        y: Math.max(0, Math.min(H, y)),
        targetX: house.doorX,
        targetY: house.doorY,
        speed: WALK_SPEED[personality],
        relations: {},
        perceivedRelations: {},
        liar: false,
        suspicion: {},
        conviction: 0,
        voteMemory: [],
        nextSpeakAt: 0,      // real-time ms timestamp (replaces speakCooldown)
        recentTalkWith: {},  // partnerId → ms timestamp of last conversation end
        history: [],          // interaction history for report
        topicOpinions: generateTopicOpinions(personality), // topic -> opinion (-100..100)
        met: new Set(),       // IDs of alligators already introduced to
        chatLog: [],          // detailed chat history: { day, from, to, message, thought, ts }
        gameLog: [],          // overall game history: { day, type, detail, ts }
        isWaiting: false,     // true while waiting for AI response (show animated dots)
    };
}

// ── Relationship init & drift ─────────────────────────────────
export function initRelations() {
    for (const p of state.gators) {
        p.liar = Math.random() < LIAR_CHANCE[p.personality];
        p.relations          = {};
        p.perceivedRelations = {};
        p.met                = new Set();
        for (const q of state.gators) {
            if (p.id === q.id) continue;
            // All alligators start neutral toward each other.
            // Relations evolve through first-meeting introductions and drift.
            p.relations[q.id]          = 0;
            p.perceivedRelations[q.id] = 0;
        }
    }
}

export function driftRelations(a, b) {
    const compatBonus = (COMPAT[a.personality][b.personality] || 0) * 0.5;
    const driftA = compatBonus + (Math.random() * 16 - 6);
    const driftB = compatBonus + (Math.random() * 16 - 6);

    for (const p of state.gators) {
        if (p.id === a.id || p.id === b.id) continue;
        const bFeelsP = b.relations[p.id] ?? 0;
        const aFeelsP = a.relations[p.id] ?? 0;
        const alignment = (bFeelsP / 100) * (aFeelsP / 100) * 6;
        a.relations[b.id] = Math.max(-100, Math.min(100, (a.relations[b.id] ?? 0) + alignment));
    }

    a.relations[b.id] = Math.max(-100, Math.min(100, (a.relations[b.id] ?? 0) + driftA));
    b.relations[a.id] = Math.max(-100, Math.min(100, (b.relations[a.id] ?? 0) + driftB));

    if (a.liar && a.relations[b.id] < -20) {
        a.perceivedRelations[b.id] = Math.min(100, -a.relations[b.id] * 0.4 + rnd(20));
    } else {
        a.perceivedRelations[b.id] = a.relations[b.id];
    }
    if (b.liar && b.relations[a.id] < -20) {
        b.perceivedRelations[a.id] = Math.min(100, -b.relations[a.id] * 0.4 + rnd(20));
    } else {
        b.perceivedRelations[a.id] = b.relations[a.id];
    }
}

// ── Social helpers ────────────────────────────────────────────
export function socialWeights(gator) {
    return { ...ACTIVITY_WEIGHTS[gator.personality] };
}

export function living() { return state.gators.filter(p => !state.deadIds.has(p.id)); }


