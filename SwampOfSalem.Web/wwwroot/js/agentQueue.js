/**
 * @fileoverview agentQueue.js — AI request orchestration and memory buffering.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * OVERVIEW FOR JUNIOR DEVELOPERS
 * ═══════════════════════════════════════════════════════════════════════
 *
 * This module is the "traffic controller" between the simulation and the
 * AI backend. It has three main responsibilities:
 *
 * 1. CONVERSATION SLOT COUNTER (concurrency limit)
 *    Up to MAX_CONCURRENT_CONVERSATIONS AI conversations may run at the same time.
 *    `_activeConversations` tracks the current count. Once it reaches the limit,
 *    no new conversations can start until one completes. This allows livelier
 *    multi-pair chatter while still preventing an unbounded number of simultaneous
 *    AI calls.
 *
 * 2. MEMORY BUFFER (batching for performance)
 *    Every time something notable happens (a conversation ends, a murder
 *    occurs, a vote is cast), recordMemory() is called. INSTEAD of sending
 *    one HTTP request per event (which would be hundreds of requests per
 *    game), memories are stored in `_memoryBuffer` (a Map of arrays keyed
 *    by alligator ID). They are only flushed to the server in a single
 *    batch request RIGHT BEFORE the next conversation starts. This keeps
 *    network traffic low and ensures the AI always has fresh context before
 *    it generates dialogue.
 *
 * 3. CONVERSATION PLAYBACK (turn-by-turn drain)
 *    The AI returns ALL turns at once as a JSON array. Rather than showing
 *    them all instantly, `_drainNextConvTurn()` shows them one at a time
 *    with a 2.2–4 second delay between lines. This simulates a real-time
 *    conversation. After the last turn, there is a 3-second final hold
 *    before the `onComplete` callback fires and both gators are freed.
 *
 * FLOW DIAGRAM:
 *
   simulation.js calls requestFullConversation(a, b, ...)
 *       │
 *       ├─ Check _activeConversations >= MAX_CONCURRENT_CONVERSATIONS → if true, return early
 *       ├─ Increment _activeConversations
 *       ├─ Flush pending memories to server (batch HTTP POST)
 *       ├─ Call agentBridge.getFullConversation(...)  ← single AI HTTP call
 *       │       ↓ (async — waiting for AI)
 *       ├─ Resume simulation
 *       ├─ Load turns onto initiator._convTurns[]
 *       ├─ Call _drainNextConvTurn() → show turn 1 → setTimeout → show turn 2 → ...
 *       └─ After last turn: 3s hold → onComplete() → _activeConversations--
 *
 * @module agentQueue
 */
// ── Agent Queue ───────────────────────────────────────────────
// AI is used ONLY for full 2-gator conversations.
// requestFullConversation() sets isWaiting on both gators (showing thinking
// bubbles) while the AI call is in-flight, then plays back turns automatically.

import { isAgentAvailable, getAgentDialog, getFullConversation, addAgentMemory, getNightReport, flushMemories } from './agentBridge.js';
import { state } from './state.js';
import { living } from './gator.js';
import { logChat } from './simulation.js';
import { TICK_MS, MAX_CONCURRENT_CONVERSATIONS } from './gameConfig.js';

// _pending: Map of conversation keys → in-flight Promise.
// Prevents the same pair from sending two concurrent requests.
// Key format: "min(idA,idB):max(idA,idB):fullconv"
const _pending = new Map();

// _activeConversations: count of AI conversations currently in-flight or draining.
// A new conversation can start as long as this is below MAX_CONCURRENT_CONVERSATIONS.
let _activeConversations = 0;

// _tickFunction: reference to simulation.js's tick() so agentQueue can
// restart the tick interval after resuming without creating a circular import.
// Set via setTickFunction() which simulation.js calls at init.
let _tickFunction = null;

/**
 * Stores a reference to the simulation tick function.
 * Called once from simulation.js initSimulation() to break the circular
 * import dependency (agentQueue imports simulation, simulation imports agentQueue).
 * @param {Function} tickFn - The simulation tick() function.
 */
export function setTickFunction(tickFn) {
    _tickFunction = tickFn;
}

// ── Local memory buffer ───────────────────────────────────────
// Memories are stored here and only flushed to the server when a conversation starts.
// Key: alligatorId (number), Value: array of {day, type, detail, relatedId} entries.
const _memoryBuffer = new Map();

/**
 * Adds one memory entry to the local buffer for a specific alligator.
 * Does NOT touch the network — this is purely local storage.
 * @param {number} alligatorId
 * @param {number} day
 * @param {string} type  - E.g. 'conversation', 'murder', 'voted', 'overheard'.
 * @param {string} detail - Human-readable description of the event.
 * @param {number|null} relatedId - ID of a related alligator (victim, suspect, etc.).
 */
function _bufferMemory(alligatorId, day, type, detail, relatedId) {
    if (!_memoryBuffer.has(alligatorId)) _memoryBuffer.set(alligatorId, []);
    _memoryBuffer.get(alligatorId).push({ day, type, detail, relatedId: relatedId ?? null });
}

/**
 * Sends all buffered memories for one alligator to the server in a single
 * batch HTTP POST, then clears the buffer.
 *
 * WHY flush before a conversation?
 *   The AI agent uses its ChatHistory (which is stored server-side) to
 *   contextualise its responses. If we flush memories right before a
 *   conversation, the AI has the freshest possible context — it knows
 *   about recent murders, votes, overheard gossip, etc. before it speaks.
 *
 * @param {number} alligatorId
 * @returns {Promise<void>}
 */
async function _flushMemoriesForGator(alligatorId) {
    const entries = _memoryBuffer.get(alligatorId);
    if (!entries || entries.length === 0) return;
    // Clear BEFORE sending — if the request fails, we won't retry,
    // but we also won't send the same memories twice on the next flush.
    _memoryBuffer.delete(alligatorId);
    await flushMemories(alligatorId, entries);
}

/**
 * No-op stub — AI dialog is not used outside of full conversations.
 * Callers that still reference this function are silently skipped.
 *
 * HISTORY NOTE: In early development, individual "requestDialog" calls were
 * made for each gator independently. This was replaced by the batched
 * requestFullConversation() approach which makes one AI call per conversation
 * and returns all turns at once. This stub exists so callers that haven't
 * been updated yet don't crash.
 */
export function requestDialog() { /* intentionally empty */ }

/**
 * Request a full AI-generated conversation between two gators.
 * Both gators show a thinking bubble while the AI call is in-flight.
 * Turns begin playing back automatically as soon as the response arrives.
 *
 * @param {object} initiator   - Person object for the gator who opened the chat
 * @param {object} responder   - Person object for the other gator
 * @param {string} openingLine - The first line already displayed by the initiator
 * @param {number} maxTurns    - Max turns (1–9)
 * @param {string|null} context
 * @param {boolean} isPrivate  - If true, conversation is private (hosting); no overhearing
 * @param {function|null} onComplete - Called after last turn displayed + 3s hold
 */
export async function requestFullConversation(initiator, responder, openingLine, maxTurns = 6, context = null, isPrivate = false, onComplete = null) {
    if (!isAgentAvailable()) return;
    if (_activeConversations >= MAX_CONCURRENT_CONVERSATIONS) return;

    const key = `${Math.min(initiator.id, responder.id)}:${Math.max(initiator.id, responder.id)}:fullconv`;
    if (_pending.has(key)) return;

    // Don't start a new AI call while turns are still playing back for this pair
    if (initiator._convTurns && initiator._convTurnIndex < initiator._convTurns.length) return;
    if (responder._convTurns && responder._convTurnIndex < responder._convTurns.length) return;

    _activeConversations++;


    // Show thinking bubbles on both gators while waiting
    initiator.isWaiting = true;
    responder.isWaiting = true;

    // Flush buffered memories for both gators to the server before asking the AI
    await Promise.all([
        _flushMemoriesForGator(initiator.id),
        _flushMemoriesForGator(responder.id),
    ]);

    const promise = getFullConversation(initiator.id, responder.id, openingLine, maxTurns, context)
        .then(async turns => {
            initiator.isWaiting = false;
            responder.isWaiting = false;

            console.log(`[Conversation] Received ${turns?.length ?? 0} turns from AI`);

            if (!turns || turns.length <= 1) {
                // A single message (greeting) is not a conversation — ignore it
                console.warn(`⏭ Rejecting conversation with ${turns?.length ?? 0} message(s) — need at least 2 messages`);
                console.warn(`   This likely means the AI returned malformed data or the server had an error.`);
                console.warn(`   Check the server logs for "[ParseConversation]" messages to diagnose.`);
                _activeConversations--;
                state.activeConversation = false;
                initiator.activity = 'moving'; initiator.talkingTo = null; initiator.message = null;
                responder.activity = 'moving'; responder.talkingTo = null; responder.message = null;
                return;
            }

            // Log all AI output to console
            const label = isPrivate ? '🏠 [Private AI conv]' : '💬 [AI conv]';
            console.log(`${label} ${initiator.name} & ${responder.name} (${turns.length} turns):`);
            turns.forEach((t, i) => {
                const speaker = t.speakerGatorId === initiator.id ? initiator : responder;
                console.log(`  [${i + 1}] ${speaker.name}: ${t.speech ?? ''}${t.thought ? ` (💭 ${t.thought})` : ''}`);
            });

            // Start playing back turns immediately
            initiator._convTurns      = turns;
            initiator._convPartner    = responder;
            initiator._convTurnIndex  = 0;
            initiator._convIsPrivate  = isPrivate;
            initiator._convOnComplete = onComplete;
            _drainNextConvTurn(initiator, responder);
        })
        .catch(async err => {
            console.error('requestFullConversation failed:', err);
            initiator.isWaiting = false;
            responder.isWaiting = false;
            _activeConversations--;
            state.activeConversation = false;
            initiator.activity = 'moving'; initiator.talkingTo = null; initiator.message = null;
            responder.activity = 'moving'; responder.talkingTo = null; responder.message = null;
        });

    _pending.set(key, promise);
    promise.finally(() => _pending.delete(key));
}

/**
 * Advance to the next queued conversation turn for a gator pair.
 * @param {object} initiator
 * @param {object} responder
 */
export function drainNextConvTurn(initiator, responder) {
    _drainNextConvTurn(initiator, responder);
}

function _drainNextConvTurn(initiator, responder) {
    // Grab the queued turns array. Returns early if there are no more turns to display.
    const turns = initiator._convTurns;
    if (!turns || initiator._convTurnIndex >= turns.length) return;

    // Advance the cursor and get the current turn object.
    const turn = turns[initiator._convTurnIndex++];
    const isPrivate = !!initiator._convIsPrivate;

    // Determine who is speaking vs. who is listening this turn.
    const speaker  = turn.speakerGatorId === initiator.id ? initiator : responder;
    const listener = turn.speakerGatorId === initiator.id ? responder : initiator;

    // Update the speaker's visible speech bubble and log the chat.
    if (turn.speech && turn.speech.length > 0) {
        speaker.message = turn.speech;
        // logChat broadcasts the message to nearby observers and updates chatLogs.
        // isPrivate=true means no overhearing (hosting conversations are private).
        logChat(speaker, listener.id, turn.speech, turn.thought ?? null, isPrivate);
    }

    // Update the speaker's thought bubble (visible only in the info panel).
    if (turn.thought) {
        speaker.thought = turn.thought;
    }

    if (initiator._convTurnIndex < turns.length) {
        // Schedule the next turn with a 2.2–4 second human-feeling delay.
        const ms = 2200 + Math.random() * 1800;
        setTimeout(() => _drainNextConvTurn(initiator, responder), ms);
    } else {
        // ── All turns displayed ─────────────────────────────────────────────
        // Hold the gators in place for 3 more seconds so players can read
        // the last line before the speech bubbles disappear.
        const onComplete = initiator._convOnComplete ?? null;
        initiator._convHolding = true;   // Keep simulation.js from moving these gators.
        responder._convHolding = true;
        setTimeout(() => {
            // Update recentTalkWith timestamps to enforce the 60-second cooldown.
            const now = Date.now();
            if (!initiator.recentTalkWith) initiator.recentTalkWith = {};
            if (!responder.recentTalkWith) responder.recentTalkWith = {};
            initiator.recentTalkWith[responder.id] = now;
            responder.recentTalkWith[initiator.id] = now;

            // Clean up all playback state.
            initiator._convTurns      = null;
            initiator._convPartner    = null;
            initiator._convTurnIndex  = 0;
            initiator._convIsPrivate  = false;
            initiator._convOnComplete = null;
            initiator._convHolding    = false;
            responder._convHolding    = false;

            // Release a conversation slot so new conversations can start.
            _activeConversations--;

            // Fire the completion callback (e.g. _onConversationCompleted in simulation.js).
            if (onComplete) onComplete();
        }, 3000);
    }
}

/**
 * Record a memory/event for an agent — stored locally and flushed when a conversation starts.
 *
 * This is a very frequently called function. It is intentionally synchronous
 * and cheap (just a Map.push). The expensive network flush happens lazily in
 * requestFullConversation() → _flushMemoriesForGator().
 *
 * @param {number} alligatorId - Which gator this memory belongs to.
 * @param {number} day         - The current game day number.
 * @param {string} type        - Short category tag (e.g. 'murder', 'voted', 'overheard').
 * @param {string} detail      - Full human-readable description sent to the AI.
 * @param {number|null} relatedId - Another gator's ID relevant to this event, or null.
 */
export function recordMemory(alligatorId, day, type, detail, relatedId = null) {
    _bufferMemory(alligatorId, day, type, detail, relatedId);
}

/**
 * Request agent-driven vote — no longer AI-driven; always returns null so the
 * caller falls back to its local JS logic.
 *
 * HISTORY NOTE: Early versions called POST /api/agent/vote here. Voting was
 * moved to a pure JS fallback (decideVote() in phases.js) because the AI
 * was too slow for the sequential voting ceremony — one HTTP round trip per
 * voter made the vote phase take many seconds.
 */
export async function requestVote() {
    return null;
}

// ── Night Report ─────────────────────────────────────────────

/**
 * Fetch the night AI report for all living gators, show the night screen
 * panel, and resolve only after the user clicks "Continue to Morning."
 *
 * PURPOSE:
 *   After the murderer strikes, all living gators reflect on the day:
 *   who they suspect, why, and what their inner thought is. The night-report
 *   panel displays these reflections as a clickable list so the player can
 *   read each gator's private perspective.
 *
 * FLOW:
 *   1. Show the night-report overlay with a "loading…" message.
 *   2. Flush all buffered memories for every living gator (so the AI
 *      has current context for its reflections).
 *   3. Call agentBridge.getNightReport(aliveIds) → batch AI call.
 *   4. Render the gator list + clickable detail panels.
 *   5. Wait for the user to click "Continue to Morning."
 *   6. Hide the overlay and resolve the Promise (caller: triggerNightfall).
 *
 * @returns {Promise<void>} Resolves when the user dismisses the night screen.
 */
export function requestNightReport() {
    return new Promise(async resolve => {
        const panel = document.getElementById('night-report-overlay');
        if (!panel) { resolve(); return; }

        // Show the panel in loading state
        panel.style.display = 'flex';
        document.getElementById('nr-gator-list').innerHTML =
            '<div class="nr-loading">🤖 Asking the AI what each gator is thinking…</div>';
        document.getElementById('nr-detail').style.display = 'none';

        let entries = [];

        if (isAgentAvailable()) {
            try {
                const aliveIds = living().map(p => p.id);
                // Flush all buffered memories before the night report
                await Promise.all(aliveIds.map(id => _flushMemoriesForGator(id)));
                entries = await getNightReport(aliveIds);
            } catch (e) {
                console.warn('Night report AI call failed, using fallback:', e);
            }
        }

        // Render the gator list
        _renderNightGatorList(entries);

        // Wire up the continue button — resolves this promise
        const btn = document.getElementById('nr-continue-btn');
        function onContinue() {
            btn.removeEventListener('click', onContinue);
            panel.style.display = 'none';
            document.getElementById('nr-detail').style.display = 'none';
            resolve();
        }
        btn.addEventListener('click', onContinue);
    });
}

function _renderNightGatorList(entries) {
    const listEl = document.getElementById('nr-gator-list');
    const alive  = living();

    if (alive.length === 0) {
        listEl.innerHTML = '<div class="nr-loading">No gators remain.</div>';
        return;
    }

    listEl.innerHTML = alive.map(p => {
        const entry = entries.find(e => e.alligatorId === p.id);
        const isMurderer = p.id === state.murdererId;
        const murdererClass = isMurderer ? ' nr-murderer' : '';
        const murdererBadge = isMurderer ? `<span class="nr-murderer-badge">☠ Murderer</span>` : '';
        let statusHtml;
        if (isMurderer) {
            const targetName = p.plannedKillTarget?.name ?? state.gators.find(q => q.id === state.nightVictimId)?.name ?? '—';
            statusHtml = `<span class="nr-gator-suspect nr-kill-target">target: <strong>${targetName}</strong></span>`;
        } else {
            const suspectName = entry?.topSuspectName ?? '—';
            statusHtml = `<span class="nr-gator-suspect">suspects <strong>${suspectName}</strong></span>`;
        }
        return `<div class="nr-gator-row${murdererClass}" data-id="${p.id}">
            <span class="nr-gator-name">${p.name}${murdererBadge}</span>
            ${statusHtml}
        </div>`;
    }).join('');

    // Wire click → detail panel
    listEl.querySelectorAll('.nr-gator-row').forEach(row => {
        row.addEventListener('click', () => {
            const id     = parseInt(row.dataset.id);
            const g = state.gators.find(p => p.id === id);
            const entry  = entries.find(e => e.alligatorId === id);
            if (g) _showNightGatorDetail(g, entry);
            listEl.querySelectorAll('.nr-gator-row').forEach(r => r.classList.remove('nr-selected'));
            row.classList.add('nr-selected');
        });
    });
}

function _showNightGatorDetail(g, entry) {
    const detail = document.getElementById('nr-detail');
    detail.style.display = 'flex';

    // ── Stats
    const statBar = v => {
        const filled = Math.round(Math.max(0, Math.min(10, v / 10)));
        return Array.from({length:10}, (_,i) =>
            `<span class="stat-pip${i < filled ? ' filled' : ''}"></span>`).join('');
    };

    // ── Relations
    const alive = living();
    const relRows = alive
        .filter(q => q.id !== g.id)
        .sort((a, b) => (g.relations[b.id] ?? 0) - (g.relations[a.id] ?? 0))
        .map(q => {
            const v   = Math.round(g.relations[q.id] ?? 0);
            const cls = v > 10 ? 'rel-pos' : v < -10 ? 'rel-neg' : 'rel-neu';
            const suspVal = Math.round(g.suspicion[q.id] ?? 0);
            return `<div class="rel-row ${cls}">
                <span class="rel-name">${q.name}</span>
                <span class="rel-val">${v > 0 ? '+' : ''}${v}</span>
                ${suspVal > 10 ? `<span class="rel-susp">⚠ suspects ${suspVal}%</span>` : ''}
            </div>`;
        }).join('');

    // ── Conversations (chatLog) — include thoughts
    const convHtml = (g.chatLog || []).slice().reverse().map(entry => {
        const fromName = state.gators.find(p => p.id === entry.from)?.name ?? '?';
        const toName   = state.gators.find(p => p.id === entry.to  )?.name ?? '?';
        const isSelf   = entry.from === g.id;
        const cls      = isSelf ? 'chat-entry-self' : 'chat-entry-other';
        const speakerCls = isSelf ? 'chat-entry-self' : 'chat-entry-other';
        const label    = isSelf ? `You → ${toName}` : `${fromName} → You`;
        const dayLabel = entry.day != null ? `Day ${entry.day}` : '';
        let html = `<div class="chat-entry ${cls}">
            <span class="chat-speaker">${label}<span class="chat-time">${dayLabel}</span></span>
            ${entry.message ?? ''}
        </div>`;
        if (entry.thought) {
            html += `<div class="chat-entry chat-entry-thought">
                <span class="chat-speaker">💭 ${fromName} thought</span>
                ${entry.thought}
            </div>`;
        }
        return html;
    }).join('') || '<div class="nr-none">No conversations yet.</div>';

    // ── Night AI suspect report
    let reportHtml = '';
    const isMurdererDetail = g.id === state.murdererId;
    if (isMurdererDetail) {
        const targetName = g.plannedKillTarget?.name ?? state.gators.find(q => q.id === state.nightVictimId)?.name ?? '—';
        const killReason = g.plannedKillReason ?? '';
        reportHtml = `<div class="nr-report-block nr-kill-block">
            <div class="nr-report-label">🗡 Kill Decision</div>
            <div class="nr-report-suspect">Target tonight: <strong>${targetName}</strong></div>
            ${killReason ? `<div class="nr-report-reason">${killReason}</div>` : ''}
            ${entry?.innerThought ? `<div class="nr-report-thought">💭 "${entry.innerThought}"</div>` : ''}
        </div>`;
    } else if (entry) {
        reportHtml = `<div class="nr-report-block">
            <div class="nr-report-label">🌙 Night Reflection</div>
            ${entry.topSuspectName
                ? `<div class="nr-report-suspect">Suspects: <strong>${entry.topSuspectName}</strong></div>`
                : ''}
            ${entry.suspicionReason
                ? `<div class="nr-report-reason">${entry.suspicionReason}</div>`
                : ''}
            ${entry.innerThought
                ? `<div class="nr-report-thought">💭 "${entry.innerThought}"</div>`
                : ''}
        </div>`;
    }

    detail.innerHTML = `
        <div class="nr-detail-header">
            <span class="nr-detail-name">${g.name}${g.id === state.murdererId ? `<span class="nr-murderer-badge">☠ Murderer</span>` : ''}</span>
            <span class="nr-detail-meta">${g.personality}</span>
        </div>
        <div class="nr-detail-stats">
            <div class="panel-stat-row"><span>Suspicion</span><span class="stat-bar">${statBar(g.thoughtStat * 10)}</span></div>
        </div>
        ${reportHtml}
        <div class="panel-divider"></div>
        <div class="panel-section-title">Relations <span class="panel-count">${alive.length - 1}</span></div>
        <div class="panel-relations">${relRows}</div>
        <div class="panel-divider"></div>
        <div class="panel-section-title">Conversations</div>
        <div class="nr-conv-list">${convHtml}</div>`;
}

// ── Debate speech request ─────────────────────────────────────

/**
 * Generates a scripted debate speech for a gator.
 * Always uses JS phrase banks — no AI call for debates (too slow for rapid-fire exchange).
 *
 * @param {object}      speaker   - Person making the speech.
 * @param {object|null} suspect   - Who they are accusing, or null.
 * @param {object|null} victim    - Last night's murder victim, or null.
 * @param {boolean}     isDefense - True when this is a forced defense response.
 * @param {object|null} accuser   - Who accused the speaker (for defense mode).
 * @returns {Promise<string>} The spoken debate line.
 */
export function requestDebateSpeech(speaker, suspect, victim, isDefense = false, accuser = null) {
    return Promise.resolve(_buildDebateLine(speaker, suspect, victim, isDefense, accuser));
}

// ── Debate phrase banks ───────────────────────────────────────

const _ACCUSE_DIRECT = [
    (s, v) => `I've been watching ${s.name} closely and something is deeply wrong. They're the murderer — I'd bet my life on it.`,
    (s, v) => `Think about it — who was acting strange before ${v?.name ?? 'the victim'} turned up dead? ${s.name}. It's always been ${s.name}.`,
    (s, v) => `${s.name} had every reason to want ${v?.name ?? 'someone'} gone. Open your eyes, everyone!`,
    (s, v) => `I didn't want to say it, but I can't stay quiet. ${s.name} is the one doing this.`,
    (s, v) => `The evidence keeps pointing back to ${s.name}. We need to vote them out before anyone else dies.`,
    (s, v) => `${s.name} barely reacted when ${v?.name ?? 'the victim'} was found. That kind of calm is suspicious.`,
    (s, v) => `I heard ${s.name} say something strange the other day — I didn't think much of it then, but now? They're guilty.`,
    (s, v) => `Every time I look at ${s.name}, I feel like they know more than they're letting on. They're the killer.`,
    (s, v) => `If we let ${s.name} walk free and someone else dies tonight, that blood is on our hands. Vote them out!`,
    (s, v) => `${s.name} was the last one I saw near ${v?.name ?? 'the victim'}. Draw your own conclusions.`,
    (s, v) => `I've watched enough to know a guilty face — ${s.name} has one.`,
    (s, v) => `${s.name} keeps deflecting blame onto others. Classic murderer behavior. I'm not fooled.`,
    (s, v) => `We've all been too polite to say it out loud. But I'll say it: ${s.name} is the murderer.`,
    (s, v) => `I can't prove it yet, but my gut has never been wrong. ${s.name} did this.`,
    (s, v) => `${s.name}'s story doesn't add up. Too many convenient explanations. They're lying to us.`,
    (s, v) => `Why is ${s.name} so calm right now? Someone innocent would be terrified. They're not.`,
    (s, v) => `I lay awake last night putting the pieces together. It all leads to ${s.name}.`,
    (s, v) => `${s.name} tried to throw suspicion elsewhere earlier. That's exactly what a guilty person does.`,
    (s, v) => `We're running out of time. I'm calling it — ${s.name} is the murderer. Vote with me.`,
    (s, v) => `Something about ${s.name} has always felt off. After ${v?.name ?? 'what happened'}, I'm sure of it now.`,
    (s, v) => `${s.name} was way too quick to accuse someone else. Guilty people love pointing fingers.`,
    (s, v) => `I saw ${s.name} whispering privately before the murder. Secret conversations lead to dead gators.`,
    (s, v) => `${s.name} has been acting like they already know what happened. They do — because they did it.`,
    (s, v) => `Look at how ${s.name} reacted to every piece of news today. That's not grief — that's performance.`,
    (s, v) => `${s.name} is smart enough to blend in, but not smart enough to fool all of us. I see you, ${s.name}.`,
];

const _ACCUSE_CLIQUE = [
    (s, members) => `I don't trust ${s.name} — and honestly I don't trust anyone they've been hanging around with. That whole group — ${members} — looks out for each other too much.`,
    (s, members) => `${s.name} didn't act alone. Look at who they spend all their time with. ${members} — they're all in on it or covering it up.`,
    (s, members) => `It's not just ${s.name}. That little circle of ${members} has been awfully cozy lately. Suspicious timing.`,
    (s, members) => `${s.name} is the one I'm pointing at, but their crew — ${members} — haven't exactly been helpful either.`,
    (s, members) => `You know what bothers me? ${s.name} always has backup. ${members} follow them around like they've got something to protect.`,
    (s, members) => `${s.name} keeps company with ${members}. Murderers don't operate in a vacuum — watch them all.`,
    (s, members) => `I'm pointing at ${s.name}, but their clique — ${members} — should all be watched carefully.`,
    (s, members) => `${members} and ${s.name} have been inseparable. That kind of loyalty makes me nervous right now.`,
    (s, members) => `Ever notice how ${s.name} always ends up near ${members}? Something is going on in that group.`,
    (s, members) => `${s.name} has allies — ${members}. They'll vote to protect each other. Don't let them.`,
    (s, members) => `That whole faction — ${s.name}, ${members} — acts like they know something the rest of us don't.`,
    (s, members) => `I wouldn't put it past ${s.name} to use ${members} as cover. They're too tight-knit to be innocent.`,
    (s, members) => `${s.name} and ${members} have been whispering together since before the murder. I don't like it.`,
    (s, members) => `You protect ${s.name}, you protect every secret that group has been keeping. ${members} — all of you.`,
];

const _DEFEND_DIRECT = [
    (acc) => `${acc?.name ?? 'You'} are wrong about me. I had nothing to do with any of this and I resent the accusation.`,
    (acc) => `${acc?.name ?? 'Someone'} is pointing fingers at me because they're scared. I'm innocent.`,
    (acc) => `I've done nothing wrong! ${acc?.name ?? 'This accusation'} is misdirection — look at who's REALLY acting guilty.`,
    (acc) => `You want to talk suspicious? ${acc?.name ?? 'My accuser'} was the one acting strange. Not me.`,
    (acc) => `I won't stand here and be accused without fighting back. I'm innocent and everyone here knows it.`,
    (acc) => `${acc?.name ?? 'Whoever'} just accused me is either wrong or deliberately trying to frame me. Think about that.`,
    (acc) => `If I were the murderer, do you think I'd be standing here defending myself this openly? This is ridiculous.`,
    (acc) => `${acc?.name ?? 'My accuser'} has no evidence. They're guessing — and the wrong guess gets an innocent gator killed.`,
    (acc) => `I've been nothing but honest with all of you. This accusation is a gift to whoever the real killer is.`,
    (acc) => `Why would I kill anyone? ${acc?.name ?? 'Think about the logic'} — there's no motive, no proof, nothing.`,
    (acc) => `I understand the fear, but channeling it at me is a mistake. The real murderer is watching us point at the wrong gator.`,
    (acc) => `${acc?.name ?? 'This accusation'} is exactly what the murderer wants — us fighting each other instead of finding the truth.`,
    (acc) => `I dare ${acc?.name ?? 'my accuser'} to name ONE piece of real evidence. Because there isn't any.`,
    (acc) => `Check your suspicion levels, everyone. I'm being accused because ${acc?.name ?? 'someone'} needs a scapegoat.`,
    (acc) => `I may not be liked by everyone here, but that doesn't make me a killer. I'm innocent.`,
    (acc) => `${acc?.name ?? 'Whoever'} just accused me should look in the mirror first.`,
    (acc) => `You're burning an innocent gator if you vote for me. Is that really a risk you're willing to take?`,
    (acc) => `I have nothing to hide. Ask anyone — I did nothing.`,
    (acc) => `${acc?.name ?? 'Someone'} wants you looking at me so you don't look at them. Classic deflection.`,
    (acc) => `I've mourned every death in this swamp. The murderer doesn't feel that. I do.`,
    (acc) => `Vote for me if you want, but when another gator turns up dead tomorrow you'll know you made a mistake.`,
    (acc) => `${acc?.name ?? 'That accusation'} is built on nothing but paranoia. I won't let fear decide this vote.`,
    (acc) => `Everyone here should be asking why ${acc?.name ?? 'my accuser'} is so eager to put the spotlight on me.`,
    (acc) => `I didn't sleep last night — not because I'm guilty, but because I'm terrified of the real killer. That's the truth.`,
    (acc) => `${acc?.name ?? 'My accuser'} is smart — they know if they get you focused on me, you'll stop looking elsewhere.`,
];

const _DEFEND_CLIQUE = [
    (acc, members) => `Now you're blaming my whole group? ${members} are my friends, not conspirators. Leave them out of this.`,
    (acc, members) => `My friendship with ${members} has nothing to do with a murder. Don't drag them into this witch hunt.`,
    (acc, members) => `So now having close friends is suspicious? ${members} and I just get along. That's not a crime.`,
    (acc, members) => `${acc?.name ?? 'Someone'} is trying to isolate me from ${members} so I have no one to defend me. Not happening.`,
    (acc, members) => `Leave ${members} out of this. If you have a problem, bring it to me directly.`,
    (acc, members) => `Attacking my whole circle? ${members} are innocent. This is nothing but a smear campaign.`,
    (acc, members) => `We spend time together because we trust each other — not because we're hiding something. ${members} are good gators.`,
];

const _UNCERTAIN = [
    (v) => `I don't have a clear suspect yet. But someone in this swamp knows what happened to ${v?.name ?? 'our neighbor'} and they'd better start talking.`,
    (v) => `I keep going back and forth — everyone seems guilty and no one does. I need more time to think.`,
    (v) => `I'm not ready to name a name. Whoever I accuse, I want to be sure. A wrong accusation costs someone their life.`,
    (v) => `Honestly? I don't know. But I'm watching everyone very carefully.`,
    (v) => `The murderer is clever. They haven't slipped up yet — or they have and I've missed it. I'm still piecing it together.`,
    (v) => `Everyone here has a reason to be suspicious. I just need one more piece of evidence.`,
    (v) => `I've been listening to everything said in this debate, and I'm still not sure. The killer is good at hiding.`,
    (v) => `No accusation from me yet. But if someone acts out of character in the next few minutes — I'll remember it.`,
    (v) => `I feel like the answer is right in front of us and we keep looking past it.`,
    (v) => `${v?.name ?? 'Our neighbor'} deserves justice. I just don't want to give that justice to the wrong gator.`,
    (v) => `I have my suspicions, but I'm not certain enough to destroy someone's life over a hunch.`,
    (v) => `Every face I look at, I wonder. That's what a murderer does to a community — makes you doubt everyone.`,
];

export function buildDebateLine(speaker, suspect, victim, isDefense, accuser) {
    return _buildDebateLine(speaker, suspect, victim, isDefense, accuser);
}

function _buildDebateLine(speaker, suspect, victim, isDefense, accuser) {
    if (isDefense) {
        const speakerClique = (state.cliques ?? []).find(c => c.memberIds?.includes(speaker.id));
        const cliqueFriends = speakerClique
            ? speakerClique.memberIds.filter(id => id !== speaker.id && !state.deadIds.has(id))
            : [];
        if (cliqueFriends.length > 0 && Math.random() < 0.35) {
            const members = cliqueFriends.map(id => state.gators.find(p => p.id === id)?.name ?? '?').join(', ');
            const pool = _DEFEND_CLIQUE;
            return pool[Math.floor(Math.random() * pool.length)](accuser, members);
        }
        const pool = _DEFEND_DIRECT;
        return pool[Math.floor(Math.random() * pool.length)](accuser);
    }

    if (!suspect) {
        const pool = _UNCERTAIN;
        return pool[Math.floor(Math.random() * pool.length)](victim);
    }

    const suspectClique = (state.cliques ?? []).find(c => c.memberIds?.includes(suspect.id));
    const cliquePeers = suspectClique
        ? suspectClique.memberIds.filter(id => id !== suspect.id && !state.deadIds.has(id))
        : [];
    if (cliquePeers.length > 0 && Math.random() < 0.30) {
        const members = cliquePeers.map(id => state.gators.find(p => p.id === id)?.name ?? '?').join(', ');
        const pool = _ACCUSE_CLIQUE;
        return pool[Math.floor(Math.random() * pool.length)](suspect, members);
    }

    const pool = _ACCUSE_DIRECT;
    return pool[Math.floor(Math.random() * pool.length)](suspect, victim);
}

function _debateFallback(speaker, suspect) {
    return _buildDebateLine(speaker, suspect, null, false, null);
}

