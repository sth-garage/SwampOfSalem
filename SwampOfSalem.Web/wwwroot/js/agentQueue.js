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
 * 1. CONVERSATION MUTEX (global lock)
 *    Only one AI conversation can run at a time. `_conversationInProgress`
 *    is a boolean flag that acts like a lock. Once it's true, no other pair
 *    of gators can start a new AI conversation until the current one fully
 *    completes (last turn displayed + 3-second hold). This prevents two
 *    conversations from playing back simultaneously and causing chaos in
 *    the speech-bubble rendering.
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
 *   simulation.js calls requestFullConversation(a, b, ...)
 *       │
 *       ├─ Check _conversationInProgress → if true, return early (someone else is talking)
 *       ├─ Set _conversationInProgress = true
 *       ├─ Pause the simulation
 *       ├─ Flush pending memories to server (batch HTTP POST)
 *       ├─ Call agentBridge.getFullConversation(...)  ← single AI HTTP call
 *       │       ↓ (async — waiting for AI)
 *       ├─ Resume simulation
 *       ├─ Load turns onto initiator._convTurns[]
 *       ├─ Call _drainNextConvTurn() → show turn 1 → setTimeout → show turn 2 → ...
 *       └─ After last turn: 3s hold → onComplete() → _conversationInProgress = false
 *
 * @module agentQueue
 */
// ── Agent Queue ───────────────────────────────────────────────
// AI is used ONLY for full 2-gator conversations.
// requestFullConversation() sets isWaiting on both gators (showing thinking
// bubbles) while the AI call is in-flight, then plays back turns automatically.

import { isAgentAvailable, getFullConversation, addAgentMemory, getNightReport, flushMemories } from './agentBridge.js';
import { state } from './state.js';
import { living } from './gator.js';
import { logChat } from './simulation.js';
import { TICK_MS } from './gameConfig.js';

// _pending: Map of conversation keys → in-flight Promise.
// Prevents the same pair from sending two concurrent requests.
// Key format: "min(idA,idB):max(idA,idB):fullconv"
const _pending = new Map();

// _conversationInProgress: the global mutex.
// true = an AI conversation is currently being fetched OR is being drained.
// No new conversation can start while this is true.
let _conversationInProgress = false;

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
    if (_conversationInProgress) return;

    const key = `${Math.min(initiator.id, responder.id)}:${Math.max(initiator.id, responder.id)}:fullconv`;
    if (_pending.has(key)) return;

    // Don't start a new AI call while turns are still playing back for this pair
    if (initiator._convTurns && initiator._convTurnIndex < initiator._convTurns.length) return;
    if (responder._convTurns && responder._convTurnIndex < responder._convTurns.length) return;

    _conversationInProgress = true;

    // Position gators facing each other horizontally for conversation
    // Calculate midpoint between them
    const midX = (initiator.x + responder.x) / 2;
    const midY = (initiator.y + responder.y) / 2;
    const spacing = 100; // pixels apart horizontally

    // Determine who goes left and who goes right (left-most stays left)
    const leftGator = initiator.x < responder.x ? initiator : responder;
    const rightGator = initiator.x < responder.x ? responder : initiator;

    // Position them facing each other
    leftGator.x = midX - spacing;
    leftGator.y = midY;
    leftGator.targetX = leftGator.x;
    leftGator.targetY = leftGator.y;
    leftGator._conversationFrozen = true;

    rightGator.x = midX + spacing;
    rightGator.y = midY;
    rightGator.targetX = rightGator.x;
    rightGator.targetY = rightGator.y;
    rightGator._conversationFrozen = true;

    // Pause the game while waiting for AI response
    if (!state.paused) {
        state.paused = true;
        const pauseBtn = document.getElementById('pauseBtn');
        if (pauseBtn) pauseBtn.textContent = '⏸ Paused (AI thinking...)';
        if (state.tickInterval) {
            clearInterval(state.tickInterval);
            state.tickInterval = null;
        }
    }

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
                _conversationInProgress = false;
                state.activeConversation = false;
                initiator.activity = 'moving'; initiator.talkingTo = null; initiator.message = null;
                responder.activity = 'moving'; responder.talkingTo = null; responder.message = null;
                initiator._conversationFrozen = false;
                responder._conversationFrozen = false;

                // Resume the game
                if (state.paused) {
                    state.paused = false;
                    const pauseBtn = document.getElementById('pauseBtn');
                    if (pauseBtn) pauseBtn.textContent = '⏸ Pause';
                    if (!state.tickInterval && _tickFunction) {
                        state.tickInterval = setInterval(_tickFunction, TICK_MS);
                    }
                }
                return;
            }

            // Log all AI output to console
            const label = isPrivate ? '🏠 [Private AI conv]' : '💬 [AI conv]';
            console.log(`${label} ${initiator.name} & ${responder.name} (${turns.length} turns):`);
            turns.forEach((t, i) => {
                const speaker = t.speakerGatorId === initiator.id ? initiator : responder;
                console.log(`  [${i + 1}] ${speaker.name}: ${t.speech ?? ''}${t.thought ? ` (💭 ${t.thought})` : ''}`);
            });

            // Resume the game now that AI response arrived
            if (state.paused) {
                state.paused = false;
                const pauseBtn = document.getElementById('pauseBtn');
                if (pauseBtn) pauseBtn.textContent = '⏸ Pause';
                if (!state.tickInterval && _tickFunction) {
                    state.tickInterval = setInterval(_tickFunction, TICK_MS);
                }
            }

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
            _conversationInProgress = false;
            state.activeConversation = false;
            initiator.activity = 'moving'; initiator.talkingTo = null; initiator.message = null;
            responder.activity = 'moving'; responder.talkingTo = null; responder.message = null;
            initiator._conversationFrozen = false;
            responder._conversationFrozen = false;

            // Resume the game
            if (state.paused) {
                state.paused = false;
                const pauseBtn = document.getElementById('pauseBtn');
                if (pauseBtn) pauseBtn.textContent = '⏸ Pause';
                if (!state.tickInterval && _tickFunction) {
                    state.tickInterval = setInterval(_tickFunction, TICK_MS);
                }
            }
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

            // Unfreeze: gameLoop() may now move these gators again.
            initiator._conversationFrozen = false;
            responder._conversationFrozen = false;

            // Clean up all playback state.
            initiator._convTurns      = null;
            initiator._convPartner    = null;
            initiator._convTurnIndex  = 0;
            initiator._convIsPrivate  = false;
            initiator._convOnComplete = null;
            initiator._convHolding    = false;
            responder._convHolding    = false;

            // Release the global mutex so new conversations can start.
            _conversationInProgress = false;

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
        const suspectName = entry?.topSuspectName ?? '—';
        return `<div class="nr-gator-row" data-id="${p.id}">
            <span class="nr-gator-name">${p.name}</span>
            <span class="nr-gator-suspect">suspects <strong>${suspectName}</strong></span>
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
    if (entry) {
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
            <span class="nr-detail-name">${g.name}</span>
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

