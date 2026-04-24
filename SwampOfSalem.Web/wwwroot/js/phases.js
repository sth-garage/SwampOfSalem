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
import { requestDialog, recordMemory, requestNightReport, requestFullConversation, requestDebateSpeech, buildDebateLine as _buildDebateLine } from './agentQueue.js';

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
    const victim = candidates.reduce((best, c) => {
        // Prioritise killing those who most suspect the murderer, then those the killer dislikes
        const cSuspects = c.suspicion[state.murdererId] ?? 0;
        const bSuspects = best.suspicion[state.murdererId] ?? 0;
        const cs = cSuspects * 0.6 - (killer.relations[c.id]    ?? 0) * 0.3 + rnd(20);
        const bs = bSuspects * 0.6 - (killer.relations[best.id] ?? 0) * 0.3 + rnd(20);
        return cs > bs ? c : best;
    });
    // Annotate the killer so the info panel can show their intent
    const suspicion = victim.suspicion[killer.id] ?? 0;
    const dislike   = -(killer.relations[victim.id] ?? 0);
    let killReason;
    if (suspicion > 40)       killReason = `${victim.name} suspects me — they're too dangerous to leave alive.`;
    else if (dislike > 30)    killReason = `I've never liked ${victim.name}. Tonight that changes.`;
    else                      killReason = `${victim.name} is the weakest link. They go tonight.`;
    killer.plannedKillTarget = victim;
    killer.plannedKillReason = killReason;
    return victim;
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
        const _mKiller = state.gators.find(p => p.id === state.murdererId);
        const _mVictim = state.gators.find(p => p.id === state.nightVictimId);
        const _mReason = (_mKiller && _mKiller.plannedKillReason) || `Eliminated ${_mVictim?.name || 'someone'}.`;
        if (_mKiller) {
            _mKiller.history.push({ day: state.dayNumber, type: 'murder', with: state.nightVictimId, detail: _mReason, reason: _mReason });
            // Persist the kill decision as a private thought so the summary chronicle can surface it
            _mKiller.chatLog.push({ day: state.dayNumber, from: _mKiller.id, to: null, message: null, thought: _mReason, ts: Date.now(), type: 'thought' });
        }
        recordMemory(state.murdererId, state.dayNumber, 'murder', _mReason, state.nightVictimId);
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
            recordMemory(speaker.id, state.dayNumber, 'past_debate_accuse',
                `In the Day ${state.dayNumber} debate I accused ${suspect.name}: "${spoken}"`, suspect.id);
            recordMemory(suspect.id, state.dayNumber, 'past_debate_accused_me',
                `${speaker.name} accused me during the Day ${state.dayNumber} debate: "${spoken}"`, speaker.id);
            for (const g of living()) {
                if (g.id === speaker.id || g.id === suspect.id) continue;
                recordMemory(g.id, state.dayNumber, 'past_debate_overheard',
                    `${speaker.name} accused ${suspect.name} in the Day ${state.dayNumber} debate: "${spoken}"`, speaker.id);
            }
            speaker.history.push({ day: state.dayNumber, type: 'debate_accused', target: suspect.id, detail: `Accused ${suspect.name}: "${spoken}"` });
            state.debateHistory.push({ day: state.dayNumber, accuserId: speaker.id, accuserName: speaker.name, targetId: suspect.id, targetName: suspect.name, type: 'accused', quote: spoken });

            // ── Immediate defense turn ─────────────────────────────────────
            // The accused gator responds right away before the floor timer releases.
            // Schedule the defense after a short human-feeling pause (1.5–2.5 s).
            const DEFENSE_DELAY = 1500 + rnd(1000);
            setTimeout(() => {
                if (state.gamePhase !== PHASE.DEBATE) return;
                if (state.deadIds.has(suspect.id)) return;

                const defenseSpoken = _buildDebateLine(suspect, null, victim, true, speaker);
                suspect.message = defenseSpoken;

                state.debateTranscript.push({
                    speakerId:   suspect.id,
                    speakerName: suspect.name,
                    message:     defenseSpoken,
                    isDefense:   true,
                });
                suspect.history.push({ day: state.dayNumber, type: 'debate_defended', detail: `Defended self against ${speaker.name}: "${defenseSpoken}"` });
                state.debateHistory.push({ day: state.dayNumber, accuserId: suspect.id, accuserName: suspect.name, targetId: speaker.id, targetName: speaker.name, type: 'defended', quote: defenseSpoken });
                recordMemory(suspect.id, state.dayNumber, 'past_debate_defend',
                    `I defended myself against ${speaker.name}'s accusation: "${defenseSpoken}"`, speaker.id);
                for (const g of living()) {
                    if (g.id === suspect.id) continue;
                    recordMemory(g.id, state.dayNumber, 'past_debate_overheard',
                        `${suspect.name} defended themselves: "${defenseSpoken}"`, suspect.id);
                }
                renderAllGators();
            }, DEFENSE_DELAY);
        } else {
            recordMemory(speaker.id, state.dayNumber, 'past_debate_defend',
                `In the Day ${state.dayNumber} debate I defended myself: "${spoken}"`, null);
            for (const g of living()) {
                if (g.id === speaker.id) continue;
                recordMemory(g.id, state.dayNumber, 'past_debate_overheard',
                    `${speaker.name} defended themselves in the Day ${state.dayNumber} debate: "${spoken}"`, speaker.id);
            }
            speaker.history.push({ day: state.dayNumber, type: 'debate_defended', detail: `Defended self: "${spoken}"` });
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

    let target = null;
    let voteReason = null;

    if (voter.id === state.murdererId) {
        const topEntry = Object.entries(state.voteResults).sort((a,b) => b[1]-a[1])[0];
        if (topEntry && parseInt(topEntry[0]) !== state.murdererId) {
            const t = state.gators.find(q => q.id === parseInt(topEntry[0]));
            if (t && !state.deadIds.has(t.id)) {
                target = t;
                voteReason = `${t.name} is already under suspicion. Easier to let the crowd finish what I started.`;
            }
        }
        if (!target) {
            const innocents = alive.filter(q => q.id !== state.murdererId);
            if (innocents.length > 0) {
                target = innocents.reduce((best, c) =>
                    (voter.relations[c.id] ?? 0) < (voter.relations[best.id] ?? 0) ? c : best
                , innocents[0]);
                voteReason = `${target.name} has always rubbed me wrong. Time to get rid of them.`;
            }
        }
    } else {
        target = alive.reduce((best, c) => {
            const bScore = (voter.suspicion[best.id] ?? 0) - (voter.relations[best.id] ?? 0) * 0.3 + rnd(25);
            const cScore = (voter.suspicion[c.id]    ?? 0) - (voter.relations[c.id]    ?? 0) * 0.3 + rnd(25);
            return cScore > bScore ? c : best;
        });
        if (target) {
            const susp = Math.round(voter.suspicion[target.id] ?? 0);
            const rel  = Math.round(voter.relations[target.id] ?? 0);
            if (susp > 55)          voteReason = `I'm convinced it's ${target.name}. The evidence is right there.`;
            else if (susp > 30)     voteReason = `Something about ${target.name} doesn't add up. I'm voting them out.`;
            else if (rel < -30)     voteReason = `I don't trust ${target.name}. Never have.`;
            else                    voteReason = `No one stands out clearly, but ${target.name} seems the most likely.`;
        }
    }

    // Stamp intent onto the voter so the info panel can display it
    voter.plannedVoteTarget = target || null;
    voter.plannedVoteReason = voteReason || null;

    return target;
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
    // Pre-compute each gator's vote intent so the info panel can show it immediately
    for (const p of living()) decideVote(p);
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
        voter.history.push({ day: state.dayNumber, type: 'voted', target: target.id, detail: `Voted for ${target.name}`, reason: voter.plannedVoteReason || '' });
        // Record vote reasoning as an inner thought so the summary can surface it
        if (voter.plannedVoteReason) {
            voter.chatLog.push({ day: state.dayNumber, from: voter.id, to: null, message: null, thought: voter.plannedVoteReason, ts: Date.now(), type: 'thought' });
        }
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
 * Builds a comprehensive cradle-to-grave print-ready HTML document for the game.
 *
 * Sections:
 *   1. Cover — outcome, killer identity, stats
 *   2. Killer's Chronicle — each kill with reasoning, pre-kill conversations (spoken + inner thoughts)
 *   3. By Day — night victim, debate transcript, vote tally, execution
 *   4. By Alligator — deep per-gator profiles with a subsection for every other gator:
 *        interactions, inner thoughts, relation drift explanations, voting record
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

    // Returns all chatLog entries shared between two gators (messages + thoughts)
    function sharedLog(a, b) {
        return (a.chatLog || []).filter(e =>
            (e.from === a.id && e.to === b.id) ||
            (e.from === b.id && e.to === a.id) ||
            (e.type === 'overheard' && (e.from === b.id || e.from === a.id))
        );
    }

    function relLabel(v) {
        if (v >=  60) return 'deeply bonded';
        if (v >=  30) return 'friendly';
        if (v >=  10) return 'warm';
        if (v >  -10) return 'neutral';
        if (v >  -30) return 'cool';
        if (v >  -60) return 'hostile';
        return 'deeply hateful';
    }

    function explainDelta(owner, other, delta, history) {
        const reasons = [];
        let totalDrift = 0;
        for (const h of history) {
            if (h.type === 'relation_drift' && h.with === other.id) {
                totalDrift += h.delta || 0;
            }
            if (h.type === 'opinion_changed' && h.about === other.id)
                reasons.push(`heard gossip about ${gatorName(other.id)} (${h.delta > 0 ? '+' : ''}${h.delta})`);
            if (h.type === 'talked' && h.with === other.id) {
                const s = h.sentiment === 'positive' ? 'a warm chat' : h.sentiment === 'negative' ? 'a tense conversation' : 'a neutral exchange';
                reasons.push(s);
            }
            if (h.type === 'voted' && h.target === other.id)
                reasons.push(`voted against ${gatorName(other.id)}`);
        }
        if (totalDrift !== 0)
            reasons.push(`${Math.abs(totalDrift)} points of ${totalDrift > 0 ? 'positive' : 'negative'} drift from shared time together`);
        if (reasons.length === 0) return delta !== 0 ? `Shifted by ${delta > 0 ? '+' : ''}${Math.round(delta)} through shared time.` : 'No notable changes.';
        return `Relationship moved by ${delta > 0 ? '+' : ''}${Math.round(delta)} through: ${reasons.join('; ')}.`;
    }

    // ── KILLER'S CHRONICLE ────────────────────────────────────────
    let killerHtml = '';
    if (killer) {
        killerHtml += `<div class="section killer-chronicle">`;
        killerHtml += `<h2>The Killer's Chronicle — ${esc(killer.name)}</h2>`;
        killerHtml += `<p>${esc(killer.name)} is a <strong>${esc(killer.personality)}</strong> alligator${killer.liar ? ' and a natural liar' : ''}. `;
        killerHtml += `They ${townWins ? 'were eventually caught and executed' : 'evaded justice and claimed the swamp'} after ${maxDay} day${maxDay !== 1 ? 's' : ''}.</p>`;

        const murders = state.gators.filter(p => p.deathType === 'murdered').sort((a,b) => (a.deathDay||0)-(b.deathDay||0));
        for (const victim of murders) {
            const killDay = (victim.deathDay || 1) - 1;
            killerHtml += `<div class="kill-entry">`;
            killerHtml += `<h3>Night ${killDay}: ${esc(victim.name)}</h3>`;
            const killMem = (killer.history || []).find(h => h.type === 'murder' && h.with === victim.id);
            const killReason = killMem ? killMem.detail : (killer.plannedKillReason || '');
            if (killReason) killerHtml += `<p class="kill-reason"><strong>Why:</strong> ${esc(killReason)}</p>`;
            const killerThoughts = (killer.chatLog || []).filter(e => (e.type === 'thought' || e.thought) && e.from === killer.id && e.day === killDay);
            if (killerThoughts.length > 0) {
                killerHtml += `<h4>Killer inner thoughts on Day ${killDay}</h4><ul>`;
                for (const t of killerThoughts) killerHtml += `<li class="thought-entry">${esc(t.thought || t.message)}</li>`;
                killerHtml += `</ul>`;
            }
            const conv = sharedLog(killer, victim);
            if (conv.length > 0) {
                killerHtml += `<h4>Conversations: ${esc(killer.name)} and ${esc(victim.name)}</h4>`;
                killerHtml += `<table><tr><th>Day</th><th>Speaker</th><th>Said</th><th>Was thinking</th></tr>`;
                for (const e of conv) {
                    if (!e.message && !e.thought) continue;
                    const speaker = state.gators.find(p => p.id === e.from);
                    killerHtml += `<tr><td>${e.day || '?'}</td><td>${esc(speaker ? speaker.name : '?')}</td><td>${esc(e.message || '')}</td><td class="thought-cell">${e.thought ? esc(e.thought) : ''}</td></tr>`;
                }
                killerHtml += `</table>`;
            }
            const victimRelevant = (victim.chatLog || []).filter(e => {
                const txt = ((e.type === 'thought' || e.thought) ? (e.thought || e.message || '') : '').toLowerCase();
                return txt && (txt.includes(killer.name.toLowerCase()) || txt.includes('killer') || txt.includes('murderer') || txt.includes('suspicious'));
            });
            if (victimRelevant.length > 0) {
                killerHtml += `<h4>${esc(victim.name)} thoughts about the killer</h4><ul>`;
                for (const t of victimRelevant.slice(0, 10))
                    killerHtml += `<li class="thought-entry">[Day ${t.day || '?'}] ${esc(t.thought || t.message)}</li>`;
                killerHtml += `</ul>`;
            }
            killerHtml += `</div>`;
        }
        killerHtml += `</div>`;
    }

    // ── BY-DAY section ────────────────────────────────────────────
    let byDayHtml = '';
    for (let day = 1; day <= maxDay; day++) {
        byDayHtml += `<div class="section"><h2>Day ${day}</h2>`;
        const nightVictim = state.gators.find(p => p.deathType === 'murdered' && p.deathDay === day + 1);
        if (nightVictim) byDayHtml += `<p class="event murder"><strong>${esc(nightVictim.name)}</strong> was murdered during Night ${day}.</p>`;
        const dayDebate = state.debateHistory.filter(e => e.day === day);
        if (dayDebate.length > 0) {
            byDayHtml += `<h3>Debate</h3><table><tr><th>Speaker</th><th>Type</th><th>About</th><th>Quote</th></tr>`;
            for (const e of dayDebate)
                byDayHtml += `<tr><td>${esc(e.accuserName)}</td><td>${e.type === 'accused' ? 'Accused' : 'Defended'}</td><td>${e.targetName ? esc(e.targetName) : ''}</td><td class="quote">"${esc(e.quote)}"</td></tr>`;
            byDayHtml += `</table>`;
        }
        const dayVoteEntries = [];
        for (const g of state.gators) {
            const voteEntry = g.history.find(h => h.type === 'voted' && h.day === day);
            if (voteEntry) dayVoteEntries.push({ voter: g, targetId: voteEntry.target, detail: voteEntry.detail || voteEntry.reason || '' });
        }
        if (dayVoteEntries.length > 0) {
            const tally = {};
            for (const v of dayVoteEntries) tally[v.targetId] = (tally[v.targetId] || 0) + 1;
            byDayHtml += `<h3>Vote</h3><table><tr><th>Voter</th><th>Voted For</th><th>Reason</th></tr>`;
            for (const v of dayVoteEntries)
                byDayHtml += `<tr><td>${gatorName(v.voter.id)}</td><td>${gatorName(v.targetId)}</td><td>${esc(v.detail)}</td></tr>`;
            byDayHtml += `</table><p class="tally">Tally: ${Object.entries(tally).map(([id,c]) => `${gatorName(parseInt(id))} - ${c}`).join(', ')}</p>`;
        }
        const executed = state.gators.find(p => p.deathType === 'executed' && p.deathDay === day);
        if (executed) {
            const wasKiller = executed.id === state.murdererId;
            byDayHtml += `<p class="event execute"><strong>${esc(executed.name)}</strong> was executed${wasKiller ? ' - The Killer!' : ''}.</p>`;
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
        const isKiller = p.id === state.murdererId;
        const isDead   = state.deadIds.has(p.id);
        const personality = p.personality.charAt(0).toUpperCase() + p.personality.slice(1);
        const deathInfo = isDead
            ? ` - ${p.deathType === 'murdered' ? 'Murdered' : 'Executed'} on Day ${p.deathDay || '?'}`
            : ' - Survived';

        byGatorHtml += `<div class="section gator-section">`;
        byGatorHtml += `<h2>${esc(p.name)} <span class="role-badge ${isKiller ? 'killer' : 'town'}">${isKiller ? 'KILLER' : 'Town'}${p.liar ? ' / Liar' : ''}</span></h2>`;
        byGatorHtml += `<p><strong>Personality:</strong> ${personality}${deathInfo}</p>`;

        byGatorHtml += `<h3>Relationships</h3>`;
        const others = state.gators.filter(q => q.id !== p.id);
        for (const other of others) {
            const finalRel  = Math.round(p.relations ? (p.relations[other.id] || 0) : 0);
            const finalSusp = Math.round(p.suspicion ? (p.suspicion[other.id] || 0) : 0);
            const isDead2   = state.deadIds.has(other.id);
            const otherFate = isDead2 ? (other.deathType === 'murdered' ? '[murdered]' : '[executed]') : '[alive]';

            byGatorHtml += `<div class="rel-subsection">`;
            byGatorHtml += `<h4>${esc(other.name)} ${otherFate} <span class="rel-score ${finalRel >= 30 ? 'rel-pos' : finalRel <= -30 ? 'rel-neg' : 'rel-neu'}">${finalRel >= 0 ? '+' : ''}${finalRel}</span></h4>`;
            byGatorHtml += `<p class="rel-summary"><em>${esc(p.name)} ended ${relLabel(finalRel)} toward ${esc(other.name)}.</em>`;
            if (finalSusp > 10) byGatorHtml += ` Suspicion: <strong>${finalSusp}%</strong>.`;
            byGatorHtml += `</p>`;

            const relHistory = (p.history || []).filter(h => h.with === other.id || h.about === other.id || h.to === other.id);
            byGatorHtml += `<p class="rel-explain">${explainDelta(p, other, finalRel, relHistory)}</p>`;

            const convLines = sharedLog(p, other);
            const pThoughts = (p.chatLog || []).filter(e =>
                (e.type === 'thought' || e.thought) && e.from === p.id &&
                (e.thought || e.message || '').toLowerCase().includes(other.name.toLowerCase())
            );
            const otherThoughts = (other.chatLog || []).filter(e =>
                (e.type === 'thought' || e.thought) && e.from === other.id &&
                (e.thought || e.message || '').toLowerCase().includes(p.name.toLowerCase())
            );

            const totalInteractions = convLines.length + pThoughts.length + otherThoughts.length;
            if (totalInteractions > 0) {
                byGatorHtml += `<details><summary>View all interactions (${totalInteractions})</summary>`;
                if (convLines.length > 0) {
                    byGatorHtml += `<table class="conv-table"><tr><th>Day</th><th>Speaker</th><th>Said</th><th>Was thinking</th></tr>`;
                    for (const e of convLines) {
                        if (!e.message && !e.thought) continue;
                        const speaker = state.gators.find(q => q.id === e.from);
                        byGatorHtml += `<tr><td>${e.day || '?'}</td><td>${esc(speaker ? speaker.name : '?')}</td><td>${esc(e.message || '')}</td><td class="thought-cell">${e.thought ? esc(e.thought) : ''}</td></tr>`;
                    }
                    byGatorHtml += `</table>`;
                }
                if (pThoughts.length > 0) {
                    byGatorHtml += `<p class="thought-heading">${esc(p.name)} private thoughts about ${esc(other.name)}:</p><ul>`;
                    for (const t of pThoughts.slice(0, 8))
                        byGatorHtml += `<li class="thought-entry">[Day ${t.day || '?'}] ${esc(t.thought || t.message)}</li>`;
                    byGatorHtml += `</ul>`;
                }
                if (otherThoughts.length > 0) {
                    byGatorHtml += `<p class="thought-heading">${esc(other.name)} private thoughts about ${esc(p.name)}:</p><ul>`;
                    for (const t of otherThoughts.slice(0, 8))
                        byGatorHtml += `<li class="thought-entry">[Day ${t.day || '?'}] ${esc(t.thought || t.message)}</li>`;
                    byGatorHtml += `</ul>`;
                }
                byGatorHtml += `</details>`;
            }
            byGatorHtml += `</div>`;
        }

        const votesMade = (p.history || []).filter(h => h.type === 'voted');
        if (votesMade.length > 0) {
            byGatorHtml += `<h3>Voting Record</h3><table><tr><th>Day</th><th>Voted For</th><th>Reason</th></tr>`;
            for (const v of votesMade)
                byGatorHtml += `<tr><td>${v.day}</td><td>${gatorName(v.target)}</td><td>${esc(v.reason || v.detail || '')}</td></tr>`;
            byGatorHtml += `</table>`;
        }

        if (p.history && p.history.length > 0) {
            byGatorHtml += `<details><summary>Full event log (${p.history.length} events)</summary><ul>`;
            for (const h of p.history)
                byGatorHtml += `<li>[Day ${h.day}] ${esc(h.detail || h.type)}</li>`;
            byGatorHtml += `</ul></details>`;
        }

        byGatorHtml += `</div>`;
    }

    // ── Full HTML document ────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Swamp of Salem - Game Summary</title>
<style>
  body { font-family: Georgia, serif; font-size: 13px; color: #111; margin: 2cm; }
  h1 { font-size: 2em; margin-bottom: .2em; }
  h2 { font-size: 1.4em; border-bottom: 2px solid #333; margin-top: 1.4em; page-break-after: avoid; }
  h3 { font-size: 1.1em; margin-top: 1em; margin-bottom: .3em; color: #444; }
  h4 { font-size: 1em; margin: .8em 0 .2em; color: #555; }
  .section { page-break-inside: avoid; margin-bottom: 2em; }
  .gator-section { page-break-before: auto; }
  table { border-collapse: collapse; width: 100%; margin-bottom: .8em; font-size: .9em; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; vertical-align: top; }
  th { background: #eee; font-weight: bold; }
  tr:nth-child(even) { background: #f9f9f9; }
  .quote { font-style: italic; }
  .event { margin: .5em 0; padding: .4em .7em; border-radius: 4px; }
  .murder { background: #fff0f0; border-left: 4px solid #c00; }
  .execute { background: #fff8e0; border-left: 4px solid #a80; }
  .tally { font-weight: bold; margin: .3em 0; }
  .role-badge { font-size: .75em; padding: 2px 7px; border-radius: 10px; vertical-align: middle; }
  .killer { background: #ffdddd; color: #900; }
  .town { background: #ddf0dd; color: #060; }
  .cover { text-align: center; margin-bottom: 3em; padding: 2em; border: 2px solid #555; border-radius: 8px; }
  .killer-chronicle { background: #fff8f8; border: 1px solid #dbb; padding: 1em; border-radius: 6px; }
  .kill-entry { border-left: 3px solid #c33; padding-left: 1em; margin: 1em 0; }
  .kill-reason { background: #ffe8e8; padding: .3em .6em; border-radius: 4px; margin-bottom: .5em; }
  .rel-subsection { border: 1px solid #e0e0e0; border-radius: 4px; padding: .6em .8em; margin: .5em 0; background: #fafafa; }
  .rel-score { font-size: .85em; padding: 1px 6px; border-radius: 8px; font-weight: bold; }
  .rel-pos { background: #ddf0dd; color: #040; }
  .rel-neg { background: #ffecec; color: #800; }
  .rel-neu { background: #eee; color: #444; }
  .rel-summary { margin: .2em 0; }
  .rel-explain { font-style: italic; color: #555; font-size: .9em; margin: .2em 0 .4em; }
  .thought-cell { font-style: italic; color: #557; font-size: .88em; }
  .thought-entry { font-style: italic; color: #557; margin: .15em 0; }
  .thought-heading { font-weight: bold; margin: .5em 0 .2em; }
  .conv-table { font-size: .87em; }
  details { margin: .4em 0; }
  summary { cursor: pointer; color: #336; font-size: .9em; padding: .2em 0; }
  summary:hover { text-decoration: underline; }
  @media print {
    .no-print { display: none; }
    details { display: block; }
    details summary { display: none; }
  }
</style>
</head>
<body>
<div class="cover">
  <h1>Swamp of Salem</h1>
  <h2 style="border:none;">${townWins ? 'The Swamp Won!' : 'The Killer Won!'}</h2>
  <p>The killer was <strong>${esc(killer ? killer.name : 'Unknown')}</strong> (${esc(killer ? killer.personality : '')})${killer && killer.liar ? ', a natural liar' : ''}.</p>
  <p>Game lasted <strong>${maxDay} day${maxDay !== 1 ? 's' : ''}</strong> with <strong>${state.gators.length} alligators</strong>.</p>
  <p>${state.gators.filter(p => state.deadIds.has(p.id) && p.deathType === 'murdered').length} murdered &middot; ${state.gators.filter(p => state.deadIds.has(p.id) && p.deathType === 'executed').length} executed &middot; ${state.gators.filter(p => !state.deadIds.has(p.id)).length} survived</p>
  <p style="font-size:.85em;color:#555;">Generated ${new Date().toLocaleString()}</p>
</div>

<h1>The Killer's Chronicle</h1>
${killerHtml}

<h1>Game by Day</h1>
${byDayHtml}

<h1>Game by Alligator</h1>
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

