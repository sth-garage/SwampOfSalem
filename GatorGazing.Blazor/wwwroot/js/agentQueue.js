// ── Agent Queue ───────────────────────────────────────────────
// Async fire-and-forget wrapper around agentBridge.js.
// The simulation is tick-based and synchronous, so we can't await LLM calls
// inline. Instead, we fire a request, set a fallback immediately, and
// update the person's message/thought when the LLM responds.
//
// If the agent is unavailable or the call fails, the fallback stays.

import { isAgentAvailable, getAgentDialog, getAgentThought, getAgentVote, addAgentMemory } from './agentBridge.js';

// Dialog source mode: 'AI' (use agents, fallback on failure) or 'Local' (JS only)
let _dialogSource = 'AI';

/**
 * Set the dialog source mode.
 * @param {'AI'|'Local'} mode
 */
export function setDialogSource(mode) {
    _dialogSource = mode;
    console.log(`Dialog source set to: ${_dialogSource}`);
}

/**
 * Get the current dialog source mode.
 * @returns {'AI'|'Local'}
 */
export function getDialogSource() {
    return _dialogSource;
}

// Track in-flight requests to avoid duplicate calls for the same person+type
const _pending = new Map();  // key: `${personId}:${type}` → Promise

function pendingKey(id, type) { return `${id}:${type}`; }
function isPending(id, type) { return _pending.has(pendingKey(id, type)); }

function trackRequest(id, type, promise) {
    const key = pendingKey(id, type);
    _pending.set(key, promise);
    promise.finally(() => _pending.delete(key));
}

/**
 * Request agent-generated dialog for a person. Sets fallback immediately,
 * then overwrites with agent response when it arrives.
 * @param {object} person - The person object (will be mutated: .message)
 * @param {string} dialogType - "conversation","accusation","defense","debate","mourn","bluff","opinion","guarded","execute_plea","execute_react","shop","invite"
 * @param {string} fallback - Fallback message to show immediately
 * @param {number|null} targetId - Target alligator ID if applicable
 * @param {string|null} context - Extra context for the agent
 */
export function requestDialog(person, dialogType, fallback, targetId = null, context = null) {
    person.message = fallback;
    if (_dialogSource === 'Local') return; // JS-only mode
    if (!isAgentAvailable() || isPending(person.id, 'dialog')) return;

    const promise = getAgentDialog(person.id, dialogType, targetId, context)
        .then(response => {
            if (response && response.length > 0 && response.length <= 200) {
                person.message = response;
            }
        });
    trackRequest(person.id, 'dialog', promise);
}

/**
 * Request agent-generated thought for a person. Sets fallback immediately,
 * then overwrites with agent response when it arrives.
 * @param {object} person - The person object (will be mutated: .thought)
 * @param {string} fallback - Fallback thought to show immediately
 */
export function requestThought(person, fallback) {
    person.thought = fallback;
    if (_dialogSource === 'Local') return; // JS-only mode
    if (!isAgentAvailable() || isPending(person.id, 'thought')) return;

    const promise = getAgentThought(person.id)
        .then(response => {
            if (response && response.length > 0 && response.length <= 150) {
                person.thought = response;
            }
        });
    trackRequest(person.id, 'thought', promise);
}

/**
 * Request agent-driven vote. Returns a Promise that resolves to the voted-for
 * person object, or null if the agent is unavailable (caller should use JS fallback).
 * @param {object} voter - The voter person object
 * @param {number[]} candidateIds - IDs of eligible candidates
 * @param {string} debateSummary - Summary of the debate
 * @returns {Promise<number|null>} The ID voted for, or null if agent unavailable
 */
export async function requestVote(voter, candidateIds, debateSummary) {
    if (!isAgentAvailable()) return null;
    try {
        const result = await getAgentVote(voter.id, candidateIds, debateSummary);
        if (result !== null && candidateIds.includes(result)) {
            return result;
        }
    } catch (e) {
        console.warn('Agent vote failed, using JS fallback:', e);
    }
    return null;
}

/**
 * Record a memory/event for an agent.
 * @param {number} alligatorId
 * @param {number} day
 * @param {string} type
 * @param {string} detail
 * @param {number|null} relatedId
 */
export function recordMemory(alligatorId, day, type, detail, relatedId = null) {
    if (!isAgentAvailable()) return;
    // Fire and forget — don't block the tick
    addAgentMemory(alligatorId, day, type, detail, relatedId);
}
