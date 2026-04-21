// ── Agent Queue ───────────────────────────────────────────────
// AI is used ONLY for full 2-gator conversations.
// requestFullConversation() sets isWaiting on both gators (showing thinking
// bubbles) while the AI call is in-flight, then plays back turns automatically.

import { isAgentAvailable, getFullConversation, addAgentMemory, getNightReport, flushMemories } from './agentBridge.js';
import { state } from './state.js';
import { living } from './gator.js';
import { logChat } from './simulation.js';
import { TICK_MS } from './gameConfig.js';

// Track in-flight requests to avoid duplicate calls for the same pair
const _pending = new Map();

// Global lock — only one conversation at a time across all gators
let _conversationInProgress = false;

// Store reference to tick function to avoid circular import issues
let _tickFunction = null;

export function setTickFunction(tickFn) {
    _tickFunction = tickFn;
}

// ── Local memory buffer ───────────────────────────────────────
// Memories are stored here and only flushed to the server when a conversation starts.
const _memoryBuffer = new Map(); // alligatorId → [{day, type, detail, relatedId}, ...]

function _bufferMemory(alligatorId, day, type, detail, relatedId) {
    if (!_memoryBuffer.has(alligatorId)) _memoryBuffer.set(alligatorId, []);
    _memoryBuffer.get(alligatorId).push({ day, type, detail, relatedId: relatedId ?? null });
}

async function _flushMemoriesForGator(alligatorId) {
    const entries = _memoryBuffer.get(alligatorId);
    if (!entries || entries.length === 0) return;
    _memoryBuffer.delete(alligatorId); // clear before sending to avoid re-send on error
    await flushMemories(alligatorId, entries);
}

/**
 * No-op stub — AI dialog is not used outside of full conversations.
 * Callers that still reference this function are silently skipped.
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
    const turns = initiator._convTurns;
    if (!turns || initiator._convTurnIndex >= turns.length) return;

    const turn = turns[initiator._convTurnIndex++];
    const isPrivate = !!initiator._convIsPrivate;

    const speaker = turn.speakerGatorId === initiator.id ? initiator : responder;
    const listener = turn.speakerGatorId === initiator.id ? responder : initiator;
    if (turn.speech && turn.speech.length > 0) {
        speaker.message = turn.speech;
        // Log to both gators' chatLogs (private = no overhearing)
        logChat(speaker, listener.id, turn.speech, turn.thought ?? null, isPrivate);
    }
    if (turn.thought) {
        speaker.thought = turn.thought;
    }

    // Schedule the next turn automatically
    if (initiator._convTurnIndex < turns.length) {
        const ms = 2200 + Math.random() * 1800; // 2.2–4 s between lines
        setTimeout(() => _drainNextConvTurn(initiator, responder), ms);
    } else {
        // All turns displayed — hold 3 s, then fire onComplete and clean up
        const onComplete = initiator._convOnComplete ?? null;
        // Set flag to keep gators in place during final hold
        initiator._convHolding = true;
        responder._convHolding = true;
        setTimeout(() => {
            // Update recentTalkWith timestamps to enforce cooldown between conversations
            const now = Date.now();
            if (!initiator.recentTalkWith) initiator.recentTalkWith = {};
            if (!responder.recentTalkWith) responder.recentTalkWith = {};
            initiator.recentTalkWith[responder.id] = now;
            responder.recentTalkWith[initiator.id] = now;

            // Unfreeze gators so they can move again
            initiator._conversationFrozen = false;
            responder._conversationFrozen = false;

            initiator._convTurns      = null;
            initiator._convPartner    = null;
            initiator._convTurnIndex  = 0;
            initiator._convIsPrivate  = false;
            initiator._convOnComplete = null;
            initiator._convHolding    = false;
            responder._convHolding    = false;
            _conversationInProgress = false;
            if (onComplete) onComplete();
        }, 3000);
    }
}

/**
 * Record a memory/event for an agent — stored locally and flushed when a conversation starts.
 */
export function recordMemory(alligatorId, day, type, detail, relatedId = null) {
    _bufferMemory(alligatorId, day, type, detail, relatedId);
}

/**
 * Request agent-driven vote — no longer AI-driven; always returns null so the
 * caller falls back to its local JS logic.
 */
export async function requestVote() {
    return null;
}

// ── Night Report ─────────────────────────────────────────────

/**
 * Fetch the night AI report for all living gators, show the night screen
 * panel, and resolve only after the user clicks "Continue to Morning."
 *
 * @returns {Promise<void>}
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

