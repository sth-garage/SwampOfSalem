import {
    PERSON_SIZE, PHASE, DAY_TICKS, NIGHT_TICKS, DAWN_TICKS, DEBATE_TICKS,
    VOTE_DISPLAY_TICKS, MOURN_LINES, DAWN_THOUGHTS_INNOCENT,
    DAWN_THOUGHTS_MURDERER, ACCUSE_LINES, DEFEND_LINES,
    MURDERER_BLUFF, MEMORY_STRENGTH, MAX_DEBATE_SPEAKERS,
    DEBATE_SPEAK_COOLDOWN, VICTIM_REACT_LINES, THEFT_WITNESS_LINES,
    ORANGE_PRICE, DEBATE_ARGUMENT_LINES
} from './gameConfig.js';
import { rnd, rndF, pickThought, thoughtDelayMs, speakDelayMs, pickBucketed } from './helpers.js';
import { living } from './people.js';
import { state } from './state.js';
import { renderAllPeople, updateStats, updatePhaseLabel, updateHouseGuests, showDeadBody } from './rendering.js';
import { processNightThefts } from './store.js';
import { requestDialog, requestThought, requestVote, recordMemory } from './agentQueue.js';

// ── Helpers ───────────────────────────────────────────────────
function setNightOverlay(night) {
    const ov = document.getElementById('night-overlay');
    if (ov) ov.classList.toggle('active', night);
    document.getElementById('world').classList.toggle('night', night);
}

function murderVictim() {
    const killer = state.people.find(p => p.id === state.murdererId);
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

// ── Phase transitions ─────────────────────────────────────────
export function triggerNightfall() {
    state.gamePhase      = PHASE.NIGHT;
    state.isNight        = true;
    state.cycleTimer     = NIGHT_TICKS;
    state.nightVictimId  = (murderVictim() || {id: null}).id;
    if (state.nightVictimId !== null) {
        recordMemory(state.murdererId, state.dayNumber, 'murder', `Murdered ${state.people.find(p => p.id === state.nightVictimId)?.name || 'someone'}`, state.nightVictimId);
    }
    for (const p of living()) {
        if (p.talkingTo !== null) {
            const partner = state.people.find(q => q.id === p.talkingTo);
            if (partner) { partner.talkingTo = null; partner.message = null; }
            p.talkingTo = null; p.message = null;
        }
        p.guestOfIndex = null;
        p.indoors   = true;
        p.activity  = 'sleeping';
        p.ticksLeft = NIGHT_TICKS + 2;
        const h = state.houses[p.homeIndex];
        p.x = h.doorX - PERSON_SIZE / 2;
        p.y = h.doorY - PERSON_SIZE;
        const el = document.getElementById(`person-${p.id}`);
        if (el) { el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; }
    }
    state.talkLines.forEach(l => l.remove()); state.talkLines.clear();
    updateHouseGuests();
    setNightOverlay(true);
    updatePhaseLabel();
    renderAllPeople();
    updateStats();
}

export function triggerDawn() {
    state.gamePhase = PHASE.DAWN;
    state.isNight   = false;
    state.cycleTimer = DAWN_TICKS;
    setNightOverlay(false);
    state.dayNumber++;
    if (state.nightVictimId !== null) {
        state.deadIds.add(state.nightVictimId);
        showDeadBody(state.nightVictimId);
    }

    // Process what orange lovers got up to during the night
    processNightThefts();

    // Victim reactions: outrage + suspicion based on observed spending
    for (const victim of living().filter(p => p.stolenFrom)) {
        const victimCtx = `You discovered someone stole money from you during the night! You are outraged.`;
        requestDialog(victim, 'mourn', pickBucketed(VICTIM_REACT_LINES, victim.personality), null, victimCtx);
        victim.nextThoughtAt = Date.now() + 4000;
        // Suspect those seen buying many oranges, weighted by dislike
        for (const q of living()) {
            if (q.id === victim.id) continue;
            const observed = victim.spendingObserved[q.id] ?? 0;
            if (observed > 0) {
                const distrustBonus = Math.max(0, -(victim.relations[q.id] ?? 0)) * 0.3;
                const gained = Math.min(60, observed * 4 + distrustBonus + rnd(15));
                victim.suspicion[q.id] = Math.min(100, (victim.suspicion[q.id] ?? 0) + gained);
            }
        }
        victim.stolenFrom   = false;
        victim.stolenAmount = 0;
        victim.history.push({ day: state.dayNumber, type: 'robbed', detail: `Discovered someone stole money during the night!` });
    }

    // Witnesses react
    for (const witness of living().filter(p => p.witnessedThefts.length > 0 &&
            p.witnessedThefts.some(t => t.day === state.dayNumber))) {
        requestDialog(witness, 'mourn', pickBucketed(THEFT_WITNESS_LINES, witness.personality), null, 'You witnessed a theft during the night.');
    }

    for (const p of living()) {
        const h = state.houses[p.homeIndex];
        p.indoors   = false;
        p.activity  = 'moving';
        p.ticksLeft = 2 + rnd(3);
        p.x = h.doorX + rndF(16) - 8;
        p.y = h.doorY + rndF(16) - 8;
        const isMurderer = p.id === state.murdererId;
        const thoughtFallback = isMurderer
            ? pickBucketed(DAWN_THOUGHTS_MURDERER, p.personality)
            : pickBucketed(DAWN_THOUGHTS_INNOCENT, p.personality);
        const thoughtCtx = isMurderer
            ? 'It is dawn. Someone was murdered last night — by you. Think something secretly satisfied.'
            : 'It is dawn. Someone was murdered last night. Think about how you feel.';
        requestThought(p, thoughtFallback);
        p.nextThoughtAt = Date.now() + thoughtDelayMs(p.thoughtStat);
        const mournCtx = state.nightVictimId !== null
            ? `${state.people.find(q => q.id === state.nightVictimId)?.name || 'Someone'} was found dead this morning.`
            : 'Another night has passed in the swamp.';
        requestDialog(p, 'mourn', pickBucketed(MOURN_LINES, p.personality), null, mournCtx);
        recordMemory(p.id, state.dayNumber, 'dawn', mournCtx, state.nightVictimId);
    }
    updateHouseGuests();
    renderAllPeople();
    updateStats();
    updatePhaseLabel();
}

// ── Staggered debate ──────────────────────────────────────────
// Instead of everyone speaking at once, we seed suspicion for all up front
// but only give 1–2 people their first message. Others get a speakCooldown
// and will speak on subsequent ticks when their cooldown expires.
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
        p.targetX  = h.doorX + outX - PERSON_SIZE / 2;
        p.targetY  = h.doorY + outY - PERSON_SIZE / 2;
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

    // Stagger: give each person a random initial delay
    const shuffled = alive.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < shuffled.length; i++) {
        const p = shuffled[i];
        if (i < MAX_DEBATE_SPEAKERS) {
            // First speakers say something immediately
            const suspect = pickDebateSuspect(p);
            let fallback;
            if (suspect) {
                if (Math.random() < 0.5) {
                    fallback = pickBucketed(DEBATE_ARGUMENT_LINES, p.personality).replace('{name}', suspect.name);
                } else {
                    fallback = pickBucketed(ACCUSE_LINES, p.personality).replace('{name}', suspect.name);
                }
                const ctx = `Debate is starting. You suspect ${suspect.name}. Make your opening accusation.`;
                requestDialog(p, 'accusation', fallback, suspect.id, ctx);
                p.history.push({ day: state.dayNumber, type: 'debate_accused', target: suspect.id, detail: `Accused ${suspect.name} during debate` });
            } else {
                fallback = pickBucketed(DEFEND_LINES, p.personality);
                const ctx = 'Debate is starting. Others may suspect you. Defend yourself.';
                requestDialog(p, 'defense', fallback, null, ctx);
                p.history.push({ day: state.dayNumber, type: 'debate_defended', detail: `Defended self during debate` });
            }
            p.thought      = fallback;
            p.nextThoughtAt = Date.now() + thoughtDelayMs(p.thoughtStat);
            // Next debate utterance on their own independent schedule
            const debateMs = 3000 + Math.random() * 5000;
            p.nextSpeakAt = Date.now() + Math.round(debateMs / (p.socialStat * 0.12 + 0.88));
        } else {
            // Everyone else: staggered entry — later queue position = longer initial wait
            p.nextSpeakAt = Date.now() + 2000 + i * 1500 + Math.round(Math.random() * 2000);
        }
    }

    renderAllPeople();
    updateStats();
    updatePhaseLabel();
}

// ── Vote ──────────────────────────────────────────────────────
export function decideVote(voter) {
    const alive = living().filter(q => q.id !== voter.id);
    if (alive.length === 0) return null;

    if (voter.id === state.murdererId) {
        const topEntry = Object.entries(state.voteResults).sort((a,b) => b[1]-a[1])[0];
        if (topEntry && parseInt(topEntry[0]) !== state.murdererId) {
            const t = state.people.find(q => q.id === parseInt(topEntry[0]));
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

export function showNextVoter() {
    document.querySelectorAll('.voting-active').forEach(e => e.classList.remove('voting-active'));
    if (state.voteIndex >= state.voteOrder.length) { triggerExecute(); return; }

    const voter  = state.voteOrder[state.voteIndex];
    const target = decideVote(voter);  // JS fallback decision

    // Build debate summary for agent context
    const debateSummary = living().map(p => {
        const msgs = p.history.filter(h => h.day === state.dayNumber && h.type.startsWith('debate_'));
        return msgs.length > 0 ? `${p.name}: ${msgs.map(m => m.detail).join('; ')}` : null;
    }).filter(Boolean).join('\n');

    const candidateIds = living().filter(q => q.id !== voter.id).map(q => q.id);

    // Try agent vote (async), use JS fallback immediately
    if (target) {
        state.voteResults[target.id] = (state.voteResults[target.id] || 0) + 1;
        state.voteHistory.push({ voterId: voter.id, targetId: target.id });
        const fallbackMsg = `I vote ${target.name}!`;
        const ctx = `You are casting your vote. Previous votes: ${JSON.stringify(state.voteResults)}. You chose ${target.name}.`;
        requestDialog(voter, 'vote_announce', fallbackMsg, target.id, ctx);
        voter.history.push({ day: state.dayNumber, type: 'voted', target: target.id, detail: `Voted for ${target.name}` });
        recordMemory(voter.id, state.dayNumber, 'voted', `Voted for ${target.name}`, target.id);
    } else {
        voter.message = '...I abstain.';
        voter.history.push({ day: state.dayNumber, type: 'abstained', detail: `Abstained from voting` });
    }

    // Also try to get the agent's own vote decision (may override JS if it arrives fast)
    if (candidateIds.length > 0) {
        requestVote(voter, candidateIds, debateSummary).then(agentVoteId => {
            if (agentVoteId !== null && agentVoteId !== (target?.id ?? null)) {
                // Agent chose differently - update vote results
                if (target) {
                    state.voteResults[target.id] = Math.max(0, (state.voteResults[target.id] || 0) - 1);
                }
                state.voteResults[agentVoteId] = (state.voteResults[agentVoteId] || 0) + 1;
                const agentTarget = state.people.find(q => q.id === agentVoteId);
                if (agentTarget) {
                    // Update the last vote history entry
                    const lastVote = state.voteHistory.findLast(v => v.voterId === voter.id);
                    if (lastVote) lastVote.targetId = agentVoteId;
                    voter.message = `I vote ${agentTarget.name}!`;
                }
                updateVoteTally();
            }
        });
    }

    const voterEl = document.getElementById(`person-${voter.id}`);
    if (voterEl) voterEl.classList.add('voting-active');

    updateVoteTally();
    updatePhaseLabel();
    renderAllPeople();
    state.voteDisplayTimer = VOTE_DISPLAY_TICKS;
}

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

// ── Execute ───────────────────────────────────────────────────
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
                const targetPerson = state.people.find(q => q.id === entry.targetId);
                if (targetPerson) {
                    const feelingTowardTarget = p.relations[targetPerson.id] ?? 0;
                    if (feelingTowardTarget > 20) {
                        p.relations[entry.voterId] = Math.max(-100,
                            (p.relations[entry.voterId] ?? 0) - 8);
                        const voter = state.people.find(q => q.id === entry.voterId);
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

    const condemned = state.people.find(p => p.id === state.condemnedId);
    if (condemned) {
        condemned.activity  = 'moving';
        condemned.indoors   = false;
        const pleaCtx = 'You have been voted to be executed. The crowd is watching as you walk to the centre.';
        requestDialog(condemned, 'execute_plea', 'No... please!', null, pleaCtx);
        condemned.ticksLeft = 999;

        const worldEl = document.getElementById('world');
        condemned.targetX = (worldEl.clientWidth  / 2) - PERSON_SIZE / 2;
        condemned.targetY = (worldEl.clientHeight / 2) - PERSON_SIZE / 2;

        const el = document.getElementById(`person-${state.condemnedId}`);
        if (el) el.classList.add('condemned');

        for (const p of living()) {
            if (p.id === state.condemnedId) continue;
            const reactCtx = `${condemned.name} is being walked to the centre to be executed. You are watching.`;
            if (p.id === state.murdererId) {
                requestDialog(p, 'execute_react', pickBucketed(MURDERER_BLUFF, p.personality), condemned.id, reactCtx + ' You are the real murderer — act relieved or deflect.');
            } else {
                requestDialog(p, 'execute_react', pickBucketed(MOURN_LINES, p.personality), condemned.id, reactCtx);
            }
            recordMemory(p.id, state.dayNumber, 'execution', `Watched ${condemned.name} be executed`, condemned.id);
        }
    }

    renderAllPeople();
    updatePhaseLabel();
    updateStats();
}

export function finaliseExecution() {
    const panel = document.getElementById('vote-tally');
    if (panel) panel.style.display = 'none';

    document.querySelectorAll('.condemned').forEach(e => e.classList.remove('condemned'));

    if (state.voteTarget !== null) {
        state.deadIds.add(state.voteTarget);
        const condemned = state.people.find(p => p.id === state.voteTarget);
        if (condemned) {
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
            const el = document.getElementById(`person-${condemned.id}`);
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
        // Reset per-day theft tracking; keep accumulated fruit/money
        p.stolenFrom    = false;
        p.stolenAmount  = 0;
        p.spendingObserved = {};
        const h = state.houses[p.homeIndex];
        p.x = h.doorX + rndF(20) - 10;
        p.y = h.doorY + rndF(20) - 10;
        p.targetX = h.doorX + rndF(80) - 40;
        p.targetY = h.doorY + rndF(80) - 40;
        p.thought = pickThought(p.personality);
        requestThought(p, pickThought(p.personality));
        p.nextThoughtAt = Date.now() + thoughtDelayMs(p.thoughtStat);
    }
    renderAllPeople();
    updateHouseGuests();
    updateStats();
    updatePhaseLabel();
}

export function triggerGameOver(townWins) {
    state.gamePhase = PHASE.OVER;
    // stopAll will be called by simulation.js via the import
    if (state.tickInterval) { clearInterval(state.tickInterval); state.tickInterval = null; }
    if (state.rafId !== null) { cancelAnimationFrame(state.rafId); state.rafId = null; }

    const killer  = state.people.find(p => p.id === state.murdererId);
    const overlay = document.getElementById('game-over-overlay');
    if (overlay) {
        overlay.querySelector('.go-title').textContent = townWins
            ? '\u{1F40A} Swamp Wins!'
            : '\uD83D\uDD2A Killer Wins!';
        overlay.querySelector('.go-body').innerHTML = townWins
            ? `The swamp correctly identified <strong>${killer ? killer.name : 'the killer'}</strong> as the murderer!<br>Justice has been served.`
            : `<strong>${killer ? killer.name : 'The killer'}</strong> outlasted every gator and got away with it.`;
        overlay.style.display = 'flex';
    }
    updatePhaseLabel();
    updateStats();
}
