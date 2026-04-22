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
import { requestDialog, recordMemory, requestNightReport } from './agentQueue.js';

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
 *   3. Stagger first speech:
 *      - First MAX_DEBATE_SPEAKERS gators from a shuffled order get an
 *        immediate accusation message.
 *      - Rest get a delayed nextSpeakAt (2s + (index × 1.5s) + random noise).
 *        This staggers the chorus so messages don't all appear simultaneously.
 *
 * PERSUASION (runs on subsequent ticks in simulation.js):
 *   When a gator speaks with conviction > CONVICTION_THRESHOLD, they can
 *   nudge the suspicion scores of trusted nearby gators toward their target.
 *   This allows charismatic / convinced gators to sway the vote.
 *
 * NOTE: This is the only phase where gators speak continuously without AI.
 *   Debate lines are scripted templates ("I suspect {name}!") rather than
 *   LLM-generated, because the AI is too slow for rapid-fire accusation exchange.
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
        p.nextSpeakAt = Date.now() + Math.round(Math.random() * 1500); // tiny random offset before stagger loop overwrites
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

    const shuffled = alive.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < shuffled.length; i++) {
        const p = shuffled[i];
        if (i < MAX_DEBATE_SPEAKERS) {
            const suspect = pickDebateSuspect(p);
            if (suspect) {
                p.message = `I suspect ${suspect.name}!`;
                p.history.push({ day: state.dayNumber, type: 'debate_accused', target: suspect.id, detail: `Accused ${suspect.name} during debate` });
            } else {
                p.message = `I didn't do it!`;
                p.history.push({ day: state.dayNumber, type: 'debate_defended', detail: `Defended self during debate` });
            }
            p.thought = null;
            p.nextSpeakAt = Date.now() + 3000 + Math.random() * 5000;
        } else {
            p.nextSpeakAt = Date.now() + 2000 + i * 1500 + Math.round(Math.random() * 2000);
        }
    }

    renderAllGators();
    updateStats();
    updatePhaseLabel();
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
    const alive = living().filter(q => q.id !== voter.id);
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
export function triggerVote() {
    state.gamePhase        = PHASE.VOTE;
    state.voteOrder        = living().slice().sort(() => Math.random() - 0.5);
    state.voteIndex        = 0;
    state.voteResults      = {};
    state.voteDisplayTimer = VOTE_DISPLAY_TICKS;
    state.cycleTimer       = state.voteOrder.length * (VOTE_DISPLAY_TICKS + 1) + 2;
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
    let topId = null, topCount = 0;
    for (const [id, cnt] of Object.entries(state.voteResults)) {
        if (cnt > topCount) { topCount = cnt; topId = parseInt(id); }
    }
    state.voteTarget = topId;

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
    if (murdererDead || aliveCount <= 1) {
        triggerGameOver(murdererDead);
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
            : `<strong>${killer ? killer.name : 'The killer'}</strong> outlasted every gator and got away with it.`;

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
    }
    updatePhaseLabel();
    updateStats();
}

