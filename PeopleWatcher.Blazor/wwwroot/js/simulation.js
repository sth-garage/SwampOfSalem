import {
    PERSON_SIZE, PHASE, TICK_MS, TALK_DIST, TALK_STOP,
    SOCIAL_DECAY, SOCIAL_GAIN, SOCIAL_MAX, HOME_WARN_TICKS,
    VOTE_DISPLAY_TICKS, MURDERER_BLUFF, ACCUSE_LINES, DEFEND_LINES,
    PERSUADE_LINES, CONVICTION_THRESHOLD, PEOPLE_COUNT,
    PERSONALITY_EMOJI, MAX_DEBATE_SPEAKERS, DEBATE_SPEAK_COOLDOWN,
    SHOP_LINES, ORANGE_BUY_LINES, OPINION_SHARE_LINES_POS, OPINION_SHARE_LINES_NEG,
    OBSERVE_SHOP_RADIUS, ORANGE_PRICE, APPLE_PRICE,
    GUARDED_LINES, LIE_INCRIMINATE_LINES, DEBATE_ARGUMENT_LINES
} from './constants.js';
import {
    rnd, rndF, rndTicks, pickMessage, pickInvite, pickThought,
    pickRelationThought, stageBounds, dist, weightedPick,
    buildFigureSVG, culdesacLayout, buildCuldesacSVG, socialColor,
    thoughtDelayMs, speakDelayMs, pickBucketed
} from './helpers.js';
import {
    createPerson, initRelations, driftRelations, socialWeights, living
} from './people.js';
import { state, resetGameState } from './state.js';
import {
    triggerNightfall, triggerDawn, triggerDebate, triggerVote,
    triggerExecute, showNextVoter, finaliseExecution,
    pickDebateSuspect
} from './phases.js';
import {
    renderPerson, renderAllPeople, updateStats, updatePhaseLabel,
    updateHouseGuests, syncTalkLines,
    initTooltip, showTooltip, moveTooltip, hideTooltip,
    pinTooltip, refreshPinnedTooltip
} from './rendering.js';
import { buyFruit } from './store.js';

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
            speaker.message = pickBucketed(GUARDED_LINES, speaker.personality);
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
                const line = pickBucketed(LIE_INCRIMINATE_LINES, speaker.personality)
                    .replace('{target}', target.name).replace('{victim}', victim.name);
                speaker.message = line;
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
    // Pick the person speaker has the strongest opinion about
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
    const lines = isPositive ? OPINION_SHARE_LINES_POS : OPINION_SHARE_LINES_NEG;
    speaker.message = pickBucketed(lines, speaker.personality).replace('{name}', target.name);
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

    state.cycleTimer--;
    if (state.cycleTimer <= 0) {
        if      (state.gamePhase === PHASE.DAY)    { triggerNightfall(); return; }
        else if (state.gamePhase === PHASE.NIGHT)  { triggerDawn();      return; }
        else if (state.gamePhase === PHASE.DAWN)   { triggerDebate();    return; }
        else if (state.gamePhase === PHASE.DEBATE) { triggerVote();      return; }
        else if (state.gamePhase === PHASE.VOTE)   { triggerExecute();   return; }
    }

    // At HOME_WARN_TICKS left in the day, end all conversations and walk everyone home
    if (state.gamePhase === PHASE.DAY && state.cycleTimer === HOME_WARN_TICKS) {
        for (const p of living()) {
            if (p.talkingTo !== null) {
                const partner = state.people.find(q => q.id === p.talkingTo);
                if (partner) { partner.talkingTo = null; partner.message = null; partner.ticksLeft = 1; }
                p.talkingTo = null; p.message = null; p.ticksLeft = 1;
            }
            if (!p.indoors) {
                const h = state.houses[p.homeIndex];
                p.targetX = h.doorX - PERSON_SIZE / 2;
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
            const condemned = state.people.find(p => p.id === state.condemnedId);
            if (condemned) {
                const worldEl = document.getElementById('world');
                const cx = worldEl.clientWidth  / 2 - PERSON_SIZE / 2;
                const cy = worldEl.clientHeight / 2 - PERSON_SIZE / 2;
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
            p.activity !== 'sleeping' &&
            p.activity !== 'visiting' &&
            p.talkingTo === null
        ).map(p => p.id)
    );

    // Count current speakers in debate so we can cap simultaneous speech
    let debateSpeakerCount = 0;
    if (state.gamePhase === PHASE.DEBATE) {
        debateSpeakerCount = activePeople.filter(p => p.activity === 'debating' && !!p.message).length;
    }

    for (const person of activePeople) {
        person.ticksLeft--;

        const isSocial = ['talking','hosting','visiting','debating'].includes(person.activity);
        if (isSocial) {
            person.socialNeed = Math.min(SOCIAL_MAX, person.socialNeed + SOCIAL_GAIN);
        } else {
            person.socialNeed = Math.max(0, person.socialNeed - SOCIAL_DECAY);
        }

        // Thoughts are handled in gameLoop() on real-time schedules per person.
        // Speech cooldowns are also real-time; check Date.now() against nextSpeakAt.
        const now = Date.now();
        const canSpeak = now >= person.nextSpeakAt;

        // Day-phase speech: murderer bluff or normal chatter
        if (state.gamePhase === PHASE.DAY && person.id === state.murdererId && person.activity === 'talking') {
            if (canSpeak && Math.random() < 0.3) {
                person.message = pickBucketed(MURDERER_BLUFF, person.personality);
                person.nextSpeakAt = now + speakDelayMs(person.socialStat);
            }
        } else if ((person.activity === 'talking' || person.activity === 'hosting') && person.ticksLeft > 0) {
            if (canSpeak) {
                // If talking to someone they dislike, be guarded
                const partner = person.talkingTo !== null ? state.people.find(q => q.id === person.talkingTo) : null;
                if (partner && (person.relations[partner.id] ?? 0) < -40 && Math.random() < 0.4) {
                    person.message = pickBucketed(GUARDED_LINES, person.personality);
                } else {
                    person.message = pickMessage(person.personality);
                }
                person.nextSpeakAt = now + speakDelayMs(person.socialStat);
            }
        } else if (person.activity === 'debating' && person.ticksLeft > 0) {
            if (canSpeak && debateSpeakerCount < MAX_DEBATE_SPEAKERS) {
                const suspect = pickDebateSuspect(person);
                if (suspect) {
                    // Alternate between accusation and backing argument
                    if (Math.random() < 0.45) {
                        person.message = pickBucketed(DEBATE_ARGUMENT_LINES, person.personality).replace('{name}', suspect.name);
                    } else {
                        person.message = pickBucketed(ACCUSE_LINES, person.personality).replace('{name}', suspect.name);
                    }
                } else {
                    person.message = pickBucketed(DEFEND_LINES, person.personality);
                }

                // Persuasion: high-conviction persons try to convince liked neighbours
                if (person.conviction > CONVICTION_THRESHOLD && suspect) {
                    const listeners = living().filter(q =>
                        q.id !== person.id &&
                        (person.relations[q.id] ?? 0) > 10
                    );
                    if (listeners.length > 0) {
                        const listener = listeners[rnd(listeners.length)];
                        const liking = Math.max(0, listener.relations[person.id] ?? 0);
                        const influence = (liking / 100) * 22 + 5;
                        listener.suspicion[suspect.id] = Math.min(100,
                            (listener.suspicion[suspect.id] ?? 0) + influence);
                        listener.conviction = Math.min(100, Math.max(
                            listener.conviction, listener.suspicion[suspect.id]));
                        person.message = pickBucketed(PERSUADE_LINES, person.personality).replace('{name}', suspect.name);
                        person.history.push({ day: state.dayNumber, type: 'persuaded', target: listener.id, about: suspect.id, detail: `Tried to convince ${listener.name} that ${suspect.name} is guilty` });
                    }
                }

                // Stagger next debate utterance: wide variance prevents visual sync
                const debateMs = 3000 + Math.random() * 5000;
                person.nextSpeakAt = now + Math.round(debateMs / (person.socialStat * 0.12 + 0.88));
                debateSpeakerCount++;
            } else if (!canSpeak && person.nextSpeakAt - now < 800) {
                // Brief silence just before speaking again — natural gap
                person.message = null;
            }
        }

        if (person.ticksLeft > 0) continue;

        // End talking
        if (person.talkingTo !== null) {
            const partner = state.people.find(p => p.id === person.talkingTo);
            if (partner && partner.talkingTo === person.id) {
                driftRelations(person, partner);
                person.thought  = pickRelationThought(person.relations[partner.id] ?? 0);
                partner.thought = pickRelationThought(partner.relations[person.id] ?? 0);
                person.nextThoughtAt  = Date.now() + thoughtDelayMs(person.thoughtStat);
                partner.nextThoughtAt = Date.now() + thoughtDelayMs(partner.thoughtStat);
                // Record conversation in history
                const pFeels = person.relations[partner.id] ?? 0;
                const qFeels = partner.relations[person.id] ?? 0;
                const pSentiment = pFeels > 20 ? 'positive' : pFeels < -20 ? 'negative' : 'neutral';
                const qSentiment = qFeels > 20 ? 'positive' : qFeels < -20 ? 'negative' : 'neutral';
                person.history.push({ day: state.dayNumber, type: 'talked', with: partner.id, sentiment: pSentiment, detail: `Talked with ${partner.name} (felt ${pSentiment})` });
                partner.history.push({ day: state.dayNumber, type: 'talked', with: person.id, sentiment: qSentiment, detail: `Talked with ${person.name} (felt ${qSentiment})` });
                partner.talkingTo = null;
                partner.ticksLeft = 0;
                free.add(partner.id);
                // Opinion sharing: one person mentions a third during conversation
                _maybeShareOpinion(person, partner);
            }
            person.talkingTo = null;
            person.message   = null;
            free.add(person.id);
        }

        // End hosting — guests leave
        if (person.activity === 'hosting') {
            for (const guest of state.people) {
                if (guest.guestOfIndex === person.homeIndex) {
                    guest.guestOfIndex = null;
                    guest.indoors      = false;
                    guest.activity     = 'moving';
                    guest.ticksLeft    = rndTicks('moving');
                    const h = state.houses[person.homeIndex];
                    guest.x = h.doorX + rndF(16) - 8;
                    guest.y = h.doorY + rndF(16) - 8;
                    guest.targetX = guest.x + rndF(60) - 30;
                    guest.targetY = guest.y + rndF(60) - 30;
                    free.add(guest.id);
                }
            }
            person.indoors  = false;
            person.activity = 'moving';
            person.message  = null;
            person.ticksLeft = rndTicks('moving');
            const h = state.houses[person.homeIndex];
            person.x = h.doorX;
            person.y = h.doorY;
            free.add(person.id);
            updateHouseGuests();
            continue;
        }

        // End visiting
        if (person.activity === 'visiting') {
            person.guestOfIndex = null;
            person.indoors      = false;
            person.activity     = 'moving';
            person.message      = null;
            person.ticksLeft    = rndTicks('moving');
            free.add(person.id);
            updateHouseGuests();
            continue;
        }

        // End shopping — person arrives at store and buys fruit
        if (person.activity === 'shopping') {
            const boughtOranges = person.orangeLover ? buyFruit(person, 'orange') : 0;
            const boughtApples  = !person.orangeLover || boughtOranges === 0
                ? buyFruit(person, 'apple') : 0;
            if (boughtOranges > 0) {
                person.message = pickBucketed(ORANGE_BUY_LINES, person.personality);
                person.nextSpeakAt = Date.now() + 2000;
                // Nearby people observe the orange purchase
                for (const obs of living()) {
                    if (obs.id === person.id) continue;
                    if (dist(obs, person) <= OBSERVE_SHOP_RADIUS) {
                        obs.spendingObserved[person.id] =
                            (obs.spendingObserved[person.id] ?? 0) + boughtOranges;
                    }
                }
            } else if (boughtApples > 0) {
                person.message = pickBucketed(SHOP_LINES, person.personality);
                person.nextSpeakAt = Date.now() + 1500;
            }
            person.indoors  = false;
            person.activity = 'moving';
            person.ticksLeft = rndTicks('moving');
            free.add(person.id);
            continue;
        }

        // Debating — ends only when the phase timer fires
        if (person.activity === 'debating') continue;

        let next = weightedPick(socialWeights(person));

        if (next === 'talking') {
            const nearby = [...free]
                .filter(id => id !== person.id)
                .map(id => state.people.find(p => p.id === id))
                .filter(p => p && dist(person, p) <= TALK_DIST)
                .filter(p => (person.relations[p.id] ?? 0) > -60);

            if (nearby.length > 0) {
                const partner = nearby.reduce((best, cand) => {
                    const bScore = (person.relations[best.id] ?? 0) + rnd(40);
                    const cScore = (person.relations[cand.id] ?? 0) + rnd(40);
                    return cScore > bScore ? cand : best;
                });
                const dur = rndTicks('talking');
                person.activity  = 'talking'; person.talkingTo = partner.id; person.ticksLeft = dur;
                person.message   = pickMessage(person.personality);
                // Each person speaks on their own real-time schedule
                person.nextSpeakAt  = Date.now() + speakDelayMs(person.socialStat);
                partner.activity = 'talking'; partner.talkingTo = person.id; partner.ticksLeft = dur;
                partner.message  = pickMessage(partner.personality);
                // Partner's reply comes on their own independent delay (naturally later)
                partner.nextSpeakAt = Date.now() + speakDelayMs(partner.socialStat) + 800 + Math.round(Math.random() * 1200);
                free.delete(person.id);
                free.delete(partner.id);
                continue;
            }
            const anyFree = [...free].filter(id => id !== person.id).map(id => state.people.find(p => p.id === id)).filter(Boolean);
            if (anyFree.length > 0) {
                const target = anyFree
                    .filter(q => (person.relations[q.id] ?? 0) > -40)
                    .reduce((a, b) =>
                        (person.relations[a.id] ?? 0) >= (person.relations[b.id] ?? 0) ? a : b,
                        anyFree[0]
                    );
                person.targetX = target.x;
                person.targetY = target.y;
            }
            next = 'moving';
        }

        if (next === 'hosting') {
            const guest = [...free]
                .filter(id => id !== person.id)
                .map(id => state.people.find(p => p.id === id))
                .filter(Boolean)[0];

            if (guest) {
                person.activity   = 'hosting';
                person.indoors    = true;
                person.ticksLeft  = rndTicks('hosting');
                person.message    = pickInvite();
                person.nextSpeakAt = Date.now() + speakDelayMs(person.socialStat);
                const h = state.houses[person.homeIndex];
                person.targetX    = h.doorX;
                person.targetY    = h.doorY;
                guest.activity      = 'visiting';
                guest.guestOfIndex  = person.homeIndex;
                guest.ticksLeft     = person.ticksLeft;
                guest.targetX       = h.doorX;
                guest.targetY       = h.doorY;
                free.delete(person.id);
                free.delete(guest.id);
                updateHouseGuests();
                continue;
            }
            next = 'moving';
        }

        if (next === 'eating' || next === 'sleeping') {
            const h = state.houses[person.homeIndex];
            person.activity  = next;
            person.indoors   = true;
            person.ticksLeft = rndTicks(next);
            person.message   = null;
            person.targetX   = h.doorX;
            person.targetY   = h.doorY;
            free.delete(person.id);
            continue;
        }

        // Start shopping — walk to the fruit store
        if (next === 'shopping' && state.store.doorX) {
            person.activity  = 'shopping';
            person.indoors   = false;
            person.ticksLeft = rndTicks('shopping');
            person.message   = null;
            free.add(person.id);
            continue;
        }

        person.activity  = next;
        person.ticksLeft = rndTicks(next);
        person.message   = null;
        if (next === 'moving') {
            const { W, H } = stageBounds();
            person.targetX = rndF(W);
            person.targetY = rndF(H);
            person.indoors = false;
        }

        if (next === 'sleeping') free.delete(person.id);
        else free.add(person.id);
    }

    activePeople.forEach(renderPerson);
    updateStats();
}

// ── Animation loop ────────────────────────────────────────────
function gameLoop() {
    if (!state.paused) {
        const { W, H } = stageBounds();
        const cx = PERSON_SIZE / 2;

        for (const p of state.people) {
            if (state.deadIds.has(p.id)) continue;
            if (state.gamePhase === PHASE.NIGHT) continue;

            // ── Per-person thought updates (real-time, fully independent) ──────
            const nowMs = Date.now();
            if (nowMs >= p.nextThoughtAt) {
                p.thought = pickThought(p.personality);
                p.nextThoughtAt = nowMs + thoughtDelayMs(p.thoughtStat);
                // Sync thought bubble text immediately so it doesn't wait for next tick
                const tEl = state.thoughts.get(p.id);
                if (tEl && tEl.textContent !== p.thought) tEl.textContent = p.thought;
            }

            // During execute phase: only move the condemned
            if (state.gamePhase === PHASE.EXECUTE) {
                if (p.id !== state.condemnedId) continue;
                const worldEl = document.getElementById('world');
                const destX = (worldEl.clientWidth  / 2) - PERSON_SIZE / 2;
                const destY = (worldEl.clientHeight / 2) - PERSON_SIZE / 2;
                const dx = destX - p.x, dy = destY - p.y;
                const d  = Math.sqrt(dx*dx + dy*dy);
                if (d > 4) {
                    p.x = Math.max(0, Math.min(W, p.x + (dx/d) * p.speed * 1.5));
                    p.y = Math.max(0, Math.min(H, p.y + (dy/d) * p.speed * 1.5));
                }
                const el = document.getElementById(`person-${p.id}`);
                if (el) { el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; }
                const bubbleEl = state.bubbles.get(p.id);
                if (bubbleEl) {
                    bubbleEl.style.left = `${p.x + PERSON_SIZE / 2 - 20}px`;
                    bubbleEl.style.top  = `${p.y - 38}px`;
                }
                const thoughtEl = state.thoughts.get(p.id);
                if (thoughtEl) {
                    const th = thoughtEl.offsetHeight || 32;
                    thoughtEl.style.left = `${p.x + PERSON_SIZE / 2 + 10}px`;
                    thoughtEl.style.top  = `${Math.max(4, p.y - th - 28)}px`;
                }
                continue;
            }
            if (p.activity === 'sleeping') {
                if (!p.indoors) {
                    const h = state.houses[p.homeIndex];
                    p.x = h.doorX - PERSON_SIZE / 2;
                    p.y = h.doorY - PERSON_SIZE;
                    p.indoors = true;
                }
            } else if (p.activity === 'eating') {
                if (!p.indoors) {
                    const h   = state.houses[p.homeIndex];
                    const ddx = h.doorX - (p.x + cx);
                    const ddy = h.doorY - (p.y + cx);
                    const dd  = Math.sqrt(ddx*ddx + ddy*ddy);
                    if (dd > 5) {
                        p.x = Math.max(0, Math.min(W, p.x + (ddx/dd) * p.speed * 0.6));
                        p.y = Math.max(0, Math.min(H, p.y + (ddy/dd) * p.speed * 0.6));
                    } else {
                        p.x = h.doorX - PERSON_SIZE / 2;
                        p.y = h.doorY - PERSON_SIZE;
                        p.indoors = true;
                    }
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
                        p.x = h.doorX - PERSON_SIZE / 2;
                        p.y = h.doorY - PERSON_SIZE;
                        p.indoors = true;
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
                        p.x = h.x - PERSON_SIZE / 2;
                        p.y = h.y - PERSON_SIZE / 2;
                        p.indoors = true;
                    }
                }
            } else if (p.activity === 'debating') {
                const dx = p.targetX - p.x, dy = p.targetY - p.y;
                const d  = Math.sqrt(dx*dx + dy*dy);
                if (d > 4) {
                    p.x = Math.max(0, Math.min(W, p.x + (dx/d) * p.speed));
                    p.y = Math.max(0, Math.min(H, p.y + (dy/d) * p.speed));
                }
            } else if (p.activity === 'shopping') {
                const sx = state.store.doorX - p.x;
                const sy = state.store.doorY - p.y;
                const sd = Math.sqrt(sx*sx + sy*sy);
                if (sd > 10) {
                    p.x = Math.max(0, Math.min(W, p.x + (sx/sd) * p.speed * 1.1));
                    p.y = Math.max(0, Math.min(H, p.y + (sy/sd) * p.speed * 1.1));
                }
            } else if (p.activity === 'talking') {
                const partner = state.people.find(q => q.id === p.talkingTo);
                if (partner) {
                    const dx = (partner.x+cx)-(p.x+cx), dy = (partner.y+cx)-(p.y+cx);
                    const d  = Math.sqrt(dx*dx+dy*dy);
                    if (d > TALK_STOP) {
                        const s = p.speed * 0.5;
                        p.x = Math.max(0, Math.min(W, p.x+(dx/d)*s));
                        p.y = Math.max(0, Math.min(H, p.y+(dy/d)*s));
                    }
                }
            } else {
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

            const el = document.getElementById(`person-${p.id}`);
            if (el) {
                el.style.left = `${p.x}px`;
                el.style.top  = `${p.y}px`;
                el.classList.toggle('indoors', p.indoors);
                const fill = el.querySelector('.social-bar-fill');
                if (fill) {
                    fill.style.height = `${p.socialNeed}%`;
                    fill.style.backgroundColor = socialColor(p.socialNeed);
                }
            }

            const bubbleEl = state.bubbles.get(p.id);
            if (bubbleEl) {
                bubbleEl.style.left = `${p.x + PERSON_SIZE / 2 - 20}px`;
                bubbleEl.style.top  = `${p.y - 38}px`;
            }

            const thoughtEl = state.thoughts.get(p.id);
            if (thoughtEl) {
                const th = thoughtEl.offsetHeight || 32;
                thoughtEl.style.left = `${p.x + PERSON_SIZE / 2 + 10}px`;
                thoughtEl.style.top  = `${Math.max(4, p.y - th - 28)}px`;
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

function spawnPeople() {
    stopAll();
    state.people = []; state.nextId = 0;

    // Close the person panel if open
    const panel = document.getElementById('person-panel');
    if (panel) { panel.style.display = 'none'; panel.classList.remove('panel-open'); }

    const world = document.getElementById('world');
    world.querySelectorAll('.person').forEach(e => e.remove());
    world.querySelectorAll('.chat-bubble').forEach(e => e.remove());
    world.querySelectorAll('.thought-bubble').forEach(e => e.remove());
    world.querySelectorAll('.house-label').forEach(e => e.remove());
    world.querySelectorAll('.house-guests').forEach(e => e.remove());
    state.talkLines.forEach(l => l.remove()); state.talkLines.clear();
    state.bubbles.forEach(b => b.remove()); state.bubbles.clear();
    state.thoughts.forEach(t => t.remove()); state.thoughts.clear();

    // Rebuild cul-de-sac SVG
    const existing = document.getElementById('culdesac');
    if (existing) existing.remove();
    const layout = culdesacLayout();
    state.houses = layout.housePositions;
    state.store  = { x: layout.storeCX, y: layout.storeCY, doorX: layout.storeDoorX, doorY: layout.storeDoorY };
    world.insertAdjacentHTML('afterbegin', buildCuldesacSVG(layout));

    // House labels and guest badges
    for (let i = 0; i < PEOPLE_COUNT; i++) {
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

    for (let i = 0; i < PEOPLE_COUNT; i++) {
        const p  = createPerson(i, state.houses[i]);
        state.people.push(p);

        const lbl = document.getElementById(`house-label-${i}`);
        if (lbl) lbl.textContent = `${p.name}'s`;

        const el = document.createElement('div');
        el.id = `person-${p.id}`;
        el.className = `person activity-${p.activity}`;
        el.style.cssText = `left:${p.x}px;top:${p.y}px`;

        const nameEl = document.createElement('span');
        nameEl.className = 'name-above';
        nameEl.textContent = p.name;

        const badge = document.createElement('span');
        badge.className = 'personality-badge';
        badge.textContent = PERSONALITY_EMOJI[p.personality];

        el.insertAdjacentHTML('beforeend', buildFigureSVG(p));
        el.appendChild(badge);

        const socialBar  = document.createElement('div'); socialBar.className = 'social-bar';
        const socialFill = document.createElement('div'); socialFill.className = 'social-bar-fill';
        socialFill.style.height = `${p.socialNeed}%`;
        socialFill.style.backgroundColor = socialColor(p.socialNeed);
        socialBar.appendChild(socialFill);
        el.appendChild(socialBar);

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
    const pool      = state.people.slice().sort(() => Math.random() - 0.5);
    const preferred = pool.find(p => p.personality === 'extrovert' || p.personality === 'grumpy');
    const murderer  = preferred || pool[0];
    state.murdererId      = murderer.id;
    murderer.liar   = true;
    for (const q of state.people) {
        if (q.id === murderer.id) continue;
        murderer.perceivedRelations[q.id] = Math.abs(murderer.relations[q.id] ?? 0) * 0.5 + 20;
    }

    updateStats();
    updatePhaseLabel();
    startAll();
}

// ── Module entry point ────────────────────────────────────────
export function initSimulation() {
    initTooltip();

    document.getElementById('respawnBtn').addEventListener('click', spawnPeople);
    document.getElementById('goRestartBtn').addEventListener('click', spawnPeople);

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

    window.addEventListener('resize', () => {
        const existing = document.getElementById('culdesac');
        if (existing) {
            const layout = culdesacLayout();
            state.houses = layout.housePositions;
            state.store  = { x: layout.storeCX, y: layout.storeCY, doorX: layout.storeDoorX, doorY: layout.storeDoorY };
            existing.outerHTML = buildCuldesacSVG(layout);
        }
        const { W, H } = stageBounds();
        for (const p of state.people) {
            p.x = Math.min(p.x, W); p.y = Math.min(p.y, H);
            if (p.targetX > W) p.targetX = rndF(W);
            if (p.targetY > H) p.targetY = rndF(H);
        }
    });

    requestAnimationFrame(() => requestAnimationFrame(spawnPeople));
}
