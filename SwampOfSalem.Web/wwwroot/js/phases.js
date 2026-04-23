/**
 * @fileoverview phases.js — Game phase transition logic and timing.
 *
 * Each exported function triggers one phase of the murder-mystery cycle:
 *
 *   triggerNightfall()   Day → Night
 *     Selects the murder victim (mirrors C# MurderService.SelectVictim),
 *     sends all gators home, activates the night overlay.
 *
 *   triggerDawn()        Night → Dawn
 *     Reveals the body, injects murder memories into all agents,
 *     updates suspicion scores, plays mourning reactions.
 *
 *   triggerDebate()      Dawn → Debate
 *     Each gator takes turns making accusations or defences via the AI.
 *     Suspicion scores influence who accuses whom (mirrors MurderService logic).
 *
 *   triggerVote()        Debate → Vote
 *     Establishes clockwise vote order and kicks off the sequential voting ceremony.
 *
 *   showNextVoter()      Internal — advances the vote cursor one step.
 *
 *   triggerExecute()     Vote → Execute
 *     Tallies votes, announces the condemned gator, plays the execution walk.
 *
 *   finaliseExecution()  Called after the execute animation completes.
 *     Eliminates the condemned gator, checks game-over conditions, cycles to Day.
 *
 *   pickDebateSuspect()  Utility — returns the best accusation target for a gator.
 *     Murderers prefer innocents already suspected by others (safe deflection).
 *     Towngators prefer whoever they personally suspect most.
 *
 * @module phases
 */
import {
    GATOR_SIZE, PHASE, DAY_TICKS, NIGHT_TICKS, DAWN_TICKS, DEBATE_TICKS,
    VOTE_DISPLAY_TICKS,
    MEMORY_STRENGTH, MAX_DEBATE_SPEAKERS,
    DEBATE_SPEAK_COOLDOWN, PERSONALITY_EMOJI
} from './gameConfig.js';
import { rnd, rndF, speakDelayMs } from './helpers.js';
import { living } from './gator.js';
import { state } from './state.js';
import { renderAllGators, updateStats, updatePhaseLabel, updateHouseGuests, showDeadBody } from './rendering.js';
import { requestDialog, recordMemory, requestNightReport, requestFullConversation, requestDebateSpeech } from './agentQueue.js';

// ── Helpers ───────────────────────────────────────────────────
function setNightOverlay(night) {
    const ov = document.getElementById('night-overlay');
    if (ov) ov.classList.toggle('active', night);
    document.getElementById('world').classList.toggle('night', night);
}

/**
 * Selects the murderer's next victim using a weighted scoring algorithm.
 *
 * VICTIM SELECTION FORMULA:
 * ─────────────────────────────────────────────────────────────────
 *   score(candidate) =
 *     candidate.suspicion[murdererId] × 0.6    ← Most dangerous: targets the most suspicious
 *     - killer.relations[candidate.id] × 0.3   ← Prefers to eliminate disliked gators
 *     + random(0, 20)                           ← Small random factor for unpredictability
 *
 *   Victim = candidate with HIGHEST score
 *
 * STRATEGIC IMPLICATION:
 *   Gators who voice suspicion during debates are painting targets on themselves.
 *   The murderer watches who is most onto them and eliminates that threat first.
 *   The random factor means even low-suspicion gators have a small chance,
 *   preventing the killer from being entirely predictable.
 *
 * @returns {object|null} The victim Person object, or null if no candidates remain.
 */
function murderVictim() {
    const killer = state.gators.find(p => p.id === state.murdererId);
    if (!killer) return null;
    const candidates = living().filter(p => p.id !== state.murdererId);
    if (candidates.length === 0) return null;
    return candidates.reduce((best, c) => {
        // Prioritise killing those who most suspect the murderer, then those the killer dislikes
        const cSuspects = c.suspicion[state.murdererId] ?? 0;
        const bSuspects = best.suspicion[state.murdererId] ?? 0;
        const cs = cSuspects * 0.6 - (killer.relations[c.id]    ?? 0) * 0.3 + rnd(20);
        const bs = bSuspects * 0.6 - (killer.relations[best.id] ?? 0) * 0.3 + rnd(20);
        return cs > bs ? c : best;
    });
}

/**
 * Returns the best accusation target for a gator during the debate phase.
 *
 * TWO STRATEGIES based on the gator's role:
 *
 * MURDERER PATH:
 *   The murderer never accuses themselves. Instead they deflect:
 *   1. Find all innocent gators (not themselves).
 *   2. Prefer innocents who are ALREADY suspected by others — this is safer because
 *      accusing someone others already suspect looks legitimate and reinforces distrust.
 *   Score: (sum of suspicion from all others) × 0.5
 *          - killer's own relation to the target × 0.4
 *          + random(20)
 *
 * TOWNGATOR PATH:
 *   Simply vote for whoever they personally suspect most:
 *   Score: suspicion[target] × 0.7 - relation[target] × 0.3
 *   (Gators they distrust AND suspect are higher priority)
 *
 * @param {object} p - The debating Person object.
 * @returns {object|null} The target Person object, or null if no candidates.
 */
export function pickDebateSuspect(p) {
    const alive = living().filter(q => q.id !== p.id);
    if (alive.length === 0) return null;
    if (p.id === state.murdererId) {
        const innocents = alive.filter(q => q.id !== state.murdererId);
        if (innocents.length === 0) return alive[0];
        // Prefer innocents others already suspect (reinforces distrust safely)
        return innocents.reduce((best, c) => {
            const cAlreadySuspected = living().filter(q => q.id !== state.murdererId)
                .reduce((s, q) => s + (q.suspicion[c.id] ?? 0), 0);
            const bAlreadySuspected = living().filter(q => q.id !== state.murdererId)
                .reduce((s, q) => s + (q.suspicion[best.id] ?? 0), 0);
            const cScore = cAlreadySuspected * 0.5 - (p.relations[c.id]    ?? 0) * 0.4 + rnd(20);
            const bScore = bAlreadySuspected * 0.5 - (p.relations[best.id] ?? 0) * 0.4 + rnd(20);
            return cScore > bScore ? c : best;
        }, innocents[0]);
    }
    return alive.reduce((best, c) => {
        const bScore = (p.suspicion[best.id] ?? 0) * 0.7 - (p.relations[best.id] ?? 0) * 0.3;
        const cScore = (p.suspicion[c.id]    ?? 0) * 0.7 - (p.relations[c.id]    ?? 0) * 0.3;
        return cScore > bScore ? c : best;
    });
}

// ── Phase transitions ──────────────────────────────────────────

/**
 * DAY → NIGHT phase transition.
 *
 * SEQUENCE:
 *   1. Set gamePhase = NIGHT, cycleTimer = NIGHT_TICKS.
 *   2. Select the murder victim using murderVictim() and store in state.nightVictimId.
 *   3. Record a murder memory for the killer's AI agent.
 *   4. Abort all active conversations: clear talkingTo, message, guestOfIndex.
 *   5. Send every living gator indoors (indoors=true, activity='resting').
 *   6. Clear all talk-line SVG elements from the stage.
 *   7. Activate the night overlay CSS (dark tint).
 *   8. Pause the simulation and call requestNightReport().
 *      → The night report panel shows each gator's inner thoughts.
 *      → The Promise resolves when the player clicks "Continue to Morning".
 *   9. On Continue: un-pause, call triggerDawn().
 *
 * WHY pause during the night report?
 *   The simulation tick must be paused so no game logic runs while the player
 *   is reading the night reflections. The simulation resumes the moment the
 *   player dismisses the panel.
 */
export function triggerNightfall() {
    // If only 2 gators remain and the murderer is one of them, they win instantly.
    const alive = living();
    if (alive.length <= 2 && alive.some(p => p.id === state.murdererId)) {
        const victim = alive.find(p => p.id !== state.murdererId);
        if (victim) {
            state.deadIds.add(victim.id);
            victim.deathOrder = state.deadIds.size;
            victim.deathDay   = state.dayNumber;
            victim.deathType  = 'murdered';
        }
        triggerGameOver(false);
        return;
    }

    state.gamePhase      = PHASE.NIGHT;
    state.isNight        = true;
    state.cycleTimer     = NIGHT_TICKS;
    state.nightVictimId  = (murderVictim() || {id: null}).id;
    if (state.nightVictimId !== null) {
        recordMemory(state.murdererId, state.dayNumber, 'murder', `Murdered ${state.gators.find(p => p.id === state.nightVictimId)?.name || 'someone'}`, state.nightVictimId);
    }
    for (const p of living()) {
        if (p.talkingTo !== null) {
            const partner = state.gators.find(q => q.id === p.talkingTo);
            if (partner) { partner.talkingTo = null; partner.message = null; }
            p.talkingTo = null; p.message = null;
        }
        p.guestOfIndex = null;
        p.indoors   = true;
        p.activity  = 'resting';
        p.ticksLeft = NIGHT_TICKS + 2;
        const h = state.houses[p.homeIndex];
        p.x = h.doorX - GATOR_SIZE / 2;
        p.y = h.doorY - GATOR_SIZE;
        const el = document.getElementById(`gator-${p.id}`);
        if (el) { el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; }
    }
    state.talkLines.forEach(l => l.remove()); state.talkLines.clear();
    updateHouseGuests();
    setNightOverlay(true);
    updatePhaseLabel();
    renderAllGators();
    updateStats();

    // Pause simulation and show night report panel; resume when user clicks "Continue to Morning"
    const wasPaused = state.paused;
    state.paused = true;
    requestNightReport().then(() => {
        if (!wasPaused) state.paused = false;
        triggerDawn();
    });
}

/**
 * NIGHT → DAWN phase transition.
 *
 * SEQUENCE:
 *   1. Set gamePhase = DAWN, cycleTimer = DAWN_TICKS.
 *   2. Remove night overlay (day returns).
 *   3. Increment dayNumber (now a new day).
 *   4. Add nightVictimId to state.deadIds; record deathOrder, deathDay, deathType.
 *   5. Call showDeadBody() to place the 💀 death marker at the victim's position.
 *   6. Move all living gators back outside their house doors.
 *   7. Assign reaction messages:
 *        Murderer: "How terrible… {name} is gone."
 *        Everyone else: "Oh no… {name} was found dead!"
 *   8. recordMemory() for all living gators with a 'dawn' event.
 *
 * SUSPICION NOTE:
 *   Dawn does NOT directly update suspicion scores here — that happens implicitly
 *   through the AI memory injection (gators remember who died and will reference it
 *   in their next conversation) and through the debate-phase suspicion seeding.
 */
export function triggerDawn() {
    state.gamePhase = PHASE.DAWN;
    state.isNight   = false;
    state.cycleTimer = DAWN_TICKS;
    setNightOverlay(false);
    state.dayNumber++;
    if (state.nightVictimId !== null) {
        state.deadIds.add(state.nightVictimId);
        const victim = state.gators.find(p => p.id === state.nightVictimId);
        if (victim) {
            victim.deathOrder = state.deadIds.size;
            victim.deathDay = state.dayNumber;
            victim.deathType = 'murdered';
        }
        showDeadBody(state.nightVictimId);
    }

    for (const p of living()) {
        const h = state.houses[p.homeIndex];
        p.indoors   = false;
        p.activity  = 'moving';
        p.ticksLeft = 2 + rnd(3);
        p.x = h.doorX + rndF(16) - 8;
        p.y = h.doorY + rndF(16) - 8;
        if (state.nightVictimId !== null) {
            const victimName = state.gators.find(q => q.id === state.nightVictimId)?.name || 'Someone';
            p.message = p.id === state.murdererId
                ? `How terrible… ${victimName} is gone.`
                : `Oh no… ${victimName} was found dead!`;
        }
        recordMemory(p.id, state.dayNumber, 'dawn', state.nightVictimId !== null ? `${state.gators.find(q=>q.id===state.nightVictimId)?.name||'Someone'} was found dead.` : 'Another night passed.', state.nightVictimId);
    }
    updateHouseGuests();
    renderAllGators();
    updateStats();
    updatePhaseLabel();
}

// ── Staggered debate ────────────────────────────────────────────

/**
 * DAWN → DEBATE phase transition.
 *
 * OVERVIEW:
 *   All living gators gather at their house doors and take turns accusing or
 *   defending. The tick loop handles ongoing speech (via simulation.js) once
 *   this function seeds the initial state.
 *
 * SEQUENCE:
 *   1. Set gamePhase = DEBATE, cycleTimer = DEBATE_TICKS.
 *   2. For every living gator:
 *      a. Set activity = 'debating', position toward house door exterior.
 *      b. Seed suspicion from relationships if not already set:
 *         suspicion[other] = max(0, -(relation[other] × 0.5) + random(20))
 *         (Gators who dislike someone already suspect them)
 *      c. Compute conviction = max suspicion score (+ 80 bonus for murderer).
 *      d. Call pickDebateSuspect() to find their accusation target.
 *      e. recordMemory() with 'debate_start' event.
 *   3. Floor queue:
 *      - All living gators are shuffled into state.debateSpeakerQueue.
 *      - advanceDebateSpeaker() is called immediately to give the first gator the floor.
 *      - The tick loop in simulation.js decrements state.debateSpeakerTimer each tick;
 *        when it hits 0, advanceDebateSpeaker() is called again for the next speaker.
 *      - The queue cycles (wraps around) until DEBATE_TICKS expire.
 *
 * PERSUASION (fires in advanceDebateSpeaker() when the floor-holder yields):
 *   When a gator speaks with conviction > CONVICTION_THRESHOLD, they nudge the
 *   suspicion scores of ALL other gators toward their target (not just nearby ones),
 *   weighted by how much each listener trusts the speaker.
 *   This allows charismatic / convinced gators to sway the vote.
 *
 * NOTE: This is the only phase where gators speak without AI calls.
 *   Debate lines are scripted templates rather than LLM-generated, because the AI
 *   is too slow for rapid-fire accusation exchange.
 */
export function triggerDebate() {
    state.gamePhase  = PHASE.DEBATE;
    state.cycleTimer = DEBATE_TICKS;

    const alive = living();

    // Seed suspicion & position everyone at their doors
    for (const p of alive) {
        p.activity  = 'debating';
        p.indoors   = false;
        p.ticksLeft = DEBATE_TICKS;
        p.message   = null;
        const h    = state.houses[p.homeIndex];
        const outX = Math.cos(h.angle + Math.PI) * 18;
        const outY = Math.sin(h.angle + Math.PI) * 18;
        p.targetX  = h.doorX + outX - GATOR_SIZE / 2;
        p.targetY  = h.doorY + outY - GATOR_SIZE / 2;
        // Seed suspicion from relationships (distrust = suspicion)
        for (const q of alive) {
            if (q.id === p.id) continue;
            if (p.suspicion[q.id] === undefined) {
                p.suspicion[q.id] = Math.max(0, -(p.relations[q.id] ?? 0) * 0.5 + rnd(20));
            }
        }
        // Compute conviction
        const suspect = pickDebateSuspect(p);
        if (suspect) {
            p.conviction = Math.min(100,
                (p.suspicion[suspect.id] ?? 0) +
                (p.id === state.murdererId ? 80 : 0));
        }
        recordMemory(p.id, state.dayNumber, 'debate_start', `Debate began. Most suspicious of ${suspect?.name || 'no one'}.`, suspect?.id ?? null);
    }

    // Build the floor queue — randomise the first round so it's not always
    // the same gator who opens the debate.
    state.debateSpeakerQueue   = alive.slice().sort(() => Math.random() - 0.5).map(p => p.id);
    state.debateSpeakerTimer   = 0;
    state.debateSpeakerWaiting = false;
    state.debateTranscript     = [];
    state.debateSpeechCount    = 0;
    state.debateEndAfter       = alive.length + 3; // everyone speaks once, then 3 more turns

    // Give the floor to the first speaker immediately
    advanceDebateSpeaker();

    renderAllGators();
    updateStats();
    updatePhaseLabel();
}

// ── Debate floor advancement ───────────────────────────────────

/**
 * Passes the debate floor to the next gator in the queue.
 *
 * Called by:
 *   - triggerDebate() (first speaker)
 *   - simulation.js tick() when debateSpeakerTimer hits 0 and debateSpeakerWaiting is false
 *
 * SEQUENCE:
 *   1. Check end condition: if debateSpeechCount >= debateEndAfter → triggerVote().
 *   2. Clear the previous speaker's message bubble.
 *   3. Apply persuasion for the outgoing speaker.
 *   4. Rotate the queue (front → back); skip dead gators.
 *   5. Set debateSpeakerWaiting = true (freeze the floor timer).
 *   6. Call requestDebateSpeech() → AI generates a reasoned accusation/defence.
 *   7. Display the speech, add to debateTranscript, record memory.
 *   8. Set debateSpeakerTimer; clear debateSpeakerWaiting.
 */
export function advanceDebateSpeaker() {
    // Check end condition first
    if (state.debateSpeechCount >= state.debateEndAfter && state.debateEndAfter > 0) {
        // Debate is over — clear all bubbles and move to vote
        for (const p of living()) p.message = null;
        triggerVote();
        return;
    }

    // Clear previous speaker's bubble and apply persuasion
    const prevId = state.debateSpeakerQueue[0];
    const prev   = prevId !== undefined ? state.gators.find(p => p.id === prevId) : null;
    if (prev) {
        const prevSuspect = pickDebateSuspect(prev);
        if (prevSuspect && prev.conviction > 0) {
            for (const listener of living()) {
                if (listener.id === prev.id) continue;
                const liking    = Math.max(0, listener.relations[prev.id] ?? 0);
                const influence = (liking / 100) * 20 + 3;
                listener.suspicion[prevSuspect.id] = Math.min(100,
                    (listener.suspicion[prevSuspect.id] ?? 0) + influence);
                listener.conviction = Math.min(100, Math.max(
                    listener.conviction ?? 0, listener.suspicion[prevSuspect.id]));
            }
        }
        prev.message = null;
    }

    // Rotate queue
    if (state.debateSpeakerQueue.length > 1) {
        state.debateSpeakerQueue.push(state.debateSpeakerQueue.shift());
    }

    // Skip dead gators
    let attempts = 0;
    while (attempts < state.debateSpeakerQueue.length) {
        if (!state.deadIds.has(state.debateSpeakerQueue[0])) break;
        state.debateSpeakerQueue.push(state.debateSpeakerQueue.shift());
        attempts++;
    }

    const speakerId = state.debateSpeakerQueue[0];
    const speaker   = speakerId !== undefined ? state.gators.find(p => p.id === speakerId) : null;
    if (!speaker || state.deadIds.has(speaker.id)) {
        // No valid speaker — set a short timer and try again
        const [dMin, dMax] = Array.isArray(DEBATE_SPEAK_COOLDOWN) ? DEBATE_SPEAK_COOLDOWN : [DEBATE_SPEAK_COOLDOWN, DEBATE_SPEAK_COOLDOWN];
        state.debateSpeakerTimer = dMin + rnd(dMax - dMin + 1);
        return;
    }

    const suspect = pickDebateSuspect(speaker);
    const victim  = state.nightVictimId !== null
        ? state.gators.find(p => p.id === state.nightVictimId) ?? null
        : null;

    // Freeze the floor timer while the AI call is in-flight
    state.debateSpeakerWaiting = true;
    state.debateSpeechCount++;

    requestDebateSpeech(speaker, suspect, victim).then(spoken => {
        // Bail if the phase has already advanced (e.g. vote triggered mid-AI call)
        if (state.gamePhase !== PHASE.DEBATE) return;

        speaker.message = spoken;
        speaker.thought = null;

        // Append to the running transcript
        state.debateTranscript.push({
            speakerId:   speaker.id,
            speakerName: speaker.name,
            message:     spoken,
        });

        // Record as a memory for all gators so they can reference it in future debates
        if (suspect) {
            // Speaker's own memory: "I accused X"
            recordMemory(speaker.id, state.dayNumber, 'past_debate_accuse',
                `In the Day ${state.dayNumber} debate I accused ${suspect.name}: "${spoken}"`, suspect.id);
            // Suspect's memory: "X accused me"
            recordMemory(suspect.id, state.dayNumber, 'past_debate_accused_me',
                `${speaker.name} accused me during the Day ${state.dayNumber} debate: "${spoken}"`, speaker.id);
            // All other gators: "X accused Y"
            for (const g of living()) {
                if (g.id === speaker.id || g.id === suspect.id) continue;
                recordMemory(g.id, state.dayNumber, 'past_debate_overheard',
                    `${speaker.name} accused ${suspect.name} in the Day ${state.dayNumber} debate: "${spoken}"`, speaker.id);
            }
            speaker.history.push({ day: state.dayNumber, type: 'debate_accused', target: suspect.id, detail: `Accused ${suspect.name}: "${spoken}"` });
            // Cross-day debate history — persists so future debates can reference it
            state.debateHistory.push({ day: state.dayNumber, accuserId: speaker.id, accuserName: speaker.name, targetId: suspect.id, targetName: suspect.name, type: 'accused', quote: spoken });
        } else {
            recordMemory(speaker.id, state.dayNumber, 'past_debate_defend',
                `In the Day ${state.dayNumber} debate I defended myself: "${spoken}"`, null);
            for (const g of living()) {
                if (g.id === speaker.id) continue;
                recordMemory(g.id, state.dayNumber, 'past_debate_overheard',
                    `${speaker.name} defended themselves in the Day ${state.dayNumber} debate: "${spoken}"`, speaker.id);
            }
            speaker.history.push({ day: state.dayNumber, type: 'debate_defended', detail: `Defended self: "${spoken}"` });
            // Cross-day debate history — persists so future debates can reference it
            state.debateHistory.push({ day: state.dayNumber, accuserId: speaker.id, accuserName: speaker.name, targetId: null, targetName: null, type: 'defended', quote: spoken });
        }

        // Release the floor timer
        const [dMin, dMax] = Array.isArray(DEBATE_SPEAK_COOLDOWN) ? DEBATE_SPEAK_COOLDOWN : [DEBATE_SPEAK_COOLDOWN, DEBATE_SPEAK_COOLDOWN];
        state.debateSpeakerTimer   = dMin + rnd(dMax - dMin + 1);
        state.debateSpeakerWaiting = false;
    });
}

// ── Vote ────────────────────────────────────────────────────────

/**
 * Determines who a gator will vote to execute (pure JavaScript logic, no AI call).
 *
 * TWO STRATEGIES:
 *
 * MURDERER STRATEGY:
 *   1. Check the current vote tally (state.voteResults).
 *   2. If the leading target is NOT the murderer, vote for them too
 *      (safer to pile on an innocent who is already losing).
 *   3. Otherwise: vote for the innocent they dislike most.
 *
 * TOWNGATOR STRATEGY:
 *   Score each candidate:
 *     score = suspicion[target] - (relation[target] × 0.3) + random(25)
 *   Vote for the highest-score candidate.
 *   The random factor (0–25) introduces slight unpredictability so gators
 *   with near-equal scores don't always produce the same outcome.
 *
 * @param {object} voter      - The Person object casting the vote.
 * @returns {object|null} The Person object they vote to execute, or null (abstain).
 */
export function decideVote(voter) {
    // During a tie-revote, only the tied candidates may be voted for
    const pool = state.tieRevote && state.tieRevoteCandidates.length > 0
        ? living().filter(q => q.id !== voter.id && state.tieRevoteCandidates.includes(q.id))
        : living().filter(q => q.id !== voter.id);
    const alive = pool;
    if (alive.length === 0) return null;

    if (voter.id === state.murdererId) {
        const topEntry = Object.entries(state.voteResults).sort((a,b) => b[1]-a[1])[0];
        if (topEntry && parseInt(topEntry[0]) !== state.murdererId) {
            const t = state.gators.find(q => q.id === parseInt(topEntry[0]));
            if (t && !state.deadIds.has(t.id)) return t;
        }
        const innocents = alive.filter(q => q.id !== state.murdererId);
        return innocents.length > 0
            ? innocents.reduce((best, c) =>
                (voter.relations[c.id] ?? 0) < (voter.relations[best.id] ?? 0) ? c : best
            , innocents[0]) : null;
    }

    return alive.reduce((best, c) => {
        const bScore = (voter.suspicion[best.id] ?? 0) - (voter.relations[best.id] ?? 0) * 0.3 + rnd(25);
        const cScore = (voter.suspicion[c.id]    ?? 0) - (voter.relations[c.id]    ?? 0) * 0.3 + rnd(25);
        return cScore > bScore ? c : best;
    });
}

/**
 * DEBATE → VOTE phase transition.
 *
 * Sets up the sequential vote ceremony:
 *   1. Set gamePhase = VOTE.
 *   2. Shuffle living gators into a random vote order (state.voteOrder[]).
 *   3. Reset state.voteResults = {} (fresh tally).
 *   4. Set state.voteDisplayTimer = VOTE_DISPLAY_TICKS so the tick loop
 *      knows how long to display each voter before advancing.
 *   5. Set cycleTimer to cover all voters + a buffer.
 *   6. Clear all speech bubbles.
 *   7. Call showNextVoter() to display the first voter immediately.
 *
 * SEQUENTIAL DISPLAY:
 *   The tick loop decrements state.voteDisplayTimer each tick.
 *   When it hits 0, tick() increments state.voteIndex and calls showNextVoter().
 *   This creates the "one vote at a time" dramatic reveal effect.
 */
export function triggerVote(tiedCandidateIds = null) {
    state.gamePhase        = PHASE.VOTE;
    state.voteOrder        = living().slice().sort(() => Math.random() - 0.5);
    state.voteIndex        = 0;
    state.voteResults      = {};
    state.voteDisplayTimer = VOTE_DISPLAY_TICKS;
    state.cycleTimer       = state.voteOrder.length * (VOTE_DISPLAY_TICKS + 1) + 2;
    if (tiedCandidateIds) {
        state.tieRevote           = true;
        state.tieRevoteCandidates = tiedCandidateIds;
    } else {
        state.tieRevote           = false;
        state.tieRevoteCandidates = [];
    }
    for (const p of living()) p.message = null;
    showNextVoter();
}

/**
 * Advances the vote ceremony by one voter.
 *
 * Called by:
 *   - triggerVote() immediately (first voter)
 *   - simulation.js tick() when voteDisplayTimer hits 0 (subsequent voters)
 *
 * SEQUENCE PER VOTER:
 *   1. Remove 'voting-active' highlight from the previous voter's sprite.
 *   2. If all voters have voted: triggerExecute().
 *   3. Get the current voter (state.voteOrder[state.voteIndex]).
 *   4. Call decideVote(voter) for the JS-logic vote decision.
 *   5. Increment state.voteResults[target.id].
 *   6. Push to state.voteHistory for post-game resentment tracking.
 *   7. Set voter.message = "I vote {name}!" (speech bubble).
 *   8. Add 'voting-active' CSS class to this voter's sprite (highlight).
 *   9. updateVoteTally() to refresh the vote bar chart.
 *  10. Reset state.voteDisplayTimer = VOTE_DISPLAY_TICKS.
 */
export function showNextVoter() {
    document.querySelectorAll('.voting-active').forEach(e => e.classList.remove('voting-active'));
    if (state.voteIndex >= state.voteOrder.length) { triggerExecute(); return; }

    const voter  = state.voteOrder[state.voteIndex];
    const target = decideVote(voter);  // JS fallback decision

    // Try agent vote (async), use JS fallback immediately
    if (target) {
        state.voteResults[target.id] = (state.voteResults[target.id] || 0) + 1;
        state.voteHistory.push({ voterId: voter.id, targetId: target.id });
        voter.message = `I vote ${target.name}!`;
        voter.history.push({ day: state.dayNumber, type: 'voted', target: target.id, detail: `Voted for ${target.name}` });
        recordMemory(voter.id, state.dayNumber, 'voted', `Voted for ${target.name}`, target.id);
    } else {
        voter.message = 'I abstain.';
        voter.history.push({ day: state.dayNumber, type: 'abstained', detail: `Abstained from voting` });
    }

    // Agent vote override removed — using JS decision only

    const voterEl = document.getElementById(`gator-${voter.id}`);
    if (voterEl) voterEl.classList.add('voting-active');

    updateVoteTally();
    updatePhaseLabel();
    renderAllGators();
    state.voteDisplayTimer = VOTE_DISPLAY_TICKS;
}

/**
 * Re-renders the live vote bar-chart panel (#vote-tally).
 * Called after every vote is cast so the player sees totals update in real time.
 *
 * Renders one row per living gator:
 *   {name} ════════░░░░  3
 *   {name} ═══░░░░░░░░  1
 *
 * The leading candidate's bar gets the 'leading' CSS class (coloured red).
 */
export function updateVoteTally() {
    const panel = document.getElementById('vote-tally');
    if (!panel) return;

    const totalVoters = state.voteOrder.length;
    let leadId = null, leadCount = 0;
    for (const [id, cnt] of Object.entries(state.voteResults)) {
        if (cnt > leadCount) { leadCount = cnt; leadId = parseInt(id); }
    }

    const rows = living().map(p => {
        const votes   = state.voteResults[p.id] || 0;
        const pct     = Math.round((votes / totalVoters) * 100);
        const leading = p.id === leadId && votes > 0;
        return `<div class="vt-row">
            <span class="vt-name">${p.name}</span>
            <div class="vt-bar-wrap">
                <div class="vt-bar${leading ? ' leading' : ''}" style="width:${pct}%"></div>
            </div>
            <span class="vt-count">${votes}</span>
        </div>`;
    }).join('');

    panel.innerHTML = `<div class="vt-title">\uD83D\uDDF3\uFE0F Vote Tally</div>${rows}`;
    panel.style.display = 'block';
}

// ── Execute ─────────────────────────────────────────────────────

/**
 * VOTE → EXECUTE phase transition.
 *
 * SEQUENCE:
 *   1. Tally state.voteResults: find the gator with the most votes.
 *      Ties → state.voteTarget = null (no execution).
 *   2. Apply vote-resentment side-effects:
 *      For each vote cast, every OTHER gator with a chance of remembering
 *      (MEMORY_STRENGTH[personality]) records who voted for whom.
 *      If a gator liked the vote TARGET, they resent the VOTER:
 *        voter.relations[voterId] -= 8
 *      This ensures votes have lasting social consequences beyond the execution.
 *   3. Remove voting-active highlights.
 *   4. If no condemned target (tie): call finaliseExecution() directly.
 *   5. Otherwise:
 *      - Set condemnedId, executeTimer = 3, gamePhase = EXECUTE.
 *      - Give the condemned gator activity='moving' toward centre-stage.
 *      - Give the condemned a scripted plea: "Please, not me! I'm innocent!"
 *      - Give bystanders a farewell message.
 *      - recordMemory() for all gators: 'execution' event.
 *
 * The actual elimination happens in finaliseExecution() once the condemned
 * walks close enough to the centre (checked in simulation.js tick()).
 */
export function triggerExecute() {
    // Find the maximum vote count
    let topCount = 0;
    for (const cnt of Object.values(state.voteResults)) {
        if (cnt > topCount) topCount = cnt;
    }

    // Collect all IDs that share that top count
    const tiedIds = topCount > 0
        ? Object.entries(state.voteResults)
            .filter(([, cnt]) => cnt === topCount)
            .map(([id]) => parseInt(id))
        : [];

    if (tiedIds.length > 1) {
        // There is a tie
        if (state.tieRevote) {
            // Already had one revote — pick a random victim from the tied set
            const randomVictimId = tiedIds[Math.floor(Math.random() * tiedIds.length)];
            state.voteTarget = randomVictimId;
            for (const p of living()) {
                if (p.id !== randomVictimId) p.message = `It had to be done… drew lots.`;
            }
            state.tieRevote           = false;
            state.tieRevoteCandidates = [];
        } else {
            // First tie — re-run the vote restricted to just the tied candidates.
            // Bump cycleTimer so the tick loop doesn't re-fire triggerExecute() before
            // the 3-second timeout has a chance to call triggerVote(tiedIds).
            state.cycleTimer = 999;
            document.querySelectorAll('.voting-active').forEach(e => e.classList.remove('voting-active'));
            for (const p of living()) {
                p.message = `It's a tie! Vote again between: ${tiedIds.map(id => state.gators.find(g => g.id === id)?.name).join(' & ')}`;
            }
            updateVoteTally();
            renderAllGators();
            setTimeout(() => triggerVote(tiedIds), 3000);
            return;
        }
    } else {
        state.voteTarget = tiedIds.length === 1 ? tiedIds[0] : null;
    }

    for (const entry of state.voteHistory) {
        for (const p of living()) {
            if (p.id === entry.voterId) continue;
            if (Math.random() < MEMORY_STRENGTH[p.personality]) {
                p.voteMemory.push(entry);
                const targetPerson = state.gators.find(q => q.id === entry.targetId);
                if (targetPerson) {
                    const feelingTowardTarget = p.relations[targetPerson.id] ?? 0;
                    if (feelingTowardTarget > 20) {
                        p.relations[entry.voterId] = Math.max(-100,
                            (p.relations[entry.voterId] ?? 0) - 8);
                        const voter = state.gators.find(q => q.id === entry.voterId);
                        if (voter) {
                            p.history.push({ day: state.dayNumber, type: 'resent_vote', about: entry.voterId, detail: `Resents ${voter.name} for voting against ${targetPerson.name}` });
                        }
                    }
                }
            }
        }
    }

    document.querySelectorAll('.voting-active').forEach(e => e.classList.remove('voting-active'));

    if (state.voteTarget === null) {
        finaliseExecution();
        return;
    }

    state.condemnedId  = state.voteTarget;
    state.executeTimer = 3;
    state.gamePhase    = PHASE.EXECUTE;
    state.cycleTimer   = state.executeTimer + 8;

    const condemned = state.gators.find(p => p.id === state.condemnedId);
    if (condemned) {
        condemned.activity  = 'moving';
        condemned.indoors   = false;
        condemned.message   = `Please, not me! I'm innocent!`;
        condemned.ticksLeft = 999;

        const worldEl = document.getElementById('world');
        condemned.targetX = (worldEl.clientWidth  / 2) - GATOR_SIZE / 2;
        condemned.targetY = (worldEl.clientHeight / 2) - GATOR_SIZE / 2;

        const el = document.getElementById(`gator-${state.condemnedId}`);
        if (el) el.classList.add('condemned');

        for (const p of living()) {
            if (p.id === state.condemnedId) continue;
            p.message = p.id === state.murdererId ? `Justice is served.` : `Goodbye, ${condemned.name}…`;
            recordMemory(p.id, state.dayNumber, 'execution', `Watched ${condemned.name} be executed`, condemned.id);
        }
    }

    renderAllGators();
    updatePhaseLabel();
    updateStats();
}

/**
 * Finalises an execution after the condemned gator reaches centre-stage.
 * Called from simulation.js tick() when the condemned is within 20px of centre.
 *
 * SEQUENCE:
 *   1. Hide the vote tally panel.
 *   2. Remove 'condemned' CSS highlight.
 *   3. If a target was set:
 *      a. Add target to state.deadIds.
 *      b. Record deathOrder, deathDay, deathType = 'executed'.
 *      c. Push history entries to all living gators (witnessed_execution, disagreed_vote).
 *      d. Place a coffin emoji marker on the stage at the condemned gator's position.
 *      e. Add 'dead' CSS class to the gator sprite.
 *   4. WIN CHECK:
 *      - If murdererId is in deadIds: triggerGameOver(true)  → TOWN WINS
 *      - If living().length <= 1:     triggerGameOver(false) → MURDERER WINS
 *      - Otherwise: start a new Day
 *        (reset cycleTimer, completedConvCount, conversationFlags, move gators outside)
 *
 * SUSPICION DECAY ON NEW DAY:
 *   All surviving gators' suspicion scores are reduced by 10 points.
 *   This prevents the game from becoming trivially locked (everyone always
 *   votes the same person every round). Some recalibration is needed each day.
 */
export function finaliseExecution() {
    const panel = document.getElementById('vote-tally');
    if (panel) panel.style.display = 'none';

    document.querySelectorAll('.condemned').forEach(e => e.classList.remove('condemned'));

    if (state.voteTarget !== null) {
        state.deadIds.add(state.voteTarget);
        const condemned = state.gators.find(p => p.id === state.voteTarget);
        if (condemned) {
            condemned.deathOrder = state.deadIds.size;
            condemned.deathDay = state.dayNumber;
            condemned.deathType = 'executed';

            // Record execution in everyone's history
            for (const p of living()) {
                p.history.push({ day: state.dayNumber, type: 'witnessed_execution', target: state.voteTarget, detail: `${condemned.name} was executed by vote` });
                // If they voted for someone else, lose trust in the majority
                const myVote = state.voteHistory.find(v => v.voterId === p.id);
                if (myVote && myVote.targetId !== state.voteTarget) {
                    p.history.push({ day: state.dayNumber, type: 'disagreed_vote', detail: `Disagrees with the vote outcome—wanted someone else` });
                }
            }
            const marker = document.createElement('div');
            marker.className = 'dead-marker';
            marker.id = `dead-${condemned.id}`;
            marker.innerHTML = `<span class="dead-icon">\u26B0\uFE0F</span><span class="dead-name">${condemned.name}</span>`;
            marker.style.left = `${condemned.x - 8}px`;
            marker.style.top  = `${condemned.y + 4}px`;
            document.getElementById('world').appendChild(marker);
            const el = document.getElementById(`gator-${condemned.id}`);
            if (el) el.classList.add('dead');
        }
    }

    state.condemnedId = null;

    const murdererDead = state.deadIds.has(state.murdererId);
    const aliveCount   = living().length;
    if (murdererDead) {
        triggerGameOver(true);
        return;
    }
    // Murderer wins if they are one of the last 2 (or fewer) alive
    if (aliveCount <= 2) {
        triggerGameOver(false);
        return;
    }
    // Start new day
    state.gamePhase  = PHASE.DAY;
    state.isNight    = false;
    state.cycleTimer = DAY_TICKS;
    for (const p of living()) {
        p.activity  = 'moving';
        p.indoors   = false;
        p.message   = null;
        p.ticksLeft = 2 + rnd(4);
        for (const q of living()) {
            if (q.id !== p.id && p.suspicion[q.id] !== undefined) {
                p.suspicion[q.id] = Math.max(0, p.suspicion[q.id] - 10);
            }
        }
        const h = state.houses[p.homeIndex];
        p.x = h.doorX + rndF(20) - 10;
        p.y = h.doorY + rndF(20) - 10;
        p.targetX = h.doorX + rndF(80) - 40;
        p.targetY = h.doorY + rndF(80) - 40;
        p.thought = null;
    }
    renderAllGators();
    updateHouseGuests();
    updateStats();
    updatePhaseLabel();
}

// ── Game Summary PDF ────────────────────────────────────────────

/**
 * Builds a comprehensive print-ready HTML document covering the entire game,
 * opens it in a new tab, and triggers window.print() so the user can save as PDF.
 *
 * Sections:
 *   1. Cover — outcome, killer identity
 *   2. By Day — for each day: night victim, debate transcript, vote tally, execution
 *   3. By Alligator — for each gator: role, personality, relationships, full history
 */
export function generateGameSummaryPDF() {
    const killer     = state.gators.find(p => p.id === state.murdererId);
    const townWins   = state.deadIds.has(state.murdererId);
    const maxDay     = state.dayNumber;

    // ── helpers ──────────────────────────────────────────────────
    function esc(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function gatorName(id) {
        return esc(state.gators.find(p => p.id === id)?.name ?? `#${id}`);
    }

    // ── BY-DAY section ────────────────────────────────────────────
    let byDayHtml = '';
    for (let day = 1; day <= maxDay; day++) {
        byDayHtml += `<div class="section"><h2>Day ${day}</h2>`;

        // Night victim (victim's deathDay is day+1 because dawn increments dayNumber)
        const nightVictim = state.gators.find(p => p.deathType === 'murdered' && p.deathDay === day + 1);
        if (nightVictim) {
            byDayHtml += `<p class="event murder">🔪 <strong>${esc(nightVictim.name)}</strong> was murdered during Night ${day}.</p>`;
        }

        // Debate transcript for this day
        const dayDebate = state.debateHistory.filter(e => e.day === day);
        if (dayDebate.length > 0) {
            byDayHtml += `<h3>Debate</h3><table><tr><th>Speaker</th><th>Type</th><th>About</th><th>Quote</th></tr>`;
            for (const e of dayDebate) {
                byDayHtml += `<tr>
                    <td>${esc(e.accuserName)}</td>
                    <td>${e.type === 'accused' ? '⚔️ Accused' : '🛡 Defended'}</td>
                    <td>${e.targetName ? esc(e.targetName) : '—'}</td>
                    <td class="quote">"${esc(e.quote)}"</td>
                </tr>`;
            }
            byDayHtml += `</table>`;
        }

        // Votes cast on this day — collect from each gator's history
        const dayVoteEntries = [];
        for (const g of state.gators) {
            const voteEntry = g.history.find(h => h.type === 'voted' && h.day === day);
            if (voteEntry) dayVoteEntries.push({ voterId: g.id, targetId: voteEntry.target });
        }
        if (dayVoteEntries.length > 0) {
            const tally = {};
            for (const v of dayVoteEntries) tally[v.targetId] = (tally[v.targetId] || 0) + 1;
            byDayHtml += `<h3>Vote</h3><table><tr><th>Voter</th><th>Voted For</th></tr>`;
            for (const v of dayVoteEntries) {
                byDayHtml += `<tr><td>${gatorName(v.voterId)}</td><td>${gatorName(v.targetId)}</td></tr>`;
            }
            byDayHtml += `</table><p class="tally">Tally: ${Object.entries(tally).map(([id,c]) => `${gatorName(parseInt(id))} — ${c}`).join(', ')}</p>`;
        }

        // Execution on this day
        const executed = state.gators.find(p => p.deathType === 'executed' && p.deathDay === day);
        if (executed) {
            const wasKiller = executed.id === state.murdererId;
            byDayHtml += `<p class="event execute">⚔️ <strong>${esc(executed.name)}</strong> was executed${wasKiller ? ' — <em>The Killer!</em>' : ''}.</p>`;
        }

        byDayHtml += `</div>`;
    }

    // ── BY-ALLIGATOR section ──────────────────────────────────────
    let byGatorHtml = '';
    const sorted = [...state.gators].sort((a, b) => {
        const ad = state.deadIds.has(a.id), bd = state.deadIds.has(b.id);
        if (ad !== bd) return ad ? 1 : -1;
        return (a.deathOrder || 0) - (b.deathOrder || 0);
    });

    for (const p of sorted) {
        const isKiller    = p.id === state.murdererId;
        const isDead      = state.deadIds.has(p.id);
        const personality = p.personality.charAt(0).toUpperCase() + p.personality.slice(1);
        const deathInfo   = isDead
            ? ` — ${p.deathType === 'murdered' ? '🔪 Murdered' : '⚔️ Executed'} on Day ${p.deathDay ?? '?'}`
            : ' — Survived';

        byGatorHtml += `<div class="section gator-section">
            <h2>${esc(p.name)} <span class="role-badge ${isKiller ? 'killer' : 'town'}">${isKiller ? '🔪 KILLER' : '🐊 Town'}${p.liar ? ' · Liar' : ''}</span></h2>
            <p><strong>Personality:</strong> ${personality}${deathInfo}</p>`;

        // Relationships
        const rels = Object.entries(p.relations ?? {});
        if (rels.length > 0) {
            byGatorHtml += `<h3>Relationships at Game End</h3><table><tr><th>Gator</th><th>Feeling</th></tr>`;
            for (const [otherId, val] of rels.sort((a,b) => b[1]-a[1])) {
                const feel = val > 30 ? 'Friendly' : val < -30 ? 'Hostile' : 'Neutral';
                byGatorHtml += `<tr><td>${gatorName(parseInt(otherId))}</td><td>${feel} (${val > 0 ? '+' : ''}${Math.round(val)})</td></tr>`;
            }
            byGatorHtml += `</table>`;
        }

        // Suspicion scores
        const susps = Object.entries(p.suspicion ?? {}).filter(([,v]) => v > 0);
        if (susps.length > 0) {
            byGatorHtml += `<h3>Suspicion Scores</h3><table><tr><th>Suspect</th><th>Score</th></tr>`;
            for (const [sid, sv] of susps.sort((a,b) => b[1]-a[1])) {
                byGatorHtml += `<tr><td>${gatorName(parseInt(sid))}</td><td>${Math.round(sv)}</td></tr>`;
            }
            byGatorHtml += `</table>`;
        }

        // History events
        if (p.history && p.history.length > 0) {
            byGatorHtml += `<h3>Event History</h3><ul>`;
            for (const h of p.history) {
                byGatorHtml += `<li>[Day ${h.day}] ${esc(h.detail ?? h.type)}</li>`;
            }
            byGatorHtml += `</ul>`;
        }

        // Conversations (chatLog)
        if (p.chatLog && p.chatLog.length > 0) {
            byGatorHtml += `<h3>Conversations (${p.chatLog.length} messages)</h3>
            <table><tr><th>Day</th><th>From</th><th>To</th><th>Message</th></tr>`;
            for (const c of p.chatLog) {
                if (!c.message) continue;
                byGatorHtml += `<tr>
                    <td>${c.day ?? '?'}</td>
                    <td>${esc(c.from ?? p.name)}</td>
                    <td>${esc(c.to ?? '')}</td>
                    <td>${esc(c.message)}</td>
                </tr>`;
            }
            byGatorHtml += `</table>`;
        }

        byGatorHtml += `</div>`;
    }

    // ── Full HTML document ────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Swamp of Salem — Game Summary</title>
<style>
  body { font-family: Georgia, serif; font-size: 13px; color: #111; margin: 2cm; }
  h1   { font-size: 2em; margin-bottom: .2em; }
  h2   { font-size: 1.4em; border-bottom: 2px solid #333; margin-top: 1.4em; page-break-after: avoid; }
  h3   { font-size: 1.1em; margin-top: 1em; margin-bottom: .3em; color: #444; }
  .section { page-break-inside: avoid; margin-bottom: 2em; }
  .gator-section { page-break-before: auto; }
  table { border-collapse: collapse; width: 100%; margin-bottom: .8em; font-size: .9em; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
  th { background: #eee; font-weight: bold; }
  tr:nth-child(even) { background: #f9f9f9; }
  .quote { font-style: italic; }
  .event { margin: .5em 0; padding: .4em .7em; border-radius: 4px; }
  .murder  { background: #fff0f0; border-left: 4px solid #c00; }
  .execute { background: #fff8e0; border-left: 4px solid #a80; }
  .tally   { font-weight: bold; margin: .3em 0; }
  .role-badge { font-size: .75em; padding: 2px 7px; border-radius: 10px; vertical-align: middle; }
  .killer { background: #ffdddd; color: #900; }
  .town   { background: #ddf0dd; color: #060; }
  .cover  { text-align: center; margin-bottom: 3em; padding: 2em; border: 2px solid #555; border-radius: 8px; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
<div class="cover">
  <h1>🐊 Swamp of Salem</h1>
  <h2 style="border:none;">${townWins ? '🌿 The Swamp Won!' : '🔪 The Killer Won!'}</h2>
  <p>The killer was <strong>${esc(killer?.name ?? 'Unknown')}</strong> (${esc(killer?.personality ?? '')}).</p>
  <p>Game lasted <strong>${maxDay} day${maxDay !== 1 ? 's' : ''}</strong> with <strong>${state.gators.length} alligators</strong>.</p>
  <p style="font-size:.85em;color:#555;">Generated ${new Date().toLocaleString()}</p>
</div>

<h1>📅 Game by Day</h1>
${byDayHtml}

<h1>🐊 Game by Alligator</h1>
${byGatorHtml}
</body>
</html>`;

    const win = window.open('', '_blank');
    if (win) {
        win.document.write(html);
        win.document.close();
        win.focus();
        setTimeout(() => win.print(), 800);
    }
}

/**
 * Ends the game and displays the game-over overlay.
 *
 * @param {boolean} townWins - true = murderer executed (town wins); false = murderer survived.
 *
 * SEQUENCE:
 *   1. Set gamePhase = OVER.
 *   2. Clear setInterval (tick loop) and cancelAnimationFrame (rAF loop).
 *   3. Look up the killer's Person object for the reveal text.
 *   4. Populate #game-over-overlay with:
 *      - Result title: "🐊 Swamp Wins!" or "🔪 Killer Wins!"
 *      - Body text explaining the outcome.
 *      - Character roster: ALL gators sorted by survival order, showing:
 *        personality emoji, name, role badges (Killer / Liar), conversation count,
 *        death info (Murdered / Executed, Day N).
 *   5. Show the overlay (display=flex).
 *
 * CHARACTER SORT ORDER:
 *   1. Living gators first
 *   2. Dead gators in death order (first to die last in list)
 *   Within dead: sorted by deathOrder ascending.
 */
export function triggerGameOver(townWins) {
    state.gamePhase = PHASE.OVER;
    // stopAll will be called by simulation.js via the import
    if (state.tickInterval) { clearInterval(state.tickInterval); state.tickInterval = null; }
    if (state.rafId !== null) { cancelAnimationFrame(state.rafId); state.rafId = null; }

    const killer  = state.gators.find(p => p.id === state.murdererId);
    const overlay = document.getElementById('game-over-overlay');
    if (overlay) {
        overlay.querySelector('.go-title').textContent = townWins
            ? '\u{1F40A} Swamp Wins!'
            : '\uD83D\uDD2A Killer Wins!';
        overlay.querySelector('.go-body').innerHTML = townWins
            ? `The swamp correctly identified <strong>${killer ? killer.name : 'the killer'}</strong> as the murderer!<br>Justice has been served.`
            : (() => {
                // Find the last victim to determine how the killer won
                const lastVictim = [...state.deadIds].map(id => state.gators.find(p => p.id === id))
                    .filter(p => p && p.id !== state.murdererId)
                    .sort((a, b) => (b.deathOrder || 0) - (a.deathOrder || 0))[0];
                const killerName = killer ? killer.name : 'The killer';
                if (lastVictim && lastVictim.deathType === 'murdered' && living().length <= 1) {
                    return `<strong>${killerName}</strong> was left alone with <strong>${lastVictim.name}</strong> and struck them down in the night. The swamp falls silent.`;
                }
                return `<strong>${killerName}</strong> outlasted every gator and got away with it.`;
            })();

        // Build character list
        const charactersEl = document.getElementById('go-characters');
        if (charactersEl) {
            // Sort: living first, then by death order
            const sortedGators = [...state.gators].sort((a, b) => {
                const aDead = state.deadIds.has(a.id);
                const bDead = state.deadIds.has(b.id);
                if (aDead !== bDead) return aDead ? 1 : -1; // living first
                if (aDead && bDead) return (a.deathOrder || 0) - (b.deathOrder || 0); // death order
                return a.id - b.id; // original order for living
            });

            charactersEl.innerHTML = sortedGators.map(p => {
                const isDead = state.deadIds.has(p.id);
                const isKiller = p.id === state.murdererId;
                const personality = PERSONALITY_EMOJI[p.personality] || '🐊';

                let badges = '';
                if (isKiller) badges += '<span class="go-char-badge go-char-badge-killer">Killer</span>';
                if (p.liar && !isKiller) badges += '<span class="go-char-badge go-char-badge-liar">Liar</span>';

                let deathInfo = '';
                if (isDead) {
                    const deathType = p.deathType === 'murdered' ? '☠️ Murdered' : '⚔️ Executed';
                    deathInfo = `<div class="go-char-death">${deathType} on Day ${p.deathDay || '?'}</div>`;
                }

                return `
                    <div class="go-char ${isDead ? 'go-char-dead' : 'go-char-alive'}">
                        <div class="go-char-icon">${personality}</div>
                        <div class="go-char-info">
                            <div class="go-char-name">
                                ${p.name}
                                ${badges}
                                ${isDead ? '💀' : '✓'}
                            </div>
                            <div class="go-char-details">
                                ${p.personality.charAt(0).toUpperCase() + p.personality.slice(1)} · 
                                ${p.chatLog.length} conversations · 
                                ${Object.keys(p.relations).length} relationships
                            </div>
                            ${deathInfo}
                        </div>
                    </div>
                `;
            }).join('');
        }

        overlay.style.display = 'flex';

        // Wire the PDF summary button
        const pdfBtn = document.getElementById('goSummaryBtn');
        if (pdfBtn) {
            pdfBtn.onclick = () => generateGameSummaryPDF();
        }
    }
    updatePhaseLabel();
    updateStats();
}

