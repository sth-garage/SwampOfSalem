/**
 * @fileoverview agentBridge.js — Thin HTTP client for the .NET AI agent API.
 *
 * This module is the ONLY place in the frontend that makes fetch() calls to
 * the server. All other modules call these functions so the API surface is
 * centralised and easy to mock / test.
 *
 * Endpoint mapping:
 *   isAgentAvailable()          → always true (server-side model)
 *   getAgentDialog()            → POST /api/agent/dialog
 *   getAgentVote()              → POST /api/agent/vote
 *   addAgentMemory()            → no-op (memories are batched locally)
 *   flushMemories()             → POST /api/agent/memory/batch
 *   getFullConversation()       → POST /api/agent/conversation
 *   getNightReport()            → POST /api/agent/night-report
 *
 * All functions are async and swallow errors, returning null/undefined on
 * failure so the simulation can degrade gracefully if the server is down
 * or the LLM is rate-limited.
 *
 * @module agentBridge
 */
// ── Agent Interop Bridge ──────────────────────────────────────
// Provides async functions that call the server-side API endpoints.
// Falls back to null/undefined if the server is unavailable.

/**
 * Check if the SK agent backend is available.
 *
 * Currently always returns true because we use a server-side model (ASP.NET Core).
 * In a future version this could ping /api/config and return false if the LLM
 * is not configured, so the simulation can degrade to scripted dialogue.
 *
 * @returns {boolean} Always true in the current implementation.
 */
export function isAgentAvailable() {
    return true;
}

/**
 * Requests a single dialog line from one alligator's AI agent.
 *
 * ENDPOINT: POST /api/agent/dialog
 *
 * Use cases:
 *   - Opinion sharing (dialogType='opinion'): speaker shares views on a third gator
 *   - Guarded response (dialogType='guarded'): speaker is evasive with a disliked listener
 *   - Thought generation (dialogType='thought'): gator generates an inner monologue
 *
 * NOTE: Full conversations use getFullConversation() instead, which returns all turns
 * in a single API call. This function is used only for one-off lines outside a
 * multi-turn conversation (e.g. debate accusations, opinion sharing).
 *
 * ERROR HANDLING:
 *   On any fetch/parse error, returns { spoken: null, thought: null }.
 *   The caller (simulation.js _maybeShareOpinion) handles null gracefully
 *   by simply not displaying a speech bubble.
 *
 * @param {number}      alligatorId  - ID of the gator generating the line.
 * @param {string}      dialogType   - Category: 'opinion' | 'guarded' | 'thought' | etc.
 * @param {number|null} targetId     - ID of the gator being spoken to/about, or null.
 * @param {string|null} context      - Additional context string for the AI.
 * @returns {Promise<{spoken:string|null, thought:string|null}>}
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

/**
 * Requests an AI-driven vote from one alligator's agent.
 *
 * ENDPOINT: POST /api/agent/vote
 *
 * CURRENT STATUS: The server-side agent always returns null because AI voting
 * was replaced with pure JS logic (decideVote in phases.js) for performance.
 * This function exists for potential future AI voting re-enablement.
 *
 * ERROR HANDLING: Returns null on any failure. The caller (agentQueue.requestVote)
 * treats null as "use JS fallback."
 *
 * @param {number}   alligatorId   - ID of the voting gator.
 * @param {number[]} candidateIds  - IDs of gators that can be voted for.
 * @param {string}   debateSummary - Summary of what was said during the debate.
 * @returns {Promise<number|null>} The gator ID to vote for, or null (abstain/fallback).
 */
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
 * addAgentMemory is intentionally a no-op — memories are now buffered locally
 * and flushed in batch via flushMemories() when a conversation starts.
 */
export function addAgentMemory() { /* buffered locally — see agentQueue.recordMemory */ }

/**
 * Sends all buffered memory entries for one alligator to the server in one batch POST.
 *
 * ENDPOINT: POST /api/agent/memory/batch
 *
 * WHEN TO CALL:
 *   Just before a new conversation starts (in agentQueue._flushMemoriesForGator).
 *   Sending all memories in one batch minimises HTTP round trips.
 *
 * SERVER-SIDE EFFECT:
 *   GatorAgentService.AddMemory() injects each entry as a user message in the
 *   agent's ChatHistory so the AI has current context before it speaks.
 *
 * FORMAT of each entry:
 *   { day: number, type: string, detail: string, relatedId: number|null }
 *
 * SAFE TO CALL WITH EMPTY ARRAY:
 *   The function returns early without any network call if entries is empty.
 *
 * ERROR HANDLING:
 *   Swallowed — if the flush fails, the agent simply won't have those memories.
 *   No retry logic; the simulation continues without crashing.
 *
 * @param {number} alligatorId
 * @param {Array<{day:number, type:string, detail:string, relatedId:number|null}>} entries
 * @returns {Promise<void>}
 */
export async function flushMemories(alligatorId, entries) {
    if (!entries || entries.length === 0) return;
    try {
        const payload = { alligatorId, entries };
        console.log(`[AGENT ➡️ SEND] memory/batch (${entries.length} entries) for gator ${alligatorId}`);
        await fetch('/api/agent/memory/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.warn('Agent memory batch failed:', e);
    }
}

/**
 * Requests a complete multi-turn AI conversation between two gators.
 *
 * ENDPOINT: POST /api/agent/conversation
 *
 * WHY ONE CALL FOR ALL TURNS?
 *   Making one API call for all turns eliminates:
 *     - N×2 round-trip latency (6 turns × ~2s = 12s wait vs ~3s batched)
 *     - Incoherence between turns (each separate call might contradict previous ones)
 *     - Race conditions (multiple in-flight requests for the same pair)
 *   The JS client plays turns back with artificial 2.2–4s delays for a natural feel.
 *
 * SERVER-SIDE PROCESSING:
 *   GatorAgentService.GenerateFullConversationAsync() builds a context message,
 *   injects it into the initiator's ChatHistory, makes ONE LLM call, and returns
 *   all turns as a JSON array. Speaker names are mapped to IDs server-side.
 *
 * RETURN FORMAT:
 *   Each element of the returned array (data.messages) is a ConversationMessage:
 *   { speakerGatorId: number, speech: string, thought: string }
 *
 * ERROR HANDLING:
 *   Returns [] on any failure.
 *   agentQueue.requestFullConversation() treats [] as a failed conversation and
 *   releases both gators without displaying any turns.
 *
 * @param {number}      initiatorId  - ID of the gator who opened the conversation.
 * @param {number}      responderId  - ID of the other gator.
 * @param {string}      openingLine  - The first line already spoken by the initiator.
 * @param {number}      maxTurns     - Maximum number of turns (1–9).
 * @param {string|null} context      - Optional context string (topic, relation, phase).
 * @returns {Promise<Array<{speakerGatorId:number, speech:string, thought:string}>>}
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
        console.log(`[AGENT ⬅️ RECV] full response:`, JSON.stringify(data));
        console.log(`[AGENT ⬅️ RECV] conversation messages (${(data.messages ?? []).length}):`, data.messages);
        return data.messages ?? [];
    } catch (e) {
        console.warn('Agent conversation failed:', e);
        return [];
    }
}

/**
 * Generates night-time AI reflections for all living alligators in parallel.
 *
 * ENDPOINT: POST /api/agent/night-report
 *
 * SERVER-SIDE PROCESSING:
 *   GatorAgentService.GenerateNightReportAsync() fires ONE AI call per living gator
 *   in parallel (Task.WhenAll). Each agent reflects on the day's events:
 *     - Who they most suspect and why
 *     - Their private inner thought
 *
 * WHEN CALLED:
 *   By agentQueue.requestNightReport() after triggerNightfall().
 *   All buffered memories are flushed first so each agent has current context.
 *
 * DISPLAY:
 *   Results are rendered in the night-report overlay panel. Players can click
 *   each gator's row to see their full suspicion reasoning.
 *
 * ERROR HANDLING:
 *   Returns [] on failure. The night report panel falls back to a "No AI data" message.
 *
 * @param {number[]} aliveIds - IDs of all currently living gators.
 * @returns {Promise<Array<{
 *   alligatorId:     number,
 *   alligatorName:   string,
 *   topSuspectId:    number|null,
 *   topSuspectName:  string|null,
 *   suspicionReason: string|null,
 *   innerThought:    string|null
 * }>>}
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
