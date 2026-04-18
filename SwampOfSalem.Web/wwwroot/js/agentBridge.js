// ── Agent Interop Bridge ──────────────────────────────────────
// Provides async functions that call the server-side API endpoints.
// Falls back to null/undefined if the server is unavailable.

/**
 * Check if the SK agent backend is available.
 * With the server approach, we assume it's always available.
 */
export function isAgentAvailable() {
    return true;
}

/**
 * Get AI-generated dialog for an alligator.
 */
export async function getAgentDialog(alligatorId, dialogType, targetId, context) {
    try {
        const payload = { alligatorId, dialogType, targetAlligatorId: targetId, context };
        console.log(`[AGENT ➡️ SEND] dialog`, payload);
        const resp = await fetch('/api/agent/dialog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        console.log(`[AGENT ⬅️ RECV] dialog for gator ${alligatorId}:`, data);
        return { spoken: data.message || null, thought: data.thought || null };
    } catch (e) {
        console.warn('Agent dialog failed:', e);
        return { spoken: null, thought: null };
    }
}

/**\n * Get an AI-driven vote from an alligator agent.\n */
export async function getAgentVote(alligatorId, candidateIds, debateSummary) {
    try {
        const payload = { alligatorId, candidateIds, debateSummary };
        console.log(`[AGENT ➡️ SEND] vote`, payload);
        const resp = await fetch('/api/agent/vote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        console.log(`[AGENT ⬅️ RECV] vote for gator ${alligatorId}:`, data.voteForId);
        return data.voteForId ?? null;
    } catch (e) {
        console.warn('Agent vote failed:', e);
        return null;
    }
}

/**
 * Record a memory/observation for an agent.
 */
export async function addAgentMemory(alligatorId, day, type, detail, relatedId) {
    try {
        const payload = { alligatorId, day, type, detail, relatedId };
        console.log(`[AGENT ➡️ SEND] memory`, payload);
        await fetch('/api/agent/memory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.warn('Agent memory failed:', e);
    }
}

/**
 * Generate a full back-and-forth conversation between two alligators in a single AI call.
 * Returns an array of turn objects: { speakerId, spoken, thought }
 */
export async function getFullConversation(initiatorId, responderId, openingLine, maxTurns, context) {
    try {
        const payload = { initiatorId, responderId, openingLine, maxTurns: maxTurns ?? 6, context: context ?? null };
        console.log(`[AGENT ➡️ SEND] conversation`, payload);
        const resp = await fetch('/api/agent/conversation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        console.log(`[AGENT ⬅️ RECV] conversation turns:`, data.turns);
        return data.turns ?? [];
    } catch (e) {
        console.warn('Agent conversation failed:', e);
        return [];
    }
}

/**
 * Generate night-time AI reflections for all living alligators.
 * Returns an array of { alligatorId, alligatorName, topSuspectId, topSuspectName, suspicionReason, innerThought }
 * @param {number[]} aliveIds
 */
export async function getNightReport(aliveIds) {
    try {
        const payload = { aliveIds };
        console.log(`[AGENT ➡️ SEND] night-report`, payload);
        const resp = await fetch('/api/agent/night-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        console.log(`[AGENT ⬅️ RECV] night-report:`, data.entries);
        return data.entries ?? [];
    } catch (e) {
        console.warn('Night report failed:', e);
        return [];
    }
}
