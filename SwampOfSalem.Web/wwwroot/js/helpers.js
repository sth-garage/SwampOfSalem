/**
 * @fileoverview helpers.js — Pure utility functions and topic/appearance data.
 *
 * This module contains:
 *
 *   Random helpers:
 *     rnd(n)              Integer 0..n-1
 *     rndF(n)             Float 0..n
 *     hsl()               Random bright HSL color string
 *     rndTicks(activity)  Random tick count for given activity from ACTIVITY_TICKS ranges
 *
 *   Topics & opinions:
 *     TOPICS              Array of 4 conversation topic keys
 *     TOPIC_LABELS        Human-readable emoji labels for each topic
 *     SPORTS_TEAMS        Local team names (Rockets, Jets) + out-of-town (Chowda)
 *     generateTopicOpinions(personality)  Creates an opinion map for a new gator
 *     topicCompatibility(a,b,topic)       Returns alignment score for two gators on a topic
 *     applyTopicRelationDelta(a,b,topic)  Nudges relations based on topic agreement
 *
 *   Appearance & layout:
 *     randomAppearance(index)    Picks skin tone, hat, shirt colour for a new gator
 *     culdesacLayout(n, W, H)   Calculates house positions in a culde-sac ring
 *     stageBounds()              Returns {W, H} of the #world element
 *     buildFigureSVG(gator)      Generates the gator's SVG sprite string
 *     buildCuldesacSVG(houses)   Generates the static culde-sac road SVG
 *
 *   Timing helpers:
 *     speakDelayMs(text)        Delay before a speech bubble appears (~reading speed)
 *     thoughtDelayMs(text)      Delay before a thought bubble appears
 *
 *   Display helpers:
 *     relationEmoji(val)        Returns ❤️/💛/🤍/💔 based on relation score
 *     relationColor(val)        Returns CSS colour for a relation score
 *
 * @module helpers
 */
import {
    GATOR_SIZE, GATOR_COUNT, PERSONALITIES, ACTIVITY_TICKS, WALK_SPEED,
    SKIN_TONES, HAT_STYLES, SHIRT_COLORS, HOUSE_COLORS, NAMES,
    PERSONALITY_EMOJI
} from './gameConfig.js';

// ── Random helpers ────────────────────────────────────────────
/**
 * Returns a random integer in [0, n-1].
 * The `n` parameter is the exclusive upper bound (like array.length).
 * Example: rnd(6) returns 0, 1, 2, 3, 4, or 5.
 */
export const rnd  = n => Math.floor(Math.random() * n);

/**
 * Returns a random float in [0, n].
 * Used for pixel positions and jitter where fractional values are fine.
 */
export const rndF = n => Math.random() * n;

/**
 * Returns a random bright HSL color string like "hsl(217, 72%, 58%)".
 * Used for gator accent colors and speech bubble tints.
 * The saturation (55–85%) and lightness (45–65%) ranges keep colors vivid
 * but not neon — they work well against the dark swamp background.
 */
export const hsl  = () => `hsl(${rnd(360)},${55+rnd(30)}%,${45+rnd(20)}%)`;

/**
 * Returns a random tick count for a given activity type.
 * Reads the [min, max] range from ACTIVITY_TICKS (imported from gameConfig.js)
 * and returns min + random value within the range.
 *
 * @param {string} activity - 'moving' | 'talking' | 'hosting' | 'visiting'
 * @returns {number} Tick count (1 tick = TICK_MS milliseconds of simulation time)
 */
export const rndTicks = a => { const [mn,mx] = ACTIVITY_TICKS[a]; return mn + rnd(mx-mn+1); };


// ── Topics & opinions ─────────────────────────────────────────
// The four conversation topics gators discuss while socialising.
// Sports: Rockets and Jets are the local teams; Chowda fans are out-of-towners
// looked down upon by Rockets/Jets fans — this creates friction and bonding.
export const TOPICS = [
    'sports_team',              // Rockets, Jets, or Chowda (out-of-town)
    'local_gossip',             // sharing rumours and opinions about others
    'swamp_leadership',         // whether they trust / like the swamp's leadership
    'favorite_swamp_activity',  // what they love most to do in the swamp
];

// Readable labels for UI display
export const TOPIC_LABELS = {
    sports_team:             '🏈 Sports Team',
    local_gossip:            '🗣️ Local Gossip',
    swamp_leadership:        '👑 Swamp Leadership',
    favorite_swamp_activity: '🌿 Favorite Swamp Activity',
};

// Sports team affiliation constants
export const SPORTS_TEAMS = ['Rockets', 'Jets', 'Chowda'];

/**
 * Generate a random opinion set for a new alligator across all 4 topics.
 *
 * ALGORITHM:
 *   Each topic gets a numeric opinion score -100..+100 (except sports_team
 *   which is a string team name).
 *
 *   Personality bias shifts the mean:
 *     cheerful  → +30 (optimistic about everything)
 *     grumpy    → -30 (pessimistic about everything)
 *     extrovert → +20 (socially positive, likes sharing topics)
 *     paranoid  → -20 (distrustful)
 *     (etc.)
 *
 *   The raw score is:  Random(-100..+100)  +  bias * (0.5..1.0)
 *   Then clamped to [-100, +100].
 *
 *   Sports team assignment:
 *     42% → Rockets (local, majority)
 *     43% → Jets    (local, minority)
 *     15% → Chowda  (out-of-town — creates tension with locals)
 *
 * @param {string} personality
 * @returns {Object.<string,number|string>} Map of topic → opinion value or team string.
 */
export function generateTopicOpinions(personality) {
    const opinions = {};

    // Personality-based bias: cheerful → positive lean, grumpy → negative lean, etc.
    const bias = {
        cheerful:  30,
        grumpy:   -30,
        shy:      -10,
        extrovert: 20,
        paranoid: -20,
        neutral:    0,
    }[personality] ?? 0;

    for (const topic of TOPICS) {
        if (topic === 'sports_team') {
            // Rockets and Jets are local (common); Chowda fans are out-of-towners (~15%).
            const roll = Math.random();
            opinions.sports_team = roll < 0.42 ? 'Rockets' : roll < 0.85 ? 'Jets' : 'Chowda';
        } else {
            const raw = (Math.random() * 200 - 100) + bias * (0.5 + Math.random() * 0.5);
            opinions[topic] = Math.max(-100, Math.min(100, Math.round(raw)));
        }
    }
    return opinions;
}

/**
 * Compute a compatibility score [-100, 100] between two alligators based on
 * shared topic opinions.
 *
 * ALGORITHM:
 *   For each shared topic:
 *     - sports_team: handled specially by _sportsTeamCompat()
 *     - numeric topics: score = 100 - |opinionA - opinionB|
 *         (same opinion → score near 100, opposite → score near -100)
 *
 *   Final = average of all topic scores.
 *
 * WHY this matters:
 *   topicCompatibility() is used at FIRST MEETING to seed the initial
 *   relationship score. Two gators who agree on everything start with
 *   a positive relationship; two who disagree on everything start negative.
 *   This creates emergent friend groups and enemy pairs without any
 *   hand-scripted drama.
 *
 * @param {Object} opinionsA - Topic opinion map from gator A.
 * @param {Object} opinionsB - Topic opinion map from gator B.
 * @returns {number} Compatibility score from -100 (totally opposed) to +100 (perfectly aligned).
 */
export function topicCompatibility(opinionsA, opinionsB) {
    const shared = Object.keys(opinionsA).filter(t => t in opinionsB);
    if (shared.length === 0) return 0;

    const total = shared.reduce((sum, t) => {
        if (t === 'sports_team') {
            return sum + _sportsTeamCompat(opinionsA[t], opinionsB[t]);
        }
        const diff = Math.abs(opinionsA[t] - opinionsB[t]); // 0–200
        return sum + (100 - diff); // maps to –100..100
    }, 0);

    return Math.round(total / shared.length);
}

/**
 * Private helper — sports team compatibility lookup table.
 *
 * DESIGN NOTE — why separate function?
 *   Sports team is a string, not a number, so it can't use the generic
 *   `100 - |a - b|` formula. This function encapsulates the special-case
 *   logic and is called by both topicCompatibility() (first-meeting seed)
 *   and applyTopicRelationDelta() (post-hosting nudge).
 *
 * SCORES:
 *   +80  Same team → strong bond ("We're both Rockets fans!")
 *   -10  Two local teams (Rockets vs Jets) → mild rivalry, still respected
 *   -60  One is a Chowda fan → local fans look down on out-of-towners
 *
 * @param {string} teamA - Team name for gator A.
 * @param {string} teamB - Team name for gator B.
 * @returns {number} Compatibility contribution for this topic.
 */
function _sportsTeamCompat(teamA, teamB) {
    if (teamA === teamB) return 80;                                // Both cheer for same team
    const chowda = teamA === 'Chowda' || teamB === 'Chowda';     // Out-of-towner present?
    return chowda ? -60 : -10;                                    // Chowda tension vs. local rivalry
}

/**
 * Apply a relation delta between two gators based on how their topic opinions aligned
 * during a hosting (private) conversation. Called by simulation.js AFTER a hosting
 * session ends, just before the guest leaves.
 *
 * WHY hosting-only?
 *   Regular street conversations use the generic driftRelations() function.
 *   Hosting is a deeper, longer interaction so it gets an additional structured
 *   topic-based bond/friction on top of the standard drift.
 *
 * ALGORITHM — four topics are scored independently, then summed:
 *   1. Sports team    → ±9 to ±12  (scaled by 0.15 from _sportsTeamCompat)
 *   2. Local gossip   → ±0 to ±8   (how similar their gossip-sharing values are)
 *   3. Swamp leadership → ±0 to ±10 (agree = positive, disagree = negative, scaled by strength)
 *   4. Fav. activity  → ±0 to ±6   (how similar their activity preferences are)
 *
 *   Total delta range: roughly -33 to +36 (though extreme values are rare).
 *   Delta is applied symmetrically to BOTH gators' relations and clamped to [-100, +100].
 *
 * SIDE EFFECT — returns a debug-friendly `reasons` array so the console can log
 *   why the relationship changed (e.g. "Both support the Rockets! (+12)").
 *
 * @param {object} a - First gator (Person object).
 * @param {object} b - Second gator (Person object).
 * @returns {{ delta: number, reasons: string[] }}
 */
export function applyTopicRelationDelta(a, b) {
    const ao = a.topicOpinions ?? {};
    const bo = b.topicOpinions ?? {};
    let delta = 0;
    const reasons = [];

    // Sports team
    if (ao.sports_team && bo.sports_team) {
        const sc = _sportsTeamCompat(ao.sports_team, bo.sports_team);
        const contribution = Math.round(sc * 0.15); // –9 to +12
        delta += contribution;
        if (ao.sports_team === bo.sports_team) {
            reasons.push(`Both support the ${ao.sports_team}! (+${contribution})`);
        } else if (ao.sports_team === 'Chowda' || bo.sports_team === 'Chowda') {
            const chowdaFan = ao.sports_team === 'Chowda' ? a.name : b.name;
            reasons.push(`${chowdaFan} is a Chowda fan — locals aren't impressed. (${contribution})`);
        } else {
            reasons.push(`${a.name} roots for ${ao.sports_team}, ${b.name} for ${bo.sports_team}. (${contribution})`);
        }
    }

    // Local gossip — sharing gossip is bonding if both are gossipy (high or low opinion values)
    if (ao.local_gossip !== undefined && bo.local_gossip !== undefined) {
        const diff = Math.abs(ao.local_gossip - bo.local_gossip);
        const contribution = Math.round((100 - diff) * 0.08); // –8 to +8
        delta += contribution;
        if (Math.abs(contribution) >= 3) {
            reasons.push(contribution >= 0
                ? `Enjoyed swapping gossip together. (+${contribution})`
                : `Disagreed about sharing gossip. (${contribution})`);
        }
    }

    // Swamp leadership — strong shared opinions bond; opposing split
    if (ao.swamp_leadership !== undefined && bo.swamp_leadership !== undefined) {
        const sameSign = Math.sign(ao.swamp_leadership) === Math.sign(bo.swamp_leadership);
        const strength = (Math.abs(ao.swamp_leadership) + Math.abs(bo.swamp_leadership)) / 2;
        const contribution = Math.round((sameSign ? 1 : -1) * strength * 0.1);
        delta += contribution;
        if (Math.abs(contribution) >= 3) {
            reasons.push(sameSign
                ? `Agree on swamp leadership. (+${contribution})`
                : `Disagree on swamp leadership. (${contribution})`);
        }
    }

    // Favorite swamp activity — shared passion bonds; indifference neutral
    if (ao.favorite_swamp_activity !== undefined && bo.favorite_swamp_activity !== undefined) {
        const diff = Math.abs(ao.favorite_swamp_activity - bo.favorite_swamp_activity);
        const contribution = Math.round((100 - diff) * 0.06); // –6 to +6
        delta += contribution;
        if (Math.abs(contribution) >= 3) {
            reasons.push(contribution >= 0
                ? `Share a love of swamp activities. (+${contribution})`
                : `Different tastes for swamp fun. (${contribution})`);
        }
    }

    // Apply to both gators, clamped
    a.relations[b.id] = Math.max(-100, Math.min(100, (a.relations[b.id] ?? 0) + delta));
    b.relations[a.id] = Math.max(-100, Math.min(100, (b.relations[a.id] ?? 0) + delta));
    a.perceivedRelations[b.id] = a.relations[b.id];
    b.perceivedRelations[a.id] = b.relations[a.id];

    return { delta, reasons };
}

/**
 * Builds a compact, human-readable sentence describing a gator's topic opinions.
 * Used as context injected into the AI system prompt so the LLM "knows" what
 * the alligator cares about before generating dialog.
 *
 * LABEL THRESHOLDS (numeric topics):
 *   ≥  60  → "loves"
 *   ≥  20  → "likes"
 *   ≥ -20  → "is neutral about"
 *   ≥ -60  → "dislikes"
 *   <  -60 → "hates"
 *
 * EXAMPLE output:
 *   "supports Rockets; likes local gossip; dislikes swamp leadership; loves swamp activities"
 *
 * @param {Object} opinions - topicOpinions map from a Person object.
 * @returns {string} Comma-separated summary sentence.
 */
export function topicOpinionSummary(opinions) {
    return Object.entries(opinions)
        .map(([topic, val]) => {
            if (topic === 'sports_team') return `supports ${val}`;
            const label = val >= 60 ? 'loves' : val >= 20 ? 'likes' : val >= -20 ? 'is neutral about' : val >= -60 ? 'dislikes' : 'hates';
            return `${label} ${topic.replace(/_/g, ' ')}`;
        })
        .join('; ');
}

/**
 * Picks a random element from a personality-bucketed lookup object.
 *
 * A "bucketed" object looks like:
 *   { cheerful: ['line A', 'line B'], grumpy: ['line C'], ... }
 *
 * If the exact personality key doesn't exist, it falls back to 'cheerful',
 * then to the first available key. This makes it safe to add new personalities
 * without needing to update every bucketed structure.
 *
 * Usage pattern in the codebase:
 *   const line = pickBucketed(REACTION_LINES, gator.personality);
 *
 * @param {Object} bucket - Personality-keyed object of arrays.
 * @param {string} personality - The gator's personality key.
 * @returns {*} A random element from the matching bucket.
 */
export function pickBucketed(bucket, personality) {
    const pool = bucket[personality] || bucket.cheerful || Object.values(bucket)[0];
    return pool[rnd(pool.length)];
}

// ── Real-time scheduling helpers ──────────────────────────────
// These functions replace the old tick-count timers with millisecond timestamps.
// Using Date.now() means timing is consistent regardless of tab focus or tick
// rate variability. Both functions introduce wide random variance (~50–150% of
// the base) to prevent multiple gators from thinking or speaking at exactly
// the same moment (the "thundering herd" problem for speech bubbles).

/**
 * Returns the number of milliseconds until this gator should generate their
 * next inner thought. Gators with a high thoughtStat think more frequently.
 *
 * FORMULA:
 *   base = 20,000 / max(1, thoughtStat)   → thoughtStat 10 ≈ 2,000ms, thoughtStat 1 ≈ 20,000ms
 *   result = max(1200, base * (0.5..1.5)) → at least 1.2 seconds; wide variance
 *
 * WHY 20,000 / thoughtStat?
 *   Inverse relationship: higher stat = shorter interval = thinks more often.
 *   Dividing by thoughtStat directly gives a smooth curve from
 *   "very rarely" (thoughtStat=1 → ~20s base) to "quite often" (thoughtStat=10 → ~2s base).
 *
 * @param {number} thoughtStat - Gator's perception/thought score (1–10).
 * @returns {number} Milliseconds until next thought.
 */
export function thoughtDelayMs(thoughtStat) {
    const base = Math.round(20000 / Math.max(1, thoughtStat));
    return Math.max(1200, Math.round(base * (0.5 + Math.random() * 1.0)));
}

/**
 * Returns the number of milliseconds until this gator can speak again during
 * a debate or free-speech moment. Higher socialStat = more frequent speaker.
 *
 * FORMULA:
 *   base = 12,000 / max(1, socialStat)   → socialStat 10 ≈ 1,200ms, socialStat 1 ≈ 12,000ms
 *   result = max(500, base * (0.45..1.55)) → at least 500ms; wide variance
 *
 * NOTE: speakDelayMs is currently only referenced by some debate path helpers.
 *   Full conversation turn-pacing is handled separately inside agentQueue.js
 *   (_drainNextConvTurn uses a hardcoded 2200–4000ms range).
 *
 * @param {number} socialStat - Gator's sociability score (1–10).
 * @returns {number} Milliseconds until this gator may speak again.
 */
export function speakDelayMs(socialStat) {
    const base = Math.round(12000 / Math.max(1, socialStat));
    return Math.max(500, Math.round(base * (0.45 + Math.random() * 1.1)));
}

// ── Bounds & distance ─────────────────────────────────────────

/**
 * Returns the usable pixel dimensions of the simulation stage (#world element).
 * Subtracts GATOR_SIZE from both dimensions so gators cannot walk off the edge —
 * their top-left corner is always fully inside the stage.
 *
 * Called every time a gator needs a new random target position or the resize
 * handler fires. Always reads live clientWidth/clientHeight so it stays accurate
 * after the browser window is resized.
 *
 * @returns {{ W: number, H: number }} Usable width and height in pixels.
 */
export function stageBounds() {
    const el = document.getElementById('world');
    return { W: el.clientWidth - GATOR_SIZE, H: el.clientHeight - GATOR_SIZE };
}

/**
 * Returns the pixel distance between the CENTRES of two gator elements.
 * Uses GATOR_SIZE/2 as the centre offset so the distance is measured from
 * the middle of each sprite, not the top-left corner.
 *
 * Used in the tick loop to check:
 *   - dist(a, b) <= TALK_DIST  → close enough to start talking
 *   - dist(a, b) <= TALK_STOP  → close enough to stop walking toward each other
 *   - dist(obs, speaker) <= TALK_DIST  → observer can overhear the speech
 *
 * @param {{x:number, y:number}} a - Gator A (any object with x and y).
 * @param {{x:number, y:number}} b - Gator B.
 * @returns {number} Distance in pixels.
 */
export function dist(a, b) {
    const cx = GATOR_SIZE / 2;
    const dx = (a.x+cx)-(b.x+cx), dy = (a.y+cx)-(b.y+cx);
    return Math.sqrt(dx*dx + dy*dy);
}

/**
 * Raw point-to-point distance (no GATOR_SIZE offset).
 * Used for layout geometry (e.g., checking distances between house positions
 * during culde-sac generation) where there is no sprite to centre.
 *
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {number} Euclidean distance.
 */
export function distPt(x1,y1,x2,y2) {
    return Math.sqrt((x1-x2)**2 + (y1-y2)**2);
}

// ── Weighted pick ─────────────────────────────────────────────
/**
 * Picks a random key from a weighted probability object.
 *
 * HOW IT WORKS (the "roulette wheel" algorithm):
 *   1. Sum all weights to get a total.
 *   2. Pick a random float R in [0, total).
 *   3. Walk through the entries, subtracting each weight from R.
 *   4. The first entry where R drops to ≤ 0 is the winner.
 *
 * EXAMPLE:
 *   weightedPick({ moving: 40, talking: 45, hosting: 15 })
 *   → "moving" ~40% of the time, "talking" ~45%, "hosting" ~15%
 *
 * This is used in the tick loop as:
 *   let next = weightedPick(socialWeights(gator));
 * to decide what a gator does after their current activity ends.
 *
 * FALLBACK: If floating-point rounding ever leaves R > 0 after all entries,
 * the first key is returned (prevents crash).
 *
 * @param {Object.<string, number>} weights - Key → weight number (any positive values; needn't sum to 100).
 * @returns {string} The chosen key.
 */
export function weightedPick(weights) {
    const e = Object.entries(weights);
    // Scale R across the total weight (weights don't need to sum to 100).
    let r = Math.random() * e.reduce((s,[,w]) => s+w, 0);
    for (const [k,w] of e) { r -= w; if (r <= 0) return k; }
    return e[0][0]; // Fallback: first key (floating-point safety net).
}

// ── Appearance ────────────────────────────────────────────────
/**
 * Generates the static appearance data for one alligator sprite.
 * Uses the slot index (0-based) so each gator always gets a DISTINCT
 * combination of skin tone, hat style, and shirt color — no two gators
 * look exactly alike.
 *
 * The returned object is stored on Person.appearance and read by
 * buildFigureSVG() to draw the SVG sprite.
 *
 * @param {number} index - Gator slot index (0 … GATOR_COUNT-1).
 * @returns {{ skinTone, hatStyle, hatColor, shirtColor, headSize, bodyHeight, legLength, armAngle }}
 */
export function randomAppearance(index) {
    // Wrap index so it's safe even if GATOR_COUNT > SKIN_TONES.length.
    const i = (index ?? rnd(SKIN_TONES.length)) % SKIN_TONES.length;
    return {
        skinTone:   SKIN_TONES[i],          // Base body/head color (green hue variants).
        hatStyle:   HAT_STYLES[i],          // Accessory type: tophat, crown, sunglasses, etc.
        hatColor:   hsl(),                  // Random bright accent color for the accessory.
        shirtColor: SHIRT_COLORS[i % SHIRT_COLORS.length], // Belly color (subtle tint).
        headSize:   14 + rnd(5),            // Head radius variation (14–18px).
        bodyHeight: 22 + rnd(8),            // Body ellipse height variation (22–29px).
        legLength:  18 + rnd(8),            // Leg line length (18–25px).
        armAngle:   20 + rnd(40),           // Arm tilt from horizontal (20–59°).
    };
}

/**
 * Generates the inline SVG string that renders one alligator as a small
 * cartoon sprite on the simulation canvas. Called by spawnGators() in
 * simulation.js when building the DOM element for each gator.
 *
 * The SVG is 60×58 pixels and includes:
 *   - Ripple rings (water effect behind the body)
 *   - Body ellipse + belly tint
 *   - Tail (cubic Bézier path)
 *   - Head ellipse + snout + nostrils
 *   - Eyes (yellow iris + dark pupil)
 *   - Legs (four short lines)
 *   - Teeth (two short vertical lines on the snout)
 *   - One unique accessory chosen by `appearance.hatStyle`
 *
 * Accessory types mapped to HAT_STYLES:
 *   tophat, sunglasses, wig, bowtie, crown, bandana, hornplate, spines, monocle, crest
 *
 * WHY inline SVG (not a PNG)?
 *   The gator color (bodyColor, hatColor) needs to be unique per gator.
 *   Inline SVG lets us set these colors dynamically from JavaScript without
 *   needing separate image files for every color combination.
 *
 * @param {object} p - Person object (reads p.appearance).
 * @returns {string} HTML string of an `<svg>` element.
 */
export function buildFigureSVG(p) {
    const a  = p.appearance;
    const cx = 30;
    const svgH = 58;
    const bodyColor = a.skinTone;
    const bellyColor = a.shirtColor;
    const hc = a.hatColor;

    // Water ripple rings around the gator to sell the "swimming" look
    const ripples = `
      <ellipse cx="${cx}" cy="30" rx="26" ry="7" fill="none" stroke="rgba(150,220,180,0.18)" stroke-width="1.2"/>
      <ellipse cx="${cx}" cy="30" rx="20" ry="5" fill="none" stroke="rgba(150,220,180,0.10)" stroke-width="0.8"/>`;

    // Unique accessory per slot
    let accessorySVG = '';
    switch (a.hatStyle) {
        case 'tophat':
            // Classic top hat sitting on the head
            accessorySVG = `
              <rect x="${cx+4}" y="2" width="14" height="9" rx="1" fill="${hc}" stroke="rgba(0,0,0,.4)" stroke-width=".8"/>
              <rect x="${cx+2}" y="10" width="18" height="3" rx="1" fill="${hc}" stroke="rgba(0,0,0,.3)" stroke-width=".6"/>`;
            break;
        case 'sunglasses':
            // Cool shades across the eyes
            accessorySVG = `
              <rect x="${cx+8}" y="12" width="8" height="5" rx="2" fill="#111" opacity=".85"/>
              <rect x="${cx+17}" y="12" width="7" height="5" rx="2" fill="#111" opacity=".85"/>
              <line x1="${cx+16}" y1="14" x2="${cx+17}" y2="14" stroke="#555" stroke-width="1"/>
              <line x1="${cx+8}" y1="14" x2="${cx+5}" y2="13" stroke="#555" stroke-width=".8"/>
              <line x1="${cx+24}" y1="14" x2="${cx+26}" y2="13" stroke="#555" stroke-width=".8"/>`;
            break;
        case 'wig':
            // Flowing curly wig
            accessorySVG = `
              <path d="M${cx+5},6 Q${cx+2},0 ${cx+8},3 Q${cx+10},-2 ${cx+14},3 Q${cx+18},-1 ${cx+22},3 Q${cx+26},0 ${cx+23},6" fill="${hc}" opacity=".9"/>
              <path d="M${cx+5},6 Q${cx+3},12 ${cx+5},16" fill="none" stroke="${hc}" stroke-width="3" stroke-linecap="round" opacity=".8"/>
              <path d="M${cx+23},6 Q${cx+25},12 ${cx+23},16" fill="none" stroke="${hc}" stroke-width="3" stroke-linecap="round" opacity=".8"/>`;
            break;
        case 'bowtie':
            // Dapper bowtie at the neck/chest
            accessorySVG = `
              <polygon points="${cx-2},28 ${cx+2},31 ${cx-2},34" fill="${hc}" opacity=".9"/>
              <polygon points="${cx+6},28 ${cx+2},31 ${cx+6},34" fill="${hc}" opacity=".9"/>
              <circle cx="${cx+2}" cy="31" r="2" fill="${hc}"/>`;
            break;
        case 'crown':
            // Regal crown
            accessorySVG = `
              <polygon points="${cx+7},11 ${cx+9},4 ${cx+13},9 ${cx+17},3 ${cx+21},9 ${cx+25},4 ${cx+27},11" fill="${hc}" stroke="rgba(0,0,0,.3)" stroke-width=".7"/>
              <rect x="${cx+7}" y="10" width="20" height="4" rx="1" fill="${hc}" stroke="rgba(0,0,0,.25)" stroke-width=".6"/>
              <circle cx="${cx+13}" cy="7" r="1.5" fill="#fff" opacity=".8"/>
              <circle cx="${cx+17}" cy="5" r="1.5" fill="#fff" opacity=".8"/>
              <circle cx="${cx+21}" cy="7" r="1.5" fill="#fff" opacity=".8"/>`;
            break;
        case 'bandana':
            // Rugged bandana tied around the head
            accessorySVG = `
              <path d="M${cx+6},8 Q${cx+14},4 ${cx+26},10 L${cx+26},16 Q${cx+14},12 ${cx+6},16 Z" fill="${hc}" opacity=".85"/>
              <circle cx="${cx+26}" cy="13" r="3" fill="${hc}" opacity=".85"/>
              <path d="M${cx+27},13 Q${cx+30},10 ${cx+28},16" fill="${hc}" opacity=".7"/>`;
            break;
        case 'hornplate':
            // Bony horn plate ridge
            accessorySVG = `
              <rect x="${cx+6}" y="4" width="16" height="6" rx="3" fill="${hc}" opacity=".8"/>
              <polygon points="${cx+8},4 ${cx+10},-1 ${cx+12},4" fill="${hc}" opacity=".7"/>
              <polygon points="${cx+13},4 ${cx+15},-2 ${cx+17},4" fill="${hc}" opacity=".7"/>
              <polygon points="${cx+18},4 ${cx+20},-1 ${cx+22},4" fill="${hc}" opacity=".7"/>`;
            break;
        case 'spines':
            // Spiky dorsal spines
            accessorySVG = `
              <polygon points="${cx+5},10 ${cx+7},2 ${cx+9},10" fill="${hc}" opacity=".85"/>
              <polygon points="${cx+11},10 ${cx+13},0 ${cx+15},10" fill="${hc}" opacity=".85"/>
              <polygon points="${cx+17},10 ${cx+19},3 ${cx+21},10" fill="${hc}" opacity=".85"/>
              <polygon points="${cx+23},10 ${cx+25},5 ${cx+27},10" fill="${hc}" opacity=".75"/>`;
            break;
        case 'monocle':
            // Sophisticated monocle over one eye
            accessorySVG = `
              <circle cx="${cx+18}" cy="14" r="4.5" fill="none" stroke="${hc}" stroke-width="1.5" opacity=".9"/>
              <line x1="${cx+22}" y1="17" x2="${cx+24}" y2="20" stroke="${hc}" stroke-width="1" opacity=".8"/>`;
            break;
        case 'crest':
        default:
            // Feathered crest
            accessorySVG = `
              <path d="M${cx+8},8 Q${cx+10},1 ${cx+14},6" fill="${hc}" opacity=".8"/>
              <path d="M${cx+12},7 Q${cx+14},-1 ${cx+18},5" fill="${hc}" opacity=".8"/>
              <path d="M${cx+16},8 Q${cx+18},2 ${cx+22},7" fill="${hc}" opacity=".75"/>`;
            break;
    }

    return `<svg class="figure" width="60" height="${svgH}" viewBox="0 0 60 ${svgH}">
      ${ripples}
      <!-- Body -->
      <ellipse cx="${cx}" cy="26" rx="19" ry="11" fill="${bodyColor}" stroke="rgba(0,0,0,.25)" stroke-width="1"/>
      <!-- Belly -->
      <ellipse cx="${cx}" cy="28" rx="13" ry="7" fill="${bellyColor}" opacity=".55"/>
      <!-- Tail -->
      <path d="M${cx-19},26 Q${cx-30},22 ${cx-28},32 Q${cx-26},40 ${cx-19},30" fill="${bodyColor}" stroke="rgba(0,0,0,.18)" stroke-width=".5"/>
      <!-- Head -->
      <ellipse cx="${cx+15}" cy="20" rx="11" ry="8" fill="${bodyColor}" stroke="rgba(0,0,0,.2)" stroke-width=".8"/>
      <!-- Snout -->
      <ellipse cx="${cx+24}" cy="21" rx="7" ry="4.5" fill="${bodyColor}"/>
      <!-- Nostrils -->
      <circle cx="${cx+27}" cy="19" r="1.2" fill="#1a1a1a"/>
      <circle cx="${cx+27}" cy="23" r="1.2" fill="#1a1a1a"/>
      <!-- Eyes -->
      <circle cx="${cx+13}" cy="15" r="3.5" fill="#d4c700" stroke="#333" stroke-width=".6"/>
      <circle cx="${cx+13}" cy="15" r="1.8" fill="#111"/>
      <circle cx="${cx+20}" cy="15" r="3" fill="#d4c700" stroke="#333" stroke-width=".5"/>
      <circle cx="${cx+20}" cy="15" r="1.5" fill="#111"/>
      <!-- Legs -->
      <line x1="${cx-8}" y1="34" x2="${cx-13}" y2="44" stroke="${bodyColor}" stroke-width="3.5" stroke-linecap="round"/>
      <line x1="${cx+8}" y1="34" x2="${cx+13}" y2="44" stroke="${bodyColor}" stroke-width="3.5" stroke-linecap="round"/>
      <line x1="${cx-3}" y1="34" x2="${cx-5}" y2="43" stroke="${bodyColor}" stroke-width="3" stroke-linecap="round"/>
      <line x1="${cx+3}" y1="34" x2="${cx+5}" y2="43" stroke="${bodyColor}" stroke-width="3" stroke-linecap="round"/>
      <!-- Teeth -->
      <line x1="${cx+22}" y1="24" x2="${cx+22}" y2="28" stroke="#f0f0d8" stroke-width="1.4" stroke-linecap="round"/>
      <line x1="${cx+25}" y1="24" x2="${cx+25}" y2="27.5" stroke="#f0f0d8" stroke-width="1.2" stroke-linecap="round"/>
      <!-- Accessory -->
      ${accessorySVG}
    </svg>`;
}

// ── Relationship helpers ──────────────────────────────────────
/**
 * Returns a human-readable tier label for a relationship score.
 * Used in rendering.js tooltips and the info panel to categorise
 * a numeric relation value into a word people understand.
 *
 * TIERS (match the colour-coding in the CSS):
 *   ≥  60  → 'love'    (strong bond, will defend each other)
 *   ≥  20  → 'like'    (friendly, cooperative)
 *   > -20  → 'neutral' (indifferent; could go either way)
 *   > -60  → 'dislike' (tense; may spread negative opinions)
 *   ≤ -60  → 'hate'    (will actively accuse; murderer prefers this range for victims)
 *
 * @param {number} val - Relation score from -100 to +100.
 * @returns {string} Tier label.
 */
export function relationTier(val) {
    if (val >= 60)  return 'love';
    if (val >= 20)  return 'like';
    if (val > -20)  return 'neutral';
    if (val > -60)  return 'dislike';
    return 'hate';
}

/**
 * Returns a CSS rgba color string for a relationship score.
 * Used to tint talk-lines, relation bars, and panel backgrounds.
 *
 *   ≥  30 → green  (positive)
 *   ≥ -30 → amber  (neutral)
 *   <  -30 → red   (negative)
 *
 * @param {number} avgVal - Average relation value between two gators.
 * @returns {string} CSS color string.
 */
export function relationColor(avgVal) {
    if (avgVal >= 30)  return 'rgba(76,175,80,.75)';
    if (avgVal >= -30) return 'rgba(255,193,7,.75)';
    return 'rgba(233,69,96,.75)';
}

/**
 * Returns a single emoji character representing a relation score at a glance.
 * Used in the gator tooltip to give players quick emotional context.
 *
 *   ≥  60 → ❤️  (loves)
 *   ≥  20 → 😊  (likes)
 *   > -20 → 😐  (neutral)
 *   > -60 → 😒  (dislikes)
 *   ≤ -60 → 😡  (hates)
 *
 * @param {number} val - Relation score from -100 to +100.
 * @returns {string} Emoji character.
 */
export function relationEmoji(val) {
    if (val >= 60)  return '\u2764\uFE0F';
    if (val >= 20)  return '\u{1F60A}';
    if (val > -20)  return '\u{1F610}';
    if (val > -60)  return '\u{1F612}';
    return '\u{1F621}';
}

/**
 * Returns a CSS hex color for a social need value.
 * Higher social need (gator wants interaction) = green.
 * Low social need (gator is saturated / introvert) = red.
 *
 * NOTE: Social need is currently tracked via the SocialStart/SocialDecay
 * constants but is not yet wired into the rendering pipeline.
 * This helper exists for future use or the stats panel.
 *
 * @param {number} need - Social need value 0–100.
 * @returns {string} CSS hex color.
 */
export function socialColor(need) {
    if (need >= 60) return '#4caf50';
    if (need >= 40) return '#ffc107';
    return '#e94560';
}

// ── Swamp layout ──────────────────────────────────────────────
/**
 * Calculates the positions of all gator home lilypads on the simulation stage.
 *
 * ALGORITHM — random scatter with collision avoidance:
 *   Each lilypad is placed at a random (x, y) subject to three constraints:
 *     1. MARGIN:   Must be at least (padR + 40) pixels from the stage edge.
 *     2. CENTRE:   Must be more than 110px from the centre (keeps the fish-market
 *                  area in the middle clear for debate and executions).
 *     3. MIN DIST: Must be at least (padR * 2.8) pixels from every OTHER pad
 *                  so they don't overlap.
 *
 *   Up to 4,000 random attempts are made. If a position satisfies all three
 *   constraints it is accepted; otherwise it is discarded and a new one is tried.
 *
 *   After the attempt loop, a grid-based FALLBACK fills any remaining slots
 *   in case the stage is too small for the random placer to find all N positions.
 *
 * DOOR POSITION:
 *   Each lilypad's "doorX/doorY" is the point on the pad's edge CLOSEST to
 *   the swamp centre. Gators walk to the door to enter/exit their home.
 *   Calculated as:  doorX = padCentreX + cos(angleToCenter) * (padR - 6)
 *                   doorY = padCentreY + sin(angleToCenter) * (padR - 6)
 *
 * RETURN VALUE:
 *   { cx, cy, radius:0, housePositions: [{x, y, doorX, doorY, angle}, ...] }
 *   cx/cy are the stage centre (used by buildCuldesacSVG to draw the centre feature).
 *   `radius` is kept as 0 for backward compatibility (was used in an old ring layout).
 *
 * This function is called at startup by spawnGators() and again whenever the
 * browser window is resized (so pads reposition correctly on mobile rotations, etc.).
 */
export function culdesacLayout() {
    const el = document.getElementById('world');
    const W  = el.clientWidth, H = el.clientHeight;
    const cx = W * 0.5, cy = H * 0.5;

    // These constants must stay in sync with the padR used in buildCuldesacSVG().
    const padR     = 62;           // Half the lilypad collision zone (matches SVG padR).
    const margin   = padR + 40;    // Keep pads away from the stage border.
    const minDist  = padR * 2.8;   // Minimum centre-to-centre gap between pads.
    const centreR  = 110;          // Dead-zone radius around the stage centre (fish market).

    const housePositions = [];
    let attempts = 0;

    // ── Random-scatter placement loop ─────────────────────────
    // Try up to 4,000 random positions; accept the first one that
    // passes all three constraints (margin, centre-clear, min-distance).
    while (housePositions.length < GATOR_COUNT && attempts < 4000) {
        attempts++;
        const x = margin + Math.random() * (W - margin * 2);
        const y = margin + Math.random() * (H - margin * 2);
        const dx = x - cx, dy = y - cy;
        // Constraint 2: Must not be inside the centre dead zone.
        if (Math.sqrt(dx*dx + dy*dy) < centreR) continue;
        // Constraint 3: Must be far enough from every already-placed pad.
        let ok = true;
        for (const h of housePositions) {
            const ddx = x - h.x, ddy = y - h.y;
            if (Math.sqrt(ddx*ddx + ddy*ddy) < minDist) { ok = false; break; }
        }
        if (ok) {
            // Calculate the "door" as the point on the pad rim facing inward.
            const ang = Math.atan2(cy - y, cx - x);
            housePositions.push({
                x, y,
                doorX: x + Math.cos(ang) * (padR - 6),
                doorY: y + Math.sin(ang) * (padR - 6),
                angle: ang  // Stored so buildCuldesacSVG can tilt decorations outward.
            });
        }
    }

    // ── Fallback: grid-fill remaining slots ───────────────────
    // This runs only if the stage is very small and the random placer
    // exhausted its attempts without filling all GATOR_COUNT slots.
    while (housePositions.length < GATOR_COUNT) {
        const idx = housePositions.length;
        const gx = margin + (idx % 4) * ((W - margin*2) / 3);
        const gy = margin + Math.floor(idx / 4) * ((H - margin*2) / 2.5);
        const ang = Math.atan2(cy - gy, cx - gx);
        housePositions.push({ x: gx, y: gy, doorX: gx + Math.cos(ang)*(padR-6), doorY: gy + Math.sin(ang)*(padR-6), angle: ang });
    }

    return { cx, cy, radius: 0, housePositions };
}

/**
 * Generates the full static background SVG for the simulation stage.
 *
 * This SVG is inserted into the DOM as `<svg id="culdesac">` at the very
 * bottom of the z-stack (z-index:0). It is purely decorative — no
 * pointer events, no game logic. Everything in it is drawn in layer order:
 *
 *   Layer 1 — Depth gradient rect (makes the swamp feel deep)
 *   Layer 2 — Murk patches (dark ellipses for deep-water areas)
 *   Layer 3 — Reed clusters (cattails along the edges)
 *   Layer 4 — Floating logs (detailed with grain lines, shadow, water ring)
 *   Layer 5 — Mini lilypads (scattered decorative pads, not interactive)
 *   Layer 6 — Interactive home lilypads (one per gator; with flower and glow halo)
 *
 * SEEDED PSEUDO-RANDOM (`sr()`):
 *   Non-home decorations (logs, reeds, mini pads) use a seeded LCG so that
 *   their positions remain STABLE across resize events. Without seeding,
 *   every window resize would regenerate random positions and the scene
 *   would "flash" into a new layout. With seeding it re-draws identically.
 *
 * @param {{ cx:number, cy:number, housePositions: object[] }} layout - From culdesacLayout().
 * @returns {string} HTML string of the full `<svg id="culdesac">` element.
 */
export function buildCuldesacSVG(layout) {
    const el = document.getElementById('world');
    const W  = el.clientWidth, H = el.clientHeight;
    const { cx, cy } = layout;

    // ── Seeded pseudo-random for stable decorations on resize ──
    let seed = 42;
    const sr = () => { seed = (seed * 16807 + 0) % 2147483647; return (seed - 1) / 2147483646; };

    // ── Depth / murk patches ───────────────────────────────────
    const murkPatches = [
        [cx*0.18, cy*0.22, W*0.14, H*0.10, 0.38],
        [cx*1.75, cy*0.30, W*0.10, H*0.08, 0.32],
        [cx*0.30, cy*1.60, W*0.12, H*0.09, 0.28],
        [cx*1.55, cy*1.65, W*0.15, H*0.11, 0.35],
        [cx*0.85, cy*0.55, W*0.08, H*0.07, 0.20],
        [cx*1.20, cy*1.35, W*0.09, H*0.07, 0.22],
    ].map(([x,y,rx,ry,op]) =>
        `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#081810" opacity="${op}"/>`
    ).join('');

    // ── Floating logs ──────────────────────────────────────────
    const logDefs = [
        { x: cx*0.22, y: cy*0.35, len: 110, w: 18, rot: -18 },
        { x: cx*1.60, y: cy*0.55, len: 95,  w: 14, rot: 22  },
        { x: cx*0.40, y: cy*1.55, len: 130, w: 20, rot: 5   },
        { x: cx*1.50, y: cy*1.40, len: 90,  w: 16, rot: -30 },
        { x: cx*0.75, y: cy*1.15, len: 75,  w: 13, rot: 55  },
        { x: cx*1.30, y: cy*0.75, len: 80,  w: 12, rot: -8  },
    ];
    const logs = logDefs.map(({ x, y, len, w, rot }) => {
        const hw = len / 2;
        // log body with grain lines
        const grainCount = Math.floor(len / 18);
        let grains = '';
        for (let g = 0; g < grainCount; g++) {
            const gx = -hw + (g + 0.5) * (len / grainCount);
            grains += `<line x1="${gx}" y1="${-w*0.25}" x2="${gx}" y2="${w*0.25}" stroke="rgba(0,0,0,.18)" stroke-width=".7"/>`;
        }
        return `<g transform="translate(${x},${y}) rotate(${rot})">
          <!-- Log shadow -->
          <ellipse cx="3" cy="${w*0.6}" rx="${hw*0.92}" ry="${w*0.35}" fill="rgba(0,0,0,.22)"/>
          <!-- Log body -->
          <rect x="${-hw}" y="${-w/2}" width="${len}" height="${w}" rx="${w/2}" fill="#5a3a18" stroke="#3a2210" stroke-width="1"/>
          <!-- Bark texture overlay -->
          <rect x="${-hw+4}" y="${-w/2+2}" width="${len-8}" height="${w-4}" rx="${w/2-1}" fill="#6b4820" opacity=".55"/>
          ${grains}
          <!-- End caps -->
          <ellipse cx="${-hw}" cy="0" rx="${w*0.32}" ry="${w/2}" fill="#4a2e10"/>
          <ellipse cx="${hw}"  cy="0" rx="${w*0.32}" ry="${w/2}" fill="#4a2e10"/>
          <!-- Water shimmer around log -->
          <ellipse cx="0" cy="${w*0.55}" rx="${hw*0.85}" ry="${w*0.28}" fill="none" stroke="rgba(80,160,100,.15)" stroke-width="1.2"/>
        </g>`;
    }).join('');

    // ── Reed clusters ──────────────────────────────────────────
    const reedSpots = [
        [cx*0.05, cy*0.10], [cx*1.85, cy*0.12], [cx*1.90, cy*1.75],
        [cx*0.08, cy*1.80], [cx*0.55, cy*0.08], [cx*1.40, cy*1.90],
        [cx*0.10, cy*0.90], [cx*1.88, cy*0.90], [cx*0.90, cy*1.92],
    ];
    const reeds = reedSpots.map(([rx, ry]) => {
        let stalks = '';
        const count = 5 + Math.floor(sr() * 5);
        for (let r = 0; r < count; r++) {
            const ox = (sr() - 0.5) * 38;
            const oy = (sr() - 0.5) * 22;
            const h  = 28 + sr() * 28;
            const sw = 1 + sr() * 1.2;
            const lean = (sr() - 0.5) * 14;
            stalks += `<line x1="${rx+ox}" y1="${ry+oy}" x2="${rx+ox+lean}" y2="${ry+oy-h}" stroke="#4a5e1a" stroke-width="${sw}" stroke-linecap="round"/>`;
            // Reed head (cattail)
            stalks += `<ellipse cx="${rx+ox+lean}" cy="${ry+oy-h}" rx="2.2" ry="5" fill="#7a4a18" opacity=".85"/>`;
        }
        return stalks;
    }).join('');

    // ── Decorative mini-lilypads scattered around ──────────────
    const miniPadPositions = [];
    for (let m = 0; m < 22; m++) {
        const px = 30 + sr() * (W - 60);
        const py = 30 + sr() * (H - 60);
        // Keep mini-pads away from interactive pad positions
        let clash = false;
        for (const h of layout.housePositions) {
            const ddx = px - h.x, ddy = py - h.y;
            if (Math.sqrt(ddx*ddx + ddy*ddy) < 100) { clash = true; break; }
        }
        if (!clash) miniPadPositions.push([px, py, 8 + sr()*12, sr()*360]);
    }
    const miniPads = miniPadPositions.map(([px, py, r, ang]) => {
        const green = `hsl(${110 + sr()*30},${35+sr()*20}%,${18+sr()*12}%)`;
        const trim  = `hsl(${120 + sr()*25},${30+sr()*15}%,${26+sr()*10}%)`;
        return `<g transform="translate(${px},${py}) rotate(${ang})">
          <ellipse cx="0" cy="0" rx="${r}" ry="${r*0.72}" fill="${green}" stroke="${trim}" stroke-width=".7" opacity=".75"/>
          <line x1="0" y1="0" x2="0" y2="${-r*0.68}" stroke="${trim}" stroke-width=".5" opacity=".4"/>
          <path d="M-1.5,0 L0,${-r*0.68} L1.5,0" fill="rgba(5,15,5,0.5)"/>
        </g>`;
    }).join('');

    // ── Interactive lilypads (homes) ───────────────────────────
    const padR = 62;
    let houseSVGs = '';
    for (let i = 0; i < layout.housePositions.length; i++) {
        const h  = layout.housePositions[i];
        const c  = HOUSE_COLORS[i % HOUSE_COLORS.length];
        // Bloom colour shifts per pad
        const bloomHue = 280 + (i * 37) % 140;
        const glowColor = `hsl(${bloomHue},70%,55%)`;
        houseSVGs += `
        <g transform="translate(${h.x},${h.y})">
          <!-- Glow halo — makes the home lilypad stand out -->
          <ellipse cx="0" cy="0" rx="${padR+18}" ry="${(padR+18)*0.72}" fill="none" stroke="${glowColor}" stroke-width="3.5" opacity="0.32"/>
          <ellipse cx="0" cy="0" rx="${padR+10}" ry="${(padR+10)*0.72}" fill="none" stroke="${glowColor}" stroke-width="2.2" opacity="0.22"/>
          <!-- Pad shadow -->
          <ellipse cx="4" cy="8" rx="${padR*0.90}" ry="${padR*0.62}" fill="rgba(0,0,0,.35)"/>
          <!-- Pad body — brighter, more saturated green -->
          <ellipse cx="0" cy="0" rx="${padR}" ry="${padR*0.72}" fill="${c.wall}" stroke="${c.roof}" stroke-width="2.5" opacity=".95"/>
          <!-- Inner lighter ring -->
          <ellipse cx="0" cy="0" rx="${padR*0.70}" ry="${padR*0.50}" fill="none" stroke="${c.trim}" stroke-width="1.2" opacity=".45"/>
          <!-- Vein lines -->
          <line x1="0" y1="0" x2="0" y2="${-padR*0.68}" stroke="${c.trim}" stroke-width="1.3" opacity=".65"/>
          <line x1="0" y1="0" x2="${padR*0.60}" y2="${-padR*0.40}" stroke="${c.trim}" stroke-width=".9" opacity=".55"/>
          <line x1="0" y1="0" x2="${-padR*0.60}" y2="${-padR*0.40}" stroke="${c.trim}" stroke-width=".9" opacity=".55"/>
          <line x1="0" y1="0" x2="${padR*0.68}" y2="${padR*0.22}" stroke="${c.trim}" stroke-width=".7" opacity=".38"/>
          <line x1="0" y1="0" x2="${-padR*0.68}" y2="${padR*0.22}" stroke="${c.trim}" stroke-width=".7" opacity=".38"/>
          <line x1="0" y1="0" x2="${padR*0.40}" y2="${padR*0.56}" stroke="${c.trim}" stroke-width=".6" opacity=".28"/>
          <line x1="0" y1="0" x2="${-padR*0.40}" y2="${padR*0.56}" stroke="${c.trim}" stroke-width=".6" opacity=".28"/>
          <!-- Notch -->
          <path d="M-4,0 L0,${-padR*0.68} L4,0" fill="#0a1a0a" opacity=".75"/>
          <!-- Water-ring highlight -->
          <ellipse cx="0" cy="0" rx="${padR+6}" ry="${padR*0.72+4}" fill="none" stroke="rgba(140,220,160,.18)" stroke-width="2"/>
          <!-- Flower — 5 petals + centre -->
          <g transform="translate(${padR*0.38},${-padR*0.28})">
            <circle cx="0" cy="0" r="8" fill="hsl(${bloomHue},65%,50%)" opacity=".90" stroke="rgba(255,255,255,.3)" stroke-width="1"/>
            <circle cx="0" cy="-6" r="3.5" fill="hsl(${bloomHue},60%,65%)" opacity=".85"/>
            <circle cx="5.7" cy="-1.9" r="3.5" fill="hsl(${bloomHue},60%,65%)" opacity=".85"/>
            <circle cx="3.5" cy="5" r="3.5" fill="hsl(${bloomHue},60%,65%)" opacity=".85"/>
            <circle cx="-3.5" cy="5" r="3.5" fill="hsl(${bloomHue},60%,65%)" opacity=".85"/>
            <circle cx="-5.7" cy="-1.9" r="3.5" fill="hsl(${bloomHue},60%,65%)" opacity=".85"/>
            <circle cx="0" cy="0" r="3" fill="hsl(${bloomHue+30},75%,80%)" opacity=".95"/>
          </g>
        </g>`;
    }

    return `<svg id="culdesac" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
      <!-- Deep water base handled by CSS; add subtle depth gradient -->
      <defs>
        <radialGradient id="swampDepth" cx="50%" cy="50%" r="70%">
          <stop offset="0%"   stop-color="#122818" stop-opacity="0"/>
          <stop offset="100%" stop-color="#050f08" stop-opacity="0.55"/>
        </radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#swampDepth)"/>
      ${murkPatches}
      ${reeds}
      ${logs}
      ${miniPads}
      ${houseSVGs}
    </svg>`;
}

