import {
    GATOR_SIZE, PHASE, TICK_MS, TALK_DIST, TALK_STOP,
    HOME_WARN_TICKS,
    VOTE_DISPLAY_TICKS,
    CONVICTION_THRESHOLD, GATOR_COUNT,
    PERSONALITY_EMOJI, MAX_DEBATE_SPEAKERS, DEBATE_SPEAK_COOLDOWN,
    CONV_LIMIT_FOR_NIGHTFALL, NIGHTFALL_DELAY_MS
} from './gameConfig.js';
import {
    rnd, rndF, rndTicks, stageBounds, dist, weightedPick,
    buildFigureSVG, culdesacLayout, buildCuldesacSVG,
    speakDelayMs, topicCompatibility, applyTopicRelationDelta,
    TOPICS, TOPIC_LABELS
} from './helpers.js';
import {
    createGator, initRelations, driftRelations, socialWeights, living
} from './gator.js';
import { state, resetGameState } from './state.js';
import {
    triggerNightfall, triggerDawn, triggerDebate, triggerVote,
    triggerExecute, showNextVoter, finaliseExecution,
    pickDebateSuspect
} from './phases.js';
import {
    renderGator, renderAllGators, updateStats, updatePhaseLabel,
    updateHouseGuests, syncTalkLines,
    initTooltip, showTooltip, moveTooltip, hideTooltip,
    pinTooltip, refreshPinnedTooltip, cleanPrivateChatBubbles
} from './rendering.js';
import { requestDialog, requestFullConversation, requestVote, recordMemory, drainNextConvTurn, setTickFunction } from './agentQueue.js';

// ── Test Conversation ─────────────────────────────────────────
export function testConversation() {
    const alive = living();
    if (alive.length < 2) { console.warn('Need at least 2 gators'); return; }

    // Pick two random gators
    const shuffled = alive.sort(() => Math.random() - 0.5);
    const a = shuffled[0];
    const b = shuffled[1];

    // Pick a random topic
    const topic = TOPICS[rnd(TOPICS.length)];
    const topicLabel = TOPIC_LABELS[topic] ?? topic;

    // Build context from their personalities and topic opinions
    const aOpinion = a.topicOpinions?.[topic] ?? 'unknown';
    const bOpinion = b.topicOpinions?.[topic] ?? 'unknown';
    const context = `Test conversation about ${topicLabel}. ` +
        `${a.name} (${a.personality}) feels ${aOpinion} about ${topic}. ` +
        `${b.name} (${b.personality}) feels ${bOpinion} about ${topic}.`;

    // Random turn count 5–8
    const maxTurns = 5 + rnd(4);
    const openingLine = `Hey ${b.name}, what do you think about ${topicLabel}?`;

    // Position them near each other
    const { W, H } = stageBounds();
    const cx = W / 2, cy = H / 2;
    a.x = cx - 40; a.y = cy; a.targetX = cx - 40; a.targetY = cy;
    b.x = cx + 40; b.y = cy; b.targetX = cx + 40; b.targetY = cy;

    // Set them to talking state
    a.activity = 'talking'; a.talkingTo = b.id; a.ticksLeft = 9999;
    b.activity = 'talking'; b.talkingTo = a.id; b.ticksLeft = 9999;
    a.message = openingLine;
    state.activeConversation = true;

    console.log(`🧪 Test Conversation: ${a.name} & ${b.name} about ${topicLabel} (${maxTurns} turns)`);

    requestFullConversation(a, b, openingLine, maxTurns, context, false, () => {
        _onConversationCompleted();
        a.activity = 'moving'; a.talkingTo = null; a.ticksLeft = rndTicks('moving');
        b.activity = 'moving'; b.talkingTo = null; b.ticksLeft = rndTicks('moving');
    });
}

// ── Chat logging & overhearing ────────────────────────────────
export function logChat(speaker, targetId, message, thought, isPrivate = false) {
    if (!message) return; // nothing meaningful to log
    const now = Date.now();
    const type = isPrivate ? 'private' : 'said';
    const entry = { day: state.dayNumber, from: speaker.id, to: targetId, message, thought: null, ts: now, type };
    const thoughtEntry = thought ? { day: state.dayNumber, from: speaker.id, to: null, message: null, thought, ts: now, type: 'thought' } : null;

    // Log to speaker
    speaker.chatLog.push(entry);
    if (thoughtEntry) speaker.chatLog.push(thoughtEntry);
    speaker.gameLog.push({ day: state.dayNumber, type: 'spoke', detail: `Said to ${state.gators.find(q => q.id === targetId)?.name ?? 'someone'}: "${message}"`, ts: now });

    // Log to target
    if (targetId !== null) {
        const target = state.gators.find(q => q.id === targetId);
        if (target) {
            target.chatLog.push({ ...entry, thought: null }); // target doesn't see speaker's thought
        }
    }

    // Private conversations cannot be overheard
    if (!isPrivate) {
        for (const obs of living()) {
            if (obs.id === speaker.id || obs.id === targetId) continue;
            if (dist(obs, speaker) <= TALK_DIST) {
                obs.chatLog.push({ day: state.dayNumber, from: speaker.id, to: targetId, message, thought: null, ts: now, type: 'overheard' });
                recordMemory(obs.id, state.dayNumber, 'overheard', `Overheard ${speaker.name} say: "${message}"`, speaker.id);
            }
        }
    }
}

// ── Conversation completion counter ───────────────────────────
function _onConversationCompleted() {
    state.activeConversation = false;
    state.completedConvCount++;
    console.log(`[Day] Conversation #${state.completedConvCount} completed.`);
    if (!state.dayEndTimerActive && state.completedConvCount >= CONV_LIMIT_FOR_NIGHTFALL) {
        state.dayEndTimerActive    = true;
        state.dayEndTimerExpiresAt = Date.now() + NIGHTFALL_DELAY_MS;
        console.log(`[Day] ${CONV_LIMIT_FOR_NIGHTFALL} conversations done — nightfall in ${NIGHTFALL_DELAY_MS / 1000}s`);
    }
}

// ── Opinion sharing helper ────────────────────────────────────
function _maybeShareOpinion(speaker, listener) {
    if (Math.random() > 0.30) return; // 30% chance per conversation
    const others = living().filter(q => q.id !== speaker.id && q.id !== listener.id);
    if (others.length === 0) return;

    const speakerFeelsListener = speaker.relations[listener.id] ?? 0;

    // If speaker dislikes listener, they may be guarded or lie to incriminate
    if (speakerFeelsListener < -30) {
        // Guarded: say little, or actively lie
        if (Math.random() < 0.5) {
            // Guarded response
            const ctx = `You are talking to ${listener.name} but you dislike them. Be evasive.`;
            requestDialog(speaker, 'guarded', listener.id, ctx);
            speaker.nextSpeakAt = Date.now() + 2500;
            speaker.history.push({ day: state.dayNumber, type: 'guarded', with: listener.id, detail: `Was guarded talking to ${listener.name}` });
            return;
        } else {
            // Lie to incriminate: pick someone they dislike and blame them
            const enemies = others.filter(q => (speaker.relations[q.id] ?? 0) < -20);
            const victims = others.filter(q => (speaker.relations[q.id] ?? 0) > 10);
            if (enemies.length > 0 && victims.length > 0) {
                const target = enemies[rnd(enemies.length)];
                const victim = victims[rnd(victims.length)];
                const ctx = `You are lying to ${listener.name} to frame ${target.name}. Blame ${target.name} for something ${victim.name} experienced.`;
                requestDialog(speaker, 'opinion', listener.id, ctx);
                speaker.nextSpeakAt = Date.now() + 2500;
                // Listener adjusts suspicion of the target
                const trust = Math.max(0, listener.relations[speaker.id] ?? 0);
                const influence = (trust / 100) * 25 + 8;
                listener.suspicion[target.id] = Math.min(100, (listener.suspicion[target.id] ?? 0) + influence);
                listener.relations[target.id] = Math.max(-100, (listener.relations[target.id] ?? 0) - influence * 0.5);
                speaker.history.push({ day: state.dayNumber, type: 'lied', to: listener.id, about: target.id, detail: `Lied to ${listener.name} to frame ${target.name}` });
                listener.history.push({ day: state.dayNumber, type: 'heard_rumor', from: speaker.id, about: target.id, detail: `Heard from ${speaker.name} that ${target.name} is suspicious` });
                return;
            }
        }
    }

    // Normal truthful opinion sharing
    // Pick the gator speaker has the strongest opinion about
    const target = others.reduce((best, c) =>
        Math.abs(speaker.relations[c.id] ?? 0) > Math.abs(speaker.relations[best.id] ?? 0) ? c : best
    , others[0]);

    // If speaker likes listener, they're more truthful. If disliking, may flip opinion.
    let opinion = speaker.relations[target.id] ?? 0;
    const trustworthy = speakerFeelsListener > 20;
    if (!trustworthy && speaker.liar && Math.random() < 0.4) {
        opinion = -opinion; // flip the opinion when lying
        speaker.history.push({ day: state.dayNumber, type: 'lied_opinion', to: listener.id, about: target.id, detail: `Lied about feelings toward ${target.name} to ${listener.name}` });
    }

    const isPositive = opinion >= 0;
    const ctx = `You are sharing your ${isPositive ? 'positive' : 'negative'} opinion about ${target.name} with ${listener.name}.`;
    requestDialog(speaker, 'opinion', listener.id, ctx);
    speaker.nextSpeakAt = Date.now() + 2500;

    // Listener adjusts their opinion of the target based on how much they trust the speaker
    const trust = Math.max(0, listener.relations[speaker.id] ?? 0);
    const influence = (trust / 100) * 18 + 4;
    const nudge = isPositive ? influence : -influence;
    const oldRel = listener.relations[target.id] ?? 0;
    listener.relations[target.id] = Math.max(-100, Math.min(100, oldRel + nudge));
    listener.perceivedRelations[target.id] = listener.relations[target.id];
    // Reinforce mutual distrust: distrustful listeners distrust disliked targets more
    if ((listener.relations[target.id] ?? 0) < -20) {
        listener.suspicion[target.id] = Math.min(100,
            (listener.suspicion[target.id] ?? 0) + Math.abs(nudge) * 0.4);
    }

    // Record history
    speaker.history.push({ day: state.dayNumber, type: 'shared_opinion', to: listener.id, about: target.id, positive: isPositive, detail: `Told ${listener.name} ${isPositive ? 'good' : 'bad'} things about ${target.name}` });
    if (Math.abs(nudge) > 5) {
        listener.history.push({ day: state.dayNumber, type: 'opinion_changed', about: target.id, delta: Math.round(nudge), detail: `${speaker.name} ${isPositive ? 'praised' : 'badmouthed'} ${target.name}, changed opinion by ${Math.round(nudge)}` });
    }
}

// ── Activity tick ─────────────────────────────────────────────
function tick() {
    if (state.gamePhase === PHASE.OVER) return;
    if (state.paused) return;

    state.cycleTimer--;
    if (state.cycleTimer <= 0) {
        if      (state.gamePhase === PHASE.DAY)    { triggerNightfall(); return; }
        else if (state.gamePhase === PHASE.NIGHT)  { triggerDawn();      return; }
        else if (state.gamePhase === PHASE.DAWN)   { triggerDebate();    return; }
        else if (state.gamePhase === PHASE.DEBATE) { triggerVote();      return; }
        else if (state.gamePhase === PHASE.VOTE)   { triggerExecute();   return; }
    }

    // Conversation-limit nightfall: once the 1-min timer expires, lock new convs and watch for all to finish
    if (state.gamePhase === PHASE.DAY && state.dayEndTimerActive) {
        const now = Date.now();
        if (!state.noNewConversations && now >= state.dayEndTimerExpiresAt) {
            state.noNewConversations = true;
        }
        if (state.noNewConversations) {
            const anyTalking = living().some(p => p.talkingTo !== null || p.activity === 'hosting' || p.activity === 'visiting');
            if (!anyTalking) {
                triggerNightfall();
                return;
            }
        }
    }

    // At HOME_WARN_TICKS left in the day, end all conversations and walk everyone home
    if (state.gamePhase === PHASE.DAY && state.cycleTimer === HOME_WARN_TICKS) {
        for (const p of living()) {
            if (p.talkingTo !== null) {
                const partner = state.gators.find(q => q.id === p.talkingTo);
                if (partner) { partner.talkingTo = null; partner.message = null; partner.ticksLeft = 1; }
                p.talkingTo = null; p.message = null; p.ticksLeft = 1;
            }
            if (!p.indoors) {
                const h = state.houses[p.homeIndex];
                p.targetX = h.doorX - GATOR_SIZE / 2;
                p.targetY = h.doorY + 10;
            }
        }
        state.talkLines.forEach(l => l.remove()); state.talkLines.clear();
    }

    // Sequential vote: advance to next voter each VOTE_DISPLAY_TICKS ticks
    if (state.gamePhase === PHASE.VOTE) {
        state.voteDisplayTimer--;
        if (state.voteDisplayTimer <= 0) {
            state.voteIndex++;
            showNextVoter();
        }
        updatePhaseLabel();
        return;
    }

    // Execute phase: wait for condemned to reach centre, then die
    if (state.gamePhase === PHASE.EXECUTE) {
        if (state.condemnedId !== null) {
            const condemned = state.gators.find(p => p.id === state.condemnedId);
            if (condemned) {
                const worldEl = document.getElementById('world');
                const cx = worldEl.clientWidth  / 2 - GATOR_SIZE / 2;
                const cy = worldEl.clientHeight / 2 - GATOR_SIZE / 2;
                const dx = cx - condemned.x, dy = cy - condemned.y;
                const d  = Math.sqrt(dx*dx + dy*dy);
                if (d < 20) {
                    state.executeTimer--;
                    if (state.executeTimer <= 0) {
                        finaliseExecution();
                        return;
                    }
                }
            }
        } else {
            finaliseExecution();
            return;
        }
        updatePhaseLabel();
        return;
    }

    updatePhaseLabel();
    if (state.gamePhase === PHASE.NIGHT) return;

    const activePeople = living();

    const free = new Set(
        activePeople.filter(p =>
            p.activity !== 'resting' &&
            p.activity !== 'visiting' &&
            p.talkingTo === null
        ).map(p => p.id)
    );

    // Count current speakers in debate so we can cap simultaneous speech
    let debateSpeakerCount = 0;
    if (state.gamePhase === PHASE.DEBATE) {
        debateSpeakerCount = activePeople.filter(p => p.activity === 'debating' && !!p.message).length;
    }

    for (const gator of activePeople) {
        gator.ticksLeft--;

        // Thoughts are handled in gameLoop() on real-time schedules per gator.
        // Speech cooldowns are also real-time; check Date.now() against nextSpeakAt.
        const now = Date.now();
        const canSpeak = now >= gator.nextSpeakAt;

        // Conversation turn-taking is handled by the full-conversation drain timer.
        // During an ongoing talk, just let the drain timer advance the turns.
        if (gator.activity === 'debating' && gator.ticksLeft > 0) {
            if (canSpeak && debateSpeakerCount < MAX_DEBATE_SPEAKERS) {
                const suspect = pickDebateSuspect(gator);
                if (suspect) {
                    const lines = [
                        `I suspect ${suspect.name}!`,
                        `Watch out for ${suspect.name}…`,
                        `${suspect.name} is acting suspicious.`,
                        `Don't trust ${suspect.name}.`
                    ];
                    gator.message = lines[rnd(lines.length)];
                } else {
                    const lines = [`I didn't do it!`, `Leave me out of this.`, `It wasn't me!`];
                    gator.message = lines[rnd(lines.length)];
                }

                // Persuasion: high-conviction persons influence liked neighbours
                if (suspect && gator.conviction > CONVICTION_THRESHOLD) {
                    const listeners = living().filter(q =>
                        q.id !== gator.id &&
                        (gator.relations[q.id] ?? 0) > 10
                    );
                    if (listeners.length > 0) {
                        const listener = listeners[rnd(listeners.length)];
                        const liking = Math.max(0, listener.relations[gator.id] ?? 0);
                        const influence = (liking / 100) * 22 + 5;
                        listener.suspicion[suspect.id] = Math.min(100,
                            (listener.suspicion[suspect.id] ?? 0) + influence);
                        listener.conviction = Math.min(100, Math.max(
                            listener.conviction, listener.suspicion[suspect.id]));
                        gator.history.push({ day: state.dayNumber, type: 'persuaded', target: listener.id, about: suspect.id, detail: `Tried to convince ${listener.name} that ${suspect.name} is guilty` });
                    }
                }

                const debateMs = 3000 + Math.random() * 5000;
                gator.nextSpeakAt = now + debateMs;
                debateSpeakerCount++;
            } else if (!canSpeak && gator.nextSpeakAt - now < 800) {
                gator.message = null;
            }
        }

        // Invitation disabled — conversations limited to 2 alligators

        if (gator.ticksLeft > 0) continue;

        // End talking
        if (gator.talkingTo !== null) {
            const partner = state.gators.find(p => p.id === gator.talkingTo);
            if (partner && partner.talkingTo === gator.id) {
                // Hold gators in place while AI call is in-flight OR turns are still playing back OR in final hold
                const aiPending = gator.isWaiting || partner.isWaiting;
                const gatorDraining = gator._convTurns && gator._convTurnIndex < gator._convTurns.length;
                const partnerDraining = partner._convTurns && partner._convTurnIndex < partner._convTurns.length;
                const finalHold = gator._convHolding || partner._convHolding;
                if (aiPending || gatorDraining || partnerDraining || finalHold) {
                    gator.ticksLeft = 1; // keep ticking until AI + playback finishes
                    continue;
                }
                driftRelations(gator, partner);
                recordMemory(gator.id, state.dayNumber, 'conversation_end', `Finished talking with ${partner.name}`, partner.id);
                recordMemory(partner.id, state.dayNumber, 'conversation_end', `Finished talking with ${gator.name}`, gator.id);
                const pFeels = gator.relations[partner.id] ?? 0;
                const qFeels = partner.relations[gator.id] ?? 0;
                const pSentiment = pFeels > 20 ? 'positive' : pFeels < -20 ? 'negative' : 'neutral';
                const qSentiment = qFeels > 20 ? 'positive' : qFeels < -20 ? 'negative' : 'neutral';
                gator.history.push({ day: state.dayNumber, type: 'talked', with: partner.id, sentiment: pSentiment, detail: `Talked with ${partner.name} (felt ${pSentiment})` });
                partner.history.push({ day: state.dayNumber, type: 'talked', with: gator.id, sentiment: qSentiment, detail: `Talked with ${gator.name} (felt ${qSentiment})` });
                const now = Date.now();
                (gator.recentTalkWith   ??= {})[partner.id] = now;
                (partner.recentTalkWith ??= {})[gator.id]   = now;
                partner.talkingTo = null;
                partner.ticksLeft = 0;
                free.add(partner.id);
                _maybeShareOpinion(gator, partner);

                // Conversation completion is now tracked via the onComplete callback from agentQueue
                _onConversationCompleted();
            }
            gator.talkingTo = null;
            gator.message   = null;
            free.add(gator.id);
        }

        // End hosting — guests leave (but only once AI drain + 3s hold is done)
        if (gator.activity === 'hosting') {
            // Hold in place while AI call is in-flight or drain is still active
            const aiPending = gator.isWaiting || state.gators.some(g => g.guestOfIndex === gator.homeIndex && g.isWaiting);
            const drainActive = (gator._convTurns && gator._convTurns.length > 0);
            if (aiPending || drainActive) {
                gator.ticksLeft = 1;
                continue;
            }
            for (const guest of state.gators) {
                if (guest.guestOfIndex === gator.homeIndex) {
                    driftRelations(gator, guest);
                    const now = Date.now();
                    (gator.recentTalkWith  ??= {})[guest.id]  = now;
                    (guest.recentTalkWith  ??= {})[gator.id]  = now;
                    guest.guestOfIndex = null;
                    guest.talkingTo    = null;
                    guest.indoors      = false;
                    guest.activity     = 'moving';
                    guest.ticksLeft    = rndTicks('moving');
                    const h = state.houses[gator.homeIndex];
                    guest.x = h.doorX + rndF(16) - 8;
                    guest.y = h.doorY + rndF(16) - 8;
                    guest.targetX = guest.x + rndF(60) - 30;
                    guest.targetY = guest.y + rndF(60) - 30;
                    free.add(guest.id);
                }
            }
            gator.talkingTo = null;
            gator.indoors  = false;
            gator.activity = 'moving';
            gator.message  = null;
            gator.ticksLeft = rndTicks('moving');
            const h = state.houses[gator.homeIndex];
            gator.x = h.doorX;
            gator.y = h.doorY;
            free.add(gator.id);
            updateHouseGuests();
            continue;
        }

        // End visiting
        if (gator.activity === 'visiting') {
            gator.guestOfIndex = null;
            gator.talkingTo    = null;
            gator.indoors      = false;
            gator.activity     = 'moving';
            gator.message      = null;
            gator.ticksLeft    = rndTicks('moving');
            free.add(gator.id);
            updateHouseGuests();
            continue;
        }

        // Debating — ends only when the phase timer fires
        if (gator.activity === 'debating') continue;

        let next = weightedPick(socialWeights(gator));

        if (next === 'talking') {
            const TALK_COOLDOWN_MS = 60_000;
            const now = Date.now();
            // Don't start new conversations if the nightfall lock or global conv lock is active
            if (!state.noNewConversations && !state.activeConversation) {
            const nearby = [...free]
                .filter(id => id !== gator.id)
                .map(id => state.gators.find(p => p.id === id))
                .filter(p => p && dist(gator, p) <= TALK_DIST)
                .filter(p => (gator.relations[p.id] ?? 0) > -60)
                .filter(p => (now - ((gator.recentTalkWith ?? {})[p.id] ?? 0)) >= TALK_COOLDOWN_MS)
                .filter(p => p.activity !== 'talking' && p.talkingTo == null); // Don't invite gators already committed to a conversation

            if (nearby.length > 0) {
                const partner = nearby.reduce((best, cand) => {
                    const bScore = (gator.relations[best.id] ?? 0) + rnd(40);
                    const cScore = (gator.relations[cand.id] ?? 0) + rnd(40);
                    return cScore > bScore ? cand : best;
                });
                const dur = rndTicks('talking');
                gator.activity  = 'talking'; gator.talkingTo = partner.id; gator.ticksLeft = dur;
                partner.activity = 'talking'; partner.talkingTo = gator.id; partner.ticksLeft = dur;

                state.activeConversation = true;
                const firstMeeting = !(gator.met ??= new Set()).has(partner.id);
                if (firstMeeting) {
                    // Mark both as met
                    gator.met.add(partner.id);
                    (partner.met ??= new Set()).add(gator.id);

                    // Seed relation from topic compatibility
                    const compat = topicCompatibility(gator.topicOpinions ?? {}, partner.topicOpinions ?? {});
                    const seed = Math.round(compat * 0.2);
                    gator.relations[partner.id]  = Math.max(-100, Math.min(100, seed));
                    partner.relations[gator.id]  = Math.max(-100, Math.min(100, seed));
                    gator.perceivedRelations[partner.id]  = gator.liar && seed < -20 ? Math.min(100, -seed * 0.4 + rnd(20)) : seed;
                    partner.perceivedRelations[gator.id]  = partner.liar && seed < -20 ? Math.min(100, -seed * 0.4 + rnd(20)) : seed;

                    const introCtx = `First meeting. ${gator.name} has opinions: ${Object.entries(gator.topicOpinions ?? {}).map(([t,v])=>`${t}:${v>0?'+':''}${v}`).join(', ')}.`;
                    const openingLine = `Hi, I'm ${gator.name}!`;
                    gator.message = openingLine;
                    requestFullConversation(gator, partner, openingLine, 6, introCtx, false, _onConversationCompleted);

                    gator.history.push({ day: state.dayNumber, type: 'first_meeting', with: partner.id, detail: `Met ${partner.name} for the first time (compat: ${compat})` });
                    partner.history.push({ day: state.dayNumber, type: 'first_meeting', with: gator.id, detail: `Met ${gator.name} for the first time (compat: ${compat})` });
                    recordMemory(gator.id, state.dayNumber, 'first_meeting', `Met ${partner.name} for the first time`, partner.id);
                    recordMemory(partner.id, state.dayNumber, 'first_meeting', `Met ${gator.name} for the first time`, gator.id);
                } else {
                    const openingLine = `Hey ${partner.name}!`;
                    gator.message = openingLine;
                    requestFullConversation(gator, partner, openingLine, 6, null, false, _onConversationCompleted);
                    recordMemory(gator.id, state.dayNumber, 'conversation_start', `Started talking with ${partner.name}`, partner.id);
                    recordMemory(partner.id, state.dayNumber, 'conversation_start', `${gator.name} started talking to me`, gator.id);
                }
                free.delete(gator.id);
                free.delete(partner.id);
                continue;
            }
            } // end if (!state.noNewConversations)
            const anyFree = [...free].filter(id => id !== gator.id).map(id => state.gators.find(p => p.id === id)).filter(Boolean);
            if (anyFree.length > 0) {
                const target = anyFree
                    .filter(q => (gator.relations[q.id] ?? 0) > -40)
                    .reduce((a, b) =>
                        (gator.relations[a.id] ?? 0) >= (gator.relations[b.id] ?? 0) ? a : b,
                        anyFree[0]
                    );
                gator.targetX = target.x;
                gator.targetY = target.y;
            }
            next = 'moving';
        }

        if (next === 'hosting' && !state.noNewConversations && !state.activeConversation) {
        const TALK_COOLDOWN_MS = 60_000;
        const now = Date.now();
        const guest = [...free]
            .filter(id => id !== gator.id)
            .filter(id => (now - ((gator.recentTalkWith ?? {})[id] ?? 0)) >= TALK_COOLDOWN_MS)
            .map(id => state.gators.find(p => p.id === id))
            .filter(p => p && p.activity !== 'talking' && p.talkingTo == null) // Don't invite gators already committed
            .filter(Boolean)[0];

        if (guest) {
            const h = state.houses[gator.homeIndex];
            gator.activity   = 'hosting';
            gator.indoors    = true;
            gator.ticksLeft  = rndTicks('hosting');
            gator.talkingTo  = guest.id;
            gator.x          = h.doorX - GATOR_SIZE / 2;
            gator.y          = h.doorY - GATOR_SIZE;
            gator.targetX    = h.doorX;
            gator.targetY    = h.doorY;
            guest.activity      = 'visiting';
            guest.guestOfIndex  = gator.homeIndex;
            guest.ticksLeft     = gator.ticksLeft;
            guest.talkingTo     = gator.id;
            guest.targetX       = h.doorX;
            guest.targetY       = h.doorY;
            free.delete(gator.id);
            free.delete(guest.id);

            // Build topic-discussion context for the AI
            const hostOpinions  = gator.topicOpinions ?? {};
            const guestOpinions = guest.topicOpinions ?? {};
            const topicCtx = [
                `Private visit at ${gator.name}'s home.`,
                `Topics to discuss (weave naturally into conversation):`,
                `- Sports: ${gator.name} supports ${hostOpinions.sports_team ?? '?'}, ${guest.name} supports ${guestOpinions.sports_team ?? '?'}.`,
                `  Rockets and Jets are the local teams; Chowda fans are out-of-towners looked down on by locals.`,
                `- Local gossip: share opinions/rumours about neighbours.`,
                `- Swamp leadership: ${gator.name} ${(hostOpinions.swamp_leadership ?? 0) >= 0 ? 'approves' : 'disapproves'} of leadership; ${guest.name} ${(guestOpinions.swamp_leadership ?? 0) >= 0 ? 'approves' : 'disapproves'}.`,
                `- Favorite swamp activities: discuss what each loves to do.`,
                `Keep it casual and in-character.`,
            ].join(' ');

            // On completion: apply topic-based relation delta, then release gators
            const _host = gator;
            const _guest = guest;
            const onHostingComplete = () => {
                const { delta, reasons } = applyTopicRelationDelta(_host, _guest);
                console.log(`[Hosting] ${_host.name} & ${_guest.name} topic delta: ${delta > 0 ? '+' : ''}${delta}`, reasons);
                _host.history.push({ day: state.dayNumber, type: 'hosted', with: _guest.id, detail: `Hosted ${_guest.name}; topic bond: ${delta > 0 ? '+' : ''}${delta}` });
                _guest.history.push({ day: state.dayNumber, type: 'visited', with: _host.id, detail: `Visited ${_host.name}; topic bond: ${delta > 0 ? '+' : ''}${delta}` });
                recordMemory(_host.id, state.dayNumber, 'hosting_complete', `Finished hosting ${_guest.name}`, _guest.id);
                recordMemory(_guest.id, state.dayNumber, 'visit_complete', `Finished visiting ${_host.name}`, _host.id);
                _onConversationCompleted();
            };

            state.activeConversation = true;
            // Start a private conversation between host and guest
            const openingLine = `Come on in, ${guest.name}!`;
            gator.message = openingLine;
            requestFullConversation(gator, guest, openingLine, 6, topicCtx, true, onHostingComplete);
            recordMemory(gator.id, state.dayNumber, 'hosting', `Hosted ${guest.name} at home`, guest.id);
            recordMemory(guest.id, state.dayNumber, 'visiting', `Visited ${gator.name} at home`, gator.id);

                updateHouseGuests();
                continue;
            }
            next = 'moving';
        }

        gator.activity  = next;
        gator.ticksLeft = rndTicks(next);
        gator.message   = null;
        if (next === 'moving') {
            const { W, H } = stageBounds();
            gator.targetX = rndF(W);
            gator.targetY = rndF(H);
            gator.indoors = false;

            }

        if (next === 'resting') free.delete(gator.id);
        else free.add(gator.id);
    }

    activePeople.forEach(renderGator);
    // Remove enclosures for any hosting pair that has ended
    for (const [homeIdx, enc] of state.privateChatBubbles) {
        const inUse = activePeople.some(p =>
            p.indoors &&
            (p.activity === 'hosting' || p.activity === 'visiting') &&
            (p.homeIndex === homeIdx || p.guestOfIndex === homeIdx)
        );
        if (!inUse) { enc.remove(); state.privateChatBubbles.delete(homeIdx); }
    }
    updateStats();
}

// ── Animation loop ────────────────────────────────────────────
function gameLoop() {
    if (!state.paused) {
        const { W, H } = stageBounds();
        const cx = GATOR_SIZE / 2;

        for (const p of state.gators) {
            if (state.deadIds.has(p.id)) continue;
            if (state.gamePhase === PHASE.NIGHT) continue;

            // During execute phase: only move the condemned
            if (state.gamePhase === PHASE.EXECUTE) {
                if (p.id !== state.condemnedId) continue;
                const worldEl = document.getElementById('world');
                const destX = (worldEl.clientWidth  / 2) - GATOR_SIZE / 2;
                const destY = (worldEl.clientHeight / 2) - GATOR_SIZE / 2;
                const dx = destX - p.x, dy = destY - p.y;
                const d  = Math.sqrt(dx*dx + dy*dy);
                if (d > 4) {
                    p.x = Math.max(0, Math.min(W, p.x + (dx/d) * p.speed * 1.5));
                    p.y = Math.max(0, Math.min(H, p.y + (dy/d) * p.speed * 1.5));
                }
                const el = document.getElementById(`gator-${p.id}`);
                if (el) { el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; }
                const bubbleEl = state.bubbles.get(p.id);
                if (bubbleEl) {
                    bubbleEl.style.left = `${p.x + GATOR_SIZE / 2 - 20}px`;
                    bubbleEl.style.top  = `${p.y - 38}px`;
                }
                continue;
            }
            if (p.activity === 'resting') {
                if (!p.indoors) {
                        const h = state.houses[p.homeIndex];
                        p.x = h.doorX - GATOR_SIZE / 2;
                        p.y = h.doorY - GATOR_SIZE;
                        p.indoors = true;
                    }
            } else if (p.activity === 'hosting') {
                if (!p.indoors) {
                    const h   = state.houses[p.homeIndex];
                    const ddx = h.doorX - (p.x + cx);
                    const ddy = h.doorY - (p.y + cx);
                    const dd  = Math.sqrt(ddx*ddx + ddy*ddy);
                    if (dd > 5) {
                        p.x = Math.max(0, Math.min(W, p.x + (ddx/dd) * p.speed));
                        p.y = Math.max(0, Math.min(H, p.y + (ddy/dd) * p.speed));
                    } else {
                        p.x = h.doorX - GATOR_SIZE / 2;
                        p.y = h.doorY - GATOR_SIZE;
                        p.indoors = true;
                    }
                } else {
                    // Gentle drift within the enclosure bubble
                    const h = state.houses[p.homeIndex];
                    const r = 38; // drift radius within enclosure
                    const dx = p.targetX - p.x, dy = p.targetY - p.y;
                    const d  = Math.sqrt(dx*dx + dy*dy);
                    if (d <= p.speed * 0.4) {
                        p.targetX = h.x + (Math.random() * 2 - 1) * r;
                        p.targetY = h.y + (Math.random() * 2 - 1) * r;
                    } else {
                        p.x += (dx/d) * p.speed * 0.4;
                        p.y += (dy/d) * p.speed * 0.4;
                    }
                }
            } else if (p.activity === 'visiting') {
                if (!p.indoors) {
                    const h   = state.houses[p.guestOfIndex];
                    const ddx = h.doorX - (p.x + cx);
                    const ddy = h.doorY - (p.y + cx);
                    const dd  = Math.sqrt(ddx*ddx + ddy*ddy);
                    if (dd > 8) {
                        p.x = Math.max(0, Math.min(W, p.x + (ddx/dd) * p.speed));
                        p.y = Math.max(0, Math.min(H, p.y + (ddy/dd) * p.speed));
                    } else {
                        p.x = h.x - GATOR_SIZE / 2;
                        p.y = h.y - GATOR_SIZE / 2;
                        p.indoors = true;
                    }
                } else {
                    // Gentle drift within the enclosure bubble (offset from host)
                    const h = state.houses[p.guestOfIndex];
                    const r = 38;
                    const dx = p.targetX - p.x, dy = p.targetY - p.y;
                    const d  = Math.sqrt(dx*dx + dy*dy);
                    if (d <= p.speed * 0.4) {
                        p.targetX = h.x + (Math.random() * 2 - 1) * r;
                        p.targetY = h.y + GATOR_SIZE * 0.5 + (Math.random() * 2 - 1) * (r * 0.5);
                    } else {
                        p.x += (dx/d) * p.speed * 0.4;
                        p.y += (dy/d) * p.speed * 0.4;
                    }
                }
            } else if (p.activity === 'debating') {
                const dx = p.targetX - p.x, dy = p.targetY - p.y;
                const d  = Math.sqrt(dx*dx + dy*dy);
                if (d > 4) {
                    p.x = Math.max(0, Math.min(W, p.x + (dx/d) * p.speed));
                    p.y = Math.max(0, Math.min(H, p.y + (dy/d) * p.speed));
                }
            } else if (p.activity === 'talking') {
                // Freeze gators completely during conversation
                if (p._conversationFrozen) {
                    // Do not move at all - stay completely frozen
                    continue;
                }

                const partner = state.gators.find(q => q.id === p.talkingTo);
                if (partner) {
                    const dx = (partner.x+cx)-(p.x+cx), dy = (partner.y+cx)-(p.y+cx);
                    const d  = Math.sqrt(dx*dx+dy*dy);
                    // Keep closing until gators are face-to-face; stop well within TALK_STOP
                    const stopAt = GATOR_SIZE * 0.6;
                    if (d > stopAt) {
                        const s = p.speed * 0.5;
                        p.x = Math.max(0, Math.min(W, p.x+(dx/d)*s));
                        p.y = Math.max(0, Math.min(H, p.y+(dy/d)*s));
                    }
                    // Don't let a talking gator drift away toward a stale targetX/Y
                    p.targetX = p.x;
                    p.targetY = p.y;
                }
            } else {
                // Default movement behavior
                const dx = p.targetX - p.x, dy = p.targetY - p.y;
                const d  = Math.sqrt(dx*dx+dy*dy);
                if (d <= p.speed) {
                    p.x = p.targetX; p.y = p.targetY;
                    const { W: bW, H: bH } = stageBounds();
                    p.targetX = rndF(bW); p.targetY = rndF(bH);
                } else {
                    p.x = Math.max(0, Math.min(W, p.x+(dx/d)*p.speed));
                    p.y = Math.max(0, Math.min(H, p.y+(dy/d)*p.speed));
                }
            }

            const el = document.getElementById(`gator-${p.id}`);
            if (el) {
                el.style.left = `${p.x}px`;
                el.style.top  = `${p.y}px`;
                const isPrivate = p.indoors && (p.activity === 'hosting' || p.activity === 'visiting');
                el.classList.toggle('indoors',         p.indoors && !isPrivate);
                el.classList.toggle('indoors-private', isPrivate);
            }

            const bubbleEl = state.bubbles.get(p.id);
            if (bubbleEl) {
                bubbleEl.style.left = `${p.x + GATOR_SIZE / 2 - 20}px`;
                bubbleEl.style.top  = `${p.y - 38}px`;
            }
        }

        syncTalkLines();
    }

    state.rafId = requestAnimationFrame(gameLoop);
}

// ── Spawn / lifecycle ─────────────────────────────────────────
function startAll() {
    state.paused = false;
    document.getElementById('pauseBtn').textContent = '\u23F8 Pause';
    if (!state.tickInterval) state.tickInterval = setInterval(tick, TICK_MS);
    stopRaf(); startRaf();
}

function stopAll() {
    if (state.tickInterval) { clearInterval(state.tickInterval); state.tickInterval = null; }
    stopRaf();
}

function startRaf() { state.rafId = requestAnimationFrame(gameLoop); }
function stopRaf()  { if (state.rafId !== null) { cancelAnimationFrame(state.rafId); state.rafId = null; } }

function spawnGators() {
    stopAll();
    state.gators = []; state.nextId = 0;

    // Close the gator panel if open
    const panel = document.getElementById('gator-panel');
    if (panel) { panel.style.display = 'none'; panel.classList.remove('panel-open'); }

    const world = document.getElementById('world');
    world.querySelectorAll('.gator').forEach(e => e.remove());
    world.querySelectorAll('.chat-bubble').forEach(e => e.remove());
    world.querySelectorAll('.thought-bubble').forEach(e => e.remove());
    world.querySelectorAll('.house-label').forEach(e => e.remove());
    world.querySelectorAll('.house-guests').forEach(e => e.remove());
    state.talkLines.forEach(l => l.remove()); state.talkLines.clear();
    state.bubbles.forEach(b => b.remove()); state.bubbles.clear();
    state.thoughts.forEach(t => t.remove()); state.thoughts.clear();
    cleanPrivateChatBubbles();

    // Rebuild cul-de-sac SVG
    const existing = document.getElementById('culdesac');
    if (existing) existing.remove();
    const layout = culdesacLayout();
    state.houses = layout.housePositions;
    world.insertAdjacentHTML('afterbegin', buildCuldesacSVG(layout));

    // House labels and guest badges
    for (let i = 0; i < GATOR_COUNT; i++) {
        const h = state.houses[i];
        const lbl = document.createElement('span');
        lbl.className = 'house-label';
        lbl.id        = `house-label-${i}`;
        lbl.style.left = `${h.x}px`;
        lbl.style.top  = `${h.y - 52}px`;
        world.appendChild(lbl);

        const badge = document.createElement('span');
        badge.className = 'house-guests';
        badge.id        = `house-guests-${i}`;
        badge.style.left = `${h.x - 20}px`;
        badge.style.top  = `${h.y - 36}px`;
        world.appendChild(badge);
    }

    for (let i = 0; i < GATOR_COUNT; i++) {
        const p  = createGator(i, state.houses[i]);
        state.gators.push(p);

        const lbl = document.getElementById(`house-label-${i}`);
        if (lbl) lbl.textContent = `${p.name}'s`;

        const el = document.createElement('div');
        el.id = `gator-${p.id}`;
        el.className = `gator activity-${p.activity}`;
        el.style.cssText = `left:${p.x}px;top:${p.y}px`;

        const nameEl = document.createElement('span');
        nameEl.className = 'name-above';
        nameEl.textContent = p.name;

        const badge = document.createElement('span');
        badge.className = 'personality-badge';
        badge.textContent = PERSONALITY_EMOJI[p.personality];

        el.insertAdjacentHTML('beforeend', buildFigureSVG(p));
        el.appendChild(badge);

        el.insertBefore(nameEl, el.firstChild);

        el.addEventListener('click',      e => pinTooltip(e, p));

        world.appendChild(el);
    }

    // Reset game state
    resetGameState();

    // Clear dead body markers from previous game
    document.querySelectorAll('.dead-marker').forEach(e => e.remove());

    // Hide overlays
    const goOverlay = document.getElementById('game-over-overlay');
    if (goOverlay) goOverlay.style.display = 'none';
    const tallyPanel = document.getElementById('vote-tally');
    if (tallyPanel) tallyPanel.style.display = 'none';

    const nightOv = document.getElementById('night-overlay');
    if (nightOv) nightOv.classList.remove('active');
    document.getElementById('world').classList.remove('night');

    initRelations();

    // Pick murderer
    const pool      = state.gators.slice().sort(() => Math.random() - 0.5);
    const preferred = pool.find(p => p.personality === 'extrovert' || p.personality === 'grumpy');
    const murderer  = preferred || pool[0];
    state.murdererId      = murderer.id;
    murderer.liar   = true;
    for (const q of state.gators) {
        if (q.id === murderer.id) continue;
        murderer.perceivedRelations[q.id] = Math.abs(murderer.relations[q.id] ?? 0) * 0.5 + 20;
    }

    updateStats();
    updatePhaseLabel();

    // Initialize SK agents on the server with the spawned alligator data
    const alligatorData = state.gators.map(p => {
        const { sports_team, ...numericOpinions } = p.topicOpinions ?? {};
        return {
            id: p.id,
            name: p.name,
            personality: p.personality,
            isMurderer: p.id === state.murdererId,
            isLiar: p.liar,
            topicOpinions: numericOpinions,
            sportsTeam: sports_team ?? ''
        };
    });
    fetch('/api/agent/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alligatorData)
    })
        .then(() => console.log('SK agents initialized'))
        .catch(err => console.warn('SK agent init failed (continuing without AI):', err));

    startAll();
}

// ── Module entry point ────────────────────────────────────────
export function initSimulation(agentInterop) {
    initTooltip();

    // Provide tick function reference to agentQueue to avoid circular import
    setTickFunction(tick);

    document.getElementById('respawnBtn').addEventListener('click', spawnGators);
    document.getElementById('goRestartBtn').addEventListener('click', spawnGators);

    document.getElementById('pauseBtn').addEventListener('click', () => {
        if (state.paused) {
            state.paused = false;
            document.getElementById('pauseBtn').textContent = '\u23F8 Pause';
            if (!state.tickInterval) state.tickInterval = setInterval(tick, TICK_MS);
        } else {
            state.paused = true;
            document.getElementById('pauseBtn').textContent = '\u25B6 Resume';
            if (state.tickInterval) { clearInterval(state.tickInterval); state.tickInterval = null; }
        }
    });

    document.getElementById('testConvBtn').addEventListener('click', testConversation);

    window.addEventListener('resize', () => {
        const existing = document.getElementById('culdesac');
        if (existing) {
            const layout = culdesacLayout();
            state.houses = layout.housePositions;
            existing.outerHTML = buildCuldesacSVG(layout);
        }
        const { W, H } = stageBounds();
        for (const p of state.gators) {
            p.x = Math.min(p.x, W); p.y = Math.min(p.y, H);
            if (p.targetX > W) p.targetX = rndF(W);
            if (p.targetY > H) p.targetY = rndF(H);
        }
    });

    requestAnimationFrame(() => requestAnimationFrame(spawnGators));
}


