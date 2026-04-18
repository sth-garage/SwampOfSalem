import {
    PERSON_SIZE, SOCIAL_URGENT, ACTIVITY_WEIGHTS, WALK_SPEED,
    SOCIAL_START, LIAR_CHANCE, COMPAT, PERSONALITIES, NAMES,
    THOUGHT_STAT_BASE, SOCIAL_STAT_BASE, ORANGE_LOVER_CHANCE
} from './gameConfig.js';
import {
    rnd, rndF, hsl, rndTicks, pickThought, randomAppearance, stageBounds,
    thoughtDelayMs
} from './helpers.js';
import { state } from './state.js';

// ── Person factory ────────────────────────────────────────────
export function createPerson(index, house) {
    const personality = PERSONALITIES[rnd(PERSONALITIES.length)];
    const x = house.doorX + rndF(20) - 10;
    const y = house.doorY + rndF(20) - 10;
    const { W, H } = stageBounds();

    // Fixed personality traits: 1–10 scale, base ± up to 2
    const thoughtStat = Math.max(1, Math.min(10, THOUGHT_STAT_BASE[personality] + rnd(3) - 1));
    const socialStat  = Math.max(1, Math.min(10, SOCIAL_STAT_BASE[personality]  + rnd(3) - 1));

    // Spread initial thought times across a wide window so no two people think together at spawn
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
        thought: pickThought(personality),
        nextThoughtAt,      // real-time ms timestamp (replaces thoughtTimer)
        thoughtStat,
        socialStat,
        socialNeed: SOCIAL_START[personality],
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
        // Fruit store
        money: rnd(21),       // 0–20 dollars at spawn
        apples: 0,
        oranges: 0,
        debt: 0,
        orangeLover: Math.random() < ORANGE_LOVER_CHANCE[personality],
        stolenFrom: false,
        stolenAmount: 0,
        witnessedThefts: [],  // { thiefId, victimId, day }
        spendingObserved: {}, // personId -> oranges seen buying
        history: []           // interaction history for report
    };
}

// ── Relationship init & drift ─────────────────────────────────
export function initRelations() {
    for (const p of state.people) {
        p.liar = Math.random() < LIAR_CHANCE[p.personality];
        p.relations          = {};
        p.perceivedRelations = {};
        for (const q of state.people) {
            if (p.id === q.id) continue;
            const base = (Math.random() * 200) - 100;
            p.relations[q.id] = base;
            if (p.liar && base < -20) {
                p.perceivedRelations[q.id] = Math.min(100, -base * 0.4 + rnd(25));
            } else {
                p.perceivedRelations[q.id] = base;
            }
        }
    }
}

export function driftRelations(a, b) {
    const compatBonus = (COMPAT[a.personality][b.personality] || 0) * 0.5;
    const driftA = compatBonus + (Math.random() * 16 - 6);
    const driftB = compatBonus + (Math.random() * 16 - 6);

    for (const p of state.people) {
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
export function socialWeights(person) {
    const base = { ...ACTIVITY_WEIGHTS[person.personality] };

    // socialStat boosts talking & hosting — higher stat = more driven to chat
    base.talking = (base.talking || 0) + person.socialStat * 4;
    base.hosting = (base.hosting || 0) + person.socialStat * 1.5;

    if (person.socialNeed < SOCIAL_URGENT) {
        const urgency = ((SOCIAL_URGENT - person.socialNeed) / SOCIAL_URGENT) * 120;
        base.talking  = (base.talking  || 0) + urgency;
        base.hosting  = (base.hosting  || 0) + urgency * 0.4;
        base.moving   = (base.moving   || 0) + urgency * 0.5;
    }
    if (person.orangeLover) {
        base.shopping = (base.shopping || 0) + 22;
    }
    return base;
}

export function living() { return state.people.filter(p => !state.deadIds.has(p.id)); }
