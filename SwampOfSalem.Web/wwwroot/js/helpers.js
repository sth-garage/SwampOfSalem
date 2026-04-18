import {
    GATOR_SIZE, GATOR_COUNT, PERSONALITIES, ACTIVITY_TICKS, WALK_SPEED,
    SKIN_TONES, HAT_STYLES, SHIRT_COLORS, HOUSE_COLORS, NAMES,
    PERSONALITY_EMOJI
} from './gameConfig.js';

// ── Random helpers ────────────────────────────────────────────
export const rnd  = n => Math.floor(Math.random() * n);
export const rndF = n => Math.random() * n;
export const hsl  = () => `hsl(${rnd(360)},${55+rnd(30)}%,${45+rnd(20)}%)`;
export const rndTicks = a => { const [mn,mx] = ACTIVITY_TICKS[a]; return mn + rnd(mx-mn+1); };


// ── Topics & opinions ─────────────────────────────────────────
// All alligators are given opinions on a random subset of these swamp topics.
// Opinions are -100 (strongly disagree/dislike) to +100 (strongly agree/like).
export const TOPICS = [
    'mud wallowing',
    'fish tacos',
    'loud splashing',
    'sharing territory',
    'napping in sunbeams',
    'strangers near the nest',
    'hunting at dawn',
    'swamp gossip',
    'sunbathing on rocks',
    'trusting outsiders',
    'long swims',
    'tall grass hiding spots',
    'the old ways',
    'new arrivals in the swamp',
    'cooperation over competition',
    'hoarding fish',
    'loud singing at night',
    'clean water vs murky water',
    'settling disputes with a duel',
];

/**
 * Generate a random opinion set for a new alligator.
 * Returns an object: { topic: opinionValue, ... }
 * Picks 6–10 topics; opinions are personality-influenced.
 * @param {string} personality
 * @returns {Object.<string,number>}
 */
export function generateTopicOpinions(personality) {
    const count = 6 + rnd(5); // 6–10 topics
    const shuffled = [...TOPICS].sort(() => Math.random() - 0.5).slice(0, count);
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

    for (const topic of shuffled) {
        // Raw random –100..100, shifted by personality bias, clamped
        const raw = (Math.random() * 200 - 100) + bias * (0.5 + Math.random() * 0.5);
        opinions[topic] = Math.max(-100, Math.min(100, Math.round(raw)));
    }
    return opinions;
}

/**
 * Compute a compatibility score [-100, 100] between two alligators based on
 * shared topic opinions.  Topics only in one alligator's set are ignored.
 * @param {Object.<string,number>} opinionsA
 * @param {Object.<string,number>} opinionsB
 * @returns {number}
 */
export function topicCompatibility(opinionsA, opinionsB) {
    const shared = Object.keys(opinionsA).filter(t => t in opinionsB);
    if (shared.length === 0) return 0;

    const total = shared.reduce((sum, t) => {
        // –100 if diametrically opposed, +100 if identical
        const diff = Math.abs(opinionsA[t] - opinionsB[t]); // 0–200
        return sum + (100 - diff); // maps to –100..100
    }, 0);

    return Math.round(total / shared.length);
}

/**
 * Build a human-readable summary of an alligator's topic opinions for the AI.
 * @param {Object.<string,number>} opinions
 * @returns {string}
 */
export function topicOpinionSummary(opinions) {
    return Object.entries(opinions)
        .map(([topic, val]) => {
            const label = val >= 60 ? 'loves' : val >= 20 ? 'likes' : val >= -20 ? 'is neutral about' : val >= -60 ? 'dislikes' : 'hates';
            return `${label} ${topic}`;
        })
        .join('; ');
}

// Pick from a personality-bucketed object: { cheerful:[...], grumpy:[...], ... }
export function pickBucketed(bucket, personality) {
    const pool = bucket[personality] || bucket.cheerful || Object.values(bucket)[0];
    return pool[rnd(pool.length)];
}

// ── Real-time scheduling helpers ──────────────────────────────
// Returns ms until this gator's next thought update.
// Higher thoughtStat → shorter interval; wide variance prevents sync.
export function thoughtDelayMs(thoughtStat) {
    const base = Math.round(20000 / Math.max(1, thoughtStat));
    return Math.max(1200, Math.round(base * (0.5 + Math.random() * 1.0)));
}

// Returns ms until this gator can send their next speech line.
// Higher socialStat → shorter cooldown; wide variance prevents sync.
export function speakDelayMs(socialStat) {
    const base = Math.round(12000 / Math.max(1, socialStat));
    return Math.max(500, Math.round(base * (0.45 + Math.random() * 1.1)));
}

// ── Bounds & distance ─────────────────────────────────────────
export function stageBounds() {
    const el = document.getElementById('world');
    return { W: el.clientWidth - GATOR_SIZE, H: el.clientHeight - GATOR_SIZE };
}

export function dist(a, b) {
    const cx = GATOR_SIZE / 2;
    const dx = (a.x+cx)-(b.x+cx), dy = (a.y+cx)-(b.y+cx);
    return Math.sqrt(dx*dx + dy*dy);
}

export function distPt(x1,y1,x2,y2) {
    return Math.sqrt((x1-x2)**2 + (y1-y2)**2);
}

// ── Weighted pick ─────────────────────────────────────────────
export function weightedPick(weights) {
    const e = Object.entries(weights);
    let r = Math.random() * e.reduce((s,[,w]) => s+w, 0);
    for (const [k,w] of e) { r -= w; if (r <= 0) return k; }
    return e[0][0];
}

// ── Appearance ────────────────────────────────────────────────
// index-based so every gator gets a unique color + accessory
export function randomAppearance(index) {
    const i = (index ?? rnd(SKIN_TONES.length)) % SKIN_TONES.length;
    return {
        skinTone:   SKIN_TONES[i],
        hatStyle:   HAT_STYLES[i],
        hatColor:   hsl(),
        shirtColor: SHIRT_COLORS[i % SHIRT_COLORS.length],
        headSize:   14 + rnd(5),
        bodyHeight: 22 + rnd(8),
        legLength:  18 + rnd(8),
        armAngle:   20 + rnd(40),
    };
}

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
export function relationTier(val) {
    if (val >= 60)  return 'love';
    if (val >= 20)  return 'like';
    if (val > -20)  return 'neutral';
    if (val > -60)  return 'dislike';
    return 'hate';
}


export function relationColor(avgVal) {
    if (avgVal >= 30)  return 'rgba(76,175,80,.75)';
    if (avgVal >= -30) return 'rgba(255,193,7,.75)';
    return 'rgba(233,69,96,.75)';
}

export function relationEmoji(val) {
    if (val >= 60)  return '\u2764\uFE0F';
    if (val >= 20)  return '\u{1F60A}';
    if (val > -20)  return '\u{1F610}';
    if (val > -60)  return '\u{1F612}';
    return '\u{1F621}';
}

export function socialColor(need) {
    if (need >= 60) return '#4caf50';
    if (need >= 40) return '#ffc107';
    return '#e94560';
}

// ── Swamp layout ────────────────────────────────────────
export function culdesacLayout() {
    const el = document.getElementById('world');
    const W  = el.clientWidth, H = el.clientHeight;
    const cx = W * 0.5, cy = H * 0.5;

    // Scatter lilypads across the whole screen, avoiding the centre (fish market) and edges
    const padR     = 62;           // half the pad collision zone (matches SVG padR)
    const margin   = padR + 40;    // keep pads away from edges
    const minDist  = padR * 2.8;   // minimum distance between pad centres
    const centreR  = 110;          // clear zone around the central fish market

    const housePositions = [];
    let attempts = 0;
    while (housePositions.length < GATOR_COUNT && attempts < 4000) {
        attempts++;
        const x = margin + Math.random() * (W - margin * 2);
        const y = margin + Math.random() * (H - margin * 2);
        const dx = x - cx, dy = y - cy;
        if (Math.sqrt(dx*dx + dy*dy) < centreR) continue;
        let ok = true;
        for (const h of housePositions) {
            const ddx = x - h.x, ddy = y - h.y;
            if (Math.sqrt(ddx*ddx + ddy*ddy) < minDist) { ok = false; break; }
        }
        if (ok) {
            // doorX/doorY = the edge of the pad closest to the swamp centre
            const ang = Math.atan2(cy - y, cx - x);
            housePositions.push({
                x, y,
                doorX: x + Math.cos(ang) * (padR - 6),
                doorY: y + Math.sin(ang) * (padR - 6),
                angle: ang
            });
        }
    }
        // Fallback: fill any remaining slots in a grid-ish scatter
    while (housePositions.length < GATOR_COUNT) {
        const idx = housePositions.length;
        const gx = margin + (idx % 4) * ((W - margin*2) / 3);
        const gy = margin + Math.floor(idx / 4) * ((H - margin*2) / 2.5);
        const ang = Math.atan2(cy - gy, cx - gx);
        housePositions.push({ x: gx, y: gy, doorX: gx + Math.cos(ang)*(padR-6), doorY: gy + Math.sin(ang)*(padR-6), angle: ang });
    }

    return { cx, cy, radius: 0, housePositions };
}

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

