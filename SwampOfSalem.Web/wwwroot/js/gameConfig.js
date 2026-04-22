/**
 * @fileoverview gameConfig.js — Game constants bridge between C# and JavaScript.
 *
 * ALL tuning values for the simulation originate in the C# AppLogic project
 * (GameConstants, PersonalityConstants, AppearanceConstants, RelationshipConstants)
 * and are serialised to JSON by GameConfigProvider.GetConfigJson() at startup.
 *
 * The server injects this JSON into the HTML as:
 *   window.GameConfig = <json>;
 * before any ES module is loaded, so this module can safely destructure it
 * and re-export every constant with the same name as the old hard-coded
 * constants.js did — zero changes required in consuming modules.
 *
 * ⚠️  NEVER hard-code game values directly in JavaScript. Change the C# constants
 *     and the new values will propagate here automatically on next page load.
 *
 * @module gameConfig
 */

// ── Game Config ────────────────────────────────────────────────
// All constants are injected from C# (GameConfigProvider) into
// window.GameConfig BEFORE this module is imported.
// We destructure once at module load and re-export with the
// exact same names the old constants.js used.

const G = window.GameConfig;
if (!G) throw new Error('window.GameConfig must be set before importing gameConfig.js');

// ── Scalars ───────────────────────────────────────────────────
export const GATOR_SIZE           = G.GATOR_SIZE;
export const GATOR_COUNT          = G.GATOR_COUNT;
export const MAX_CONCURRENT_CONVERSATIONS = G.MAX_CONCURRENT_CONVERSATIONS;
export const CONV_LIMIT_FOR_NIGHTFALL = G.CONV_LIMIT_FOR_NIGHTFALL;
export const NIGHTFALL_DELAY_MS   = G.NIGHTFALL_DELAY_MS;
export const TICK_MS               = G.TICK_MS;
export const TALK_DIST             = G.TALK_DIST;
export const TALK_STOP             = G.TALK_STOP;
export const HOUSE_ENTER_D         = G.HOUSE_ENTER_D;
export const SOCIAL_DECAY          = G.SOCIAL_DECAY;
export const SOCIAL_GAIN           = G.SOCIAL_GAIN;
export const SOCIAL_MAX            = G.SOCIAL_MAX;
export const SOCIAL_URGENT         = G.SOCIAL_URGENT;
export const DAY_TICKS             = G.DAY_TICKS;
export const NIGHT_TICKS           = G.NIGHT_TICKS;
export const DAWN_TICKS            = G.DAWN_TICKS;
export const DEBATE_TICKS          = G.DEBATE_TICKS;
export const HOME_WARN_TICKS       = G.HOME_WARN_TICKS;
export const VOTE_DISPLAY_TICKS    = G.VOTE_DISPLAY_TICKS;
export const MAX_DEBATE_SPEAKERS   = G.MAX_DEBATE_SPEAKERS;
export const DEBATE_SPEAK_COOLDOWN = G.DEBATE_SPEAK_COOLDOWN;
export const CONVICTION_THRESHOLD  = G.CONVICTION_THRESHOLD;

// ── Phase enum (frozen for parity) ───────────────────────────
export const PHASE = Object.freeze({
    DAY:     G.PHASE.DAY,
    NIGHT:   G.PHASE.NIGHT,
    DAWN:    G.PHASE.DAWN,
    DEBATE:  G.PHASE.DEBATE,
    VOTE:    G.PHASE.VOTE,
    EXECUTE: G.PHASE.EXECUTE,
    OVER:    G.PHASE.OVER
});

// ── Personality / behaviour tables ────────────────────────────
export const PERSONALITIES          = G.PERSONALITIES;
export const PERSONALITY_EMOJI      = G.PERSONALITY_EMOJI;
export const ACTIVITY_EMOJI         = G.ACTIVITY_EMOJI;
export const THOUGHT_STAT_BASE      = G.THOUGHT_STAT_BASE;
export const SOCIAL_STAT_BASE       = G.SOCIAL_STAT_BASE;
export const ACTIVITY_WEIGHTS       = G.ACTIVITY_WEIGHTS;
export const SOCIAL_START           = G.SOCIAL_START;
export const ACTIVITY_TICKS         = G.ACTIVITY_TICKS;
export const MOOD_MATRIX            = G.MOOD_MATRIX;
export const WALK_SPEED             = G.WALK_SPEED;
export const MEMORY_STRENGTH        = G.MEMORY_STRENGTH;

// ── Appearance ────────────────────────────────────────────────
export const NAMES          = G.NAMES;
export const SKIN_TONES     = G.SKIN_TONES;
export const HAT_STYLES     = G.HAT_STYLES;
export const SHIRT_COLORS   = G.SHIRT_COLORS;
export const HOUSE_COLORS   = G.HOUSE_COLORS;

// ── Relationships ─────────────────────────────────────────────
export const LIAR_CHANCE    = G.LIAR_CHANCE;
export const COMPAT         = G.COMPAT;

// ── MOOD_EMOJI (function — cannot come from JSON) ─────────────
export const MOOD_EMOJI = s => s >= 2 ? '\u{1F604}' : s >= 1 ? '\u{1F60A}' : s >= 0 ? '\u{1F610}' : s >= -1 ? '\u{1F61F}' : '\u{1F624}';
