// ── Game Config ────────────────────────────────────────────────
// All constants are injected from C# (GameConfigProvider) into
// window.GameConfig BEFORE this module is imported.
// We destructure once at module load and re-export with the
// exact same names the old constants.js used.

const G = window.GameConfig;
if (!G) throw new Error('window.GameConfig must be set before importing gameConfig.js');

// ── Scalars ───────────────────────────────────────────────────
export const PERSON_SIZE           = G.PERSON_SIZE;
export const PEOPLE_COUNT          = G.PEOPLE_COUNT;
export const TICK_MS               = G.TICK_MS;
export const TALK_DIST             = G.TALK_DIST;
export const TALK_STOP             = G.TALK_STOP;
export const HOUSE_ENTER_D         = G.HOUSE_ENTER_D;
export const APPLE_PRICE           = G.APPLE_PRICE;
export const ORANGE_PRICE          = G.ORANGE_PRICE;
export const ORANGE_LOVER_DEBT_MAX = G.ORANGE_LOVER_DEBT_MAX;
export const OBSERVE_SHOP_RADIUS   = G.OBSERVE_SHOP_RADIUS;
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
export const ORANGE_LOVER_CHANCE    = G.ORANGE_LOVER_CHANCE;
export const MEMORY_STRENGTH        = G.MEMORY_STRENGTH;

// ── Dialog / phrase banks ─────────────────────────────────────
export const DIALOGUE               = G.DIALOGUE;
export const INVITE_LINES           = G.INVITE_LINES;
export const THOUGHTS               = G.THOUGHTS;
export const MURDERER_BLUFF         = G.MURDERER_BLUFF;
export const ACCUSE_LINES           = G.ACCUSE_LINES;
export const DEFEND_LINES           = G.DEFEND_LINES;
export const MOURN_LINES            = G.MOURN_LINES;
export const DEBATE_ARGUMENT_LINES  = G.DEBATE_ARGUMENT_LINES;
export const GUARDED_LINES          = G.GUARDED_LINES;
export const LIE_INCRIMINATE_LINES  = G.LIE_INCRIMINATE_LINES;
export const SHOP_LINES             = G.SHOP_LINES;
export const ORANGE_BUY_LINES       = G.ORANGE_BUY_LINES;
export const THEFT_WITNESS_LINES    = G.THEFT_WITNESS_LINES;
export const VICTIM_REACT_LINES     = G.VICTIM_REACT_LINES;
export const OPINION_SHARE_LINES_POS = G.OPINION_SHARE_LINES_POS;
export const OPINION_SHARE_LINES_NEG = G.OPINION_SHARE_LINES_NEG;
export const DAWN_THOUGHTS_INNOCENT  = G.DAWN_THOUGHTS_INNOCENT;
export const DAWN_THOUGHTS_MURDERER  = G.DAWN_THOUGHTS_MURDERER;
export const PERSUADE_LINES         = G.PERSUADE_LINES;
export const RELATION_THOUGHTS      = G.RELATION_THOUGHTS;

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
