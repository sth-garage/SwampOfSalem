// ── Agent Interop Bridge ──────────────────────────────────────
// Provides async functions that call the .NET AgentInterop via JSInterop.
// Falls back to null/undefined if no interop is available (SK server not running).

/**
 * Check if the SK agent backend is available.
 */
export function isAgentAvailable() {
    return !!window._agentInterop;
}

/**
 * Get AI-generated dialog for an alligator.
 * @param {number} alligatorId
 * @param {string} dialogType - "conversation", "thought", "accusation", "defense", "debate"
 * @param {number|null} targetId - ID of the alligator being talked to (if any)
 * @param {string|null} context - Additional context
 * @returns {Promise<string|null>} The dialog message, or null if unavailable
 */
export async function getAgentDialog(alligatorId, dialogType, targetId, context) {
    if (!window._agentInterop) return null;
    try {
        return await window._agentInterop.invokeMethodAsync('GetAgentDialog', alligatorId, dialogType, targetId, context);
    } catch (e) {
        console.warn('Agent dialog failed:', e);
        return null;
    }
}

/**
 * Get an AI-generated thought for an alligator.
 * @param {number} alligatorId
 * @returns {Promise<string|null>}
 */
export async function getAgentThought(alligatorId) {
    if (!window._agentInterop) return null;
    try {
        return await window._agentInterop.invokeMethodAsync('GetAgentThought', alligatorId);
    } catch (e) {
        console.warn('Agent thought failed:', e);
        return null;
    }
}

/**
 * Get an AI-driven vote from an alligator agent.
 * @param {number} alligatorId
 * @param {number[]} candidateIds
 * @param {string} debateSummary
 * @returns {Promise<number|null>} The ID of who the agent votes for
 */
export async function getAgentVote(alligatorId, candidateIds, debateSummary) {
    if (!window._agentInterop) return null;
    try {
        return await window._agentInterop.invokeMethodAsync('GetAgentVote', alligatorId, candidateIds, debateSummary);
    } catch (e) {
        console.warn('Agent vote failed:', e);
        return null;
    }
}

/**
 * Record a memory/observation for an agent.
 * @param {number} alligatorId
 * @param {number} day
 * @param {string} type
 * @param {string} detail
 * @param {number|null} relatedId
 */
export async function addAgentMemory(alligatorId, day, type, detail, relatedId) {
    if (!window._agentInterop) return;
    try {
        await window._agentInterop.invokeMethodAsync('AddAgentMemory', alligatorId, day, type, detail, relatedId);
    } catch (e) {
        console.warn('Agent memory failed:', e);
    }
}
