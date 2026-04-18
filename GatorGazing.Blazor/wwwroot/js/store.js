import {
    APPLE_PRICE, ORANGE_PRICE, ORANGE_LOVER_DEBT_MAX,
    MEMORY_STRENGTH
} from './gameConfig.js';
import { rnd } from './helpers.js';
import { living } from './people.js';
import { state } from './state.js';

// ── Buy fish ─────────────────────────────────────────────────
// Returns how many of the requested fish were purchased (0 if can't afford).
// Swordfish lovers will take on debt up to ORANGE_LOVER_DEBT_MAX to buy swordfish.
export function buyFruit(person, fruitType) {
    const price = fruitType === 'orange' ? ORANGE_PRICE : APPLE_PRICE;

    if (fruitType === 'apple') {
        if (person.money < APPLE_PRICE) return 0;
        const qty = Math.min(Math.floor(person.money / APPLE_PRICE), 1 + rnd(3));
        person.money  -= qty * APPLE_PRICE;
        person.apples += qty;
        return qty;
    }

    // Orange: lovers go into debt
    if (fruitType === 'orange') {
        const maxDebt   = person.orangeLover ? ORANGE_LOVER_DEBT_MAX : 0;
        const available = person.money + maxDebt - person.debt;
        if (available < ORANGE_PRICE) return 0;
        const maxQty = Math.max(1, Math.floor(available / ORANGE_PRICE));
        const qty    = person.orangeLover ? Math.min(maxQty, 1 + rnd(2)) : 1;
        const cost   = qty * ORANGE_PRICE;
        person.money   -= cost;
        person.oranges += qty;
        if (person.money < 0) {
            person.debt   += -person.money;
            person.money   = 0;
        }
        return qty;
    }
    return 0;
}

// ── Night theft ───────────────────────────────────────────────
// Called from triggerDawn to process what orange lovers did overnight.
export function processNightThefts() {
    const alive = living();
    for (const thief of alive.filter(p => p.orangeLover)) {
        // Only steal if they still want oranges and are broke
        const needsOranges = (thief.money + thief.debt) < ORANGE_PRICE;
        if (!needsOranges) continue;
        if (Math.random() > 0.65) continue; // 35% chance they decide to try tonight

        // Pick a target — prefer people they dislike who have money
        const targets = alive
            .filter(p => p.id !== thief.id && p.money > 0)
            .map(p => ({ p, score: (thief.relations[p.id] ?? 0) - rnd(25) }))
            .sort((a, b) => a.score - b.score); // most disliked first

        if (targets.length === 0) continue;
        const victim = targets[0].p;

        const stolen = Math.min(victim.money, ORANGE_PRICE + rnd(6));
        thief.money   += stolen;
        victim.money  -= stolen;
        if (victim.money < 0) victim.money = 0;
        victim.stolenFrom   = true;
        victim.stolenAmount = (victim.stolenAmount || 0) + stolen;

        // Some people were not fully asleep — they witness the theft
        const others = alive.filter(p => p.id !== thief.id && p.id !== victim.id);
        for (const witness of others) {
            const witnessChance = (MEMORY_STRENGTH[witness.personality] || 0.5) * 0.30;
            if (Math.random() < witnessChance) {
                witness.witnessedThefts.push({
                    thiefId:  thief.id,
                    victimId: victim.id,
                    day:      state.dayNumber
                });
                // Witness immediately gains suspicion
                witness.suspicion[thief.id] = Math.min(100,
                    (witness.suspicion[thief.id] ?? 0) + 40 + rnd(20));
                witness.conviction = Math.max(
                    witness.conviction,
                    witness.suspicion[thief.id]
                );
                witness.history.push({ day: state.dayNumber, type: 'witnessed_theft', thief: thief.id, victim: victim.id, detail: `Saw ${thief.name} steal from ${victim.name}` });
            }
        }
    }
}
