/**
 * @fileoverview main.js — Application entry point.
 *
 * This file is intentionally minimal. The HTML page loads this module and
 * calls `initSimulation()` to boot the entire simulation.
 *
 * All real logic lives in simulation.js and its imported sub-modules.
 * Keeping this file thin makes it easy to swap or extend the entry point
 * without touching the simulation internals.
 */
// ── Main entry point ──────────────────────────────────────────
// Re-exports initSimulation from the modular codebase.
// Home.razor imports this file via JS interop.
export { initSimulation, testConversation } from './simulation.js';
