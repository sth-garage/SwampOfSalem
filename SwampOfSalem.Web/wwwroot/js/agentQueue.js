// ── Agent Queue ───────────────────────────────────────────────
// AI is used ONLY for full 2-gator conversations.
// requestFullConversation() shows a modal while the AI call is in-flight.
// When OK is clicked the modal hides; after 2 seconds the conversation
// is played back turn-by-turn on the gator figures.

import { isAgentAvailable, getFullConversation, addAgentMemory, getNightReport } from './agentBridge.js';
import { state } from './state.js';
import { living } from './gator.js';

// Track in-flight requests to avoid duplicate calls for the same pair
const _pending = new Map();

// ── Modal helpers ─────────────────────────────────────────────
const _modalEl       = () => document.getElementById('ai-modal');
const _modalTitle    = () => document.getElementById('ai-modal-title');
const _modalSpeaker  = () => document.getElementById('ai-modal-speaker');
const _modalStatus   = () => document.getElementById('ai-modal-status');
const _modalResult   = () => document.getElementById('ai-modal-result');
const _modalThought  = () => document.getElementById('ai-modal-thought');
const _modalOk       = () => document.getElementById('ai-modal-ok');

function _showModalWaiting(initiatorName, responderName) {
    _modalTitle().textContent   = '🤖 Generating conversation…';
    _modalSpeaker().textContent = `${initiatorName} & ${responderName}`;
    _modalStatus().textContent  = 'Asking AI for their conversation…';
    _modalStatus().style.display  = 'block';
    _modalResult().style.display  = 'none';
    _modalThought().style.display = 'none';
    _modalOk().style.display      = 'none';
    _modalEl().style.display      = 'flex';
}

function _showModalReady(turnCount) {
    _modalTitle().textContent     = '🐊 Conversation ready';
    _modalStatus().style.display  = 'none';
    _modalResult().textContent    = `Got ${turnCount} lines. Click OK to watch the conversation.`;
    _modalResult().style.display  = 'block';
    _modalThought().style.display = 'none';
    _modalOk().style.display      = 'block';
}

function _hideModal() {
    _modalEl().style.display = 'none';
}

/** Wait for the user to press OK, then hide the modal and resolve. */
function _waitForOk(turnCount) {
    return new Promise(resolve => {
        _showModalReady(turnCount);
        const btn = _modalOk();
        function handler() {
            btn.removeEventListener('click', handler);
            _hideModal();
            resolve();
        }
        btn.addEventListener('click', handler);
    });
}

/**
 * No-op stub — AI dialog is not used outside of full conversations.
 * Callers that still reference this function are silently skipped.
 */
export function requestDialog() { /* intentionally empty */ }

/**
 * Request a full AI-generated conversation between two gators.
 * Shows a modal while the AI call is in-flight.
 * On OK the modal closes; after 2 seconds the turns are played back.
 *
 * @param {object} initiator   - Person object for the gator who opened the chat
 * @param {object} responder   - Person object for the other gator
 * @param {string} openingLine - The first line already displayed by the initiator
 * @param {number} maxTurns    - Max turns (1–9)
 * @param {string|null} context
 */
export function requestFullConversation(initiator, responder, openingLine, maxTurns = 6, context = null) {
    if (!isAgentAvailable()) return;

    const key = `${Math.min(initiator.id, responder.id)}:${Math.max(initiator.id, responder.id)}:fullconv`;
    if (_pending.has(key)) return;

    // Don't start a new AI call while turns are still playing back for this pair
    if (initiator._convTurns && initiator._convTurnIndex < initiator._convTurns.length) return;
    if (responder._convTurns && responder._convTurnIndex < responder._convTurns.length) return;

    // Pause simulation while the AI call is in-flight
    const wasPaused = state.paused;
    state.paused = true;

    _showModalWaiting(initiator.name, responder.name);

    const promise = getFullConversation(initiator.id, responder.id, openingLine, maxTurns, context)
        .then(async turns => {
            if (!turns || turns.length === 0) {
                _hideModal();
                if (!wasPaused) state.paused = false;
                return;
            }

            // Wait for user to press OK
            await _waitForOk(turns.length);

            // Resume the simulation immediately after OK
            if (!wasPaused) state.paused = false;

            // After 2 s, begin playing back the turns
            setTimeout(() => {
                initiator._convTurns      = turns;
                initiator._convPartner    = responder;
                initiator._convTurnIndex  = 0;
                _drainNextConvTurn(initiator, responder);
            }, 2000);
        })
        .catch(err => {
            console.error('requestFullConversation failed:', err);
            _hideModal();
            if (!wasPaused) state.paused = false;
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
    const speaker = turn.speakerId === initiator.id ? initiator : responder;
    if (turn.spoken && turn.spoken.length > 0) {
        speaker.message = turn.spoken;
    }
    if (turn.thought) {
        speaker.thought = turn.thought;
    }

    // Schedule the next turn automatically
    if (initiator._convTurnIndex < turns.length) {
        const ms = 2200 + Math.random() * 1800; // 2.2–4 s between lines
        setTimeout(() => _drainNextConvTurn(initiator, responder), ms);
    } else {
        // Conversation finished — clean up
        initiator._convTurns      = null;
        initiator._convPartner    = null;
        initiator._convTurnIndex  = 0;
    }
}

/**
 * Record a memory/event for an agent.
 */
export function recordMemory(alligatorId, day, type, detail, relatedId = null) {
    if (!isAgentAvailable()) return;
    addAgentMemory(alligatorId, day, type, detail, relatedId);
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

