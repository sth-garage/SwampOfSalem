import {
    PERSON_SIZE, PEOPLE_COUNT, PERSONALITIES, ACTIVITY_TICKS, WALK_SPEED,
    SOCIAL_START, DIALOGUE, INVITE_LINES, THOUGHTS, RELATION_THOUGHTS,
    SKIN_TONES, HAT_STYLES, SHIRT_COLORS, HOUSE_COLORS, NAMES,
    PERSONALITY_EMOJI
} from './constants.js';

// ── Random helpers ────────────────────────────────────────────
export const rnd  = n => Math.floor(Math.random() * n);
export const rndF = n => Math.random() * n;
export const hsl  = () => `hsl(${rnd(360)},${55+rnd(30)}%,${45+rnd(20)}%)`;
export const rndTicks = a => { const [mn,mx] = ACTIVITY_TICKS[a]; return mn + rnd(mx-mn+1); };

export const pickMessage = p => { const d = DIALOGUE[p]; return d[rnd(d.length)]; };
export const pickInvite  = ()  => INVITE_LINES[rnd(INVITE_LINES.length)];
export const pickThought = p => { const t = THOUGHTS[p]; return t[rnd(t.length)]; };

// Pick from a personality-bucketed object: { cheerful:[...], grumpy:[...], ... }
export function pickBucketed(bucket, personality) {
    const pool = bucket[personality] || bucket.cheerful || Object.values(bucket)[0];
    return pool[rnd(pool.length)];
}

// ── Real-time scheduling helpers ──────────────────────────────
// Returns ms until this person's next thought update.
// Higher thoughtStat → shorter interval; wide variance prevents sync.
export function thoughtDelayMs(thoughtStat) {
    const base = Math.round(20000 / Math.max(1, thoughtStat));
    return Math.max(1200, Math.round(base * (0.5 + Math.random() * 1.0)));
}

// Returns ms until this person can send their next speech line.
// Higher socialStat → shorter cooldown; wide variance prevents sync.
export function speakDelayMs(socialStat) {
    const base = Math.round(12000 / Math.max(1, socialStat));
    return Math.max(500, Math.round(base * (0.45 + Math.random() * 1.1)));
}

// ── Bounds & distance ─────────────────────────────────────────
export function stageBounds() {
    const el = document.getElementById('world');
    return { W: el.clientWidth - PERSON_SIZE, H: el.clientHeight - PERSON_SIZE };
}

export function dist(a, b) {
    const cx = PERSON_SIZE / 2;
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
export function randomAppearance() {
    return {
        skinTone:   SKIN_TONES[rnd(SKIN_TONES.length)],
        hatStyle:   HAT_STYLES[rnd(HAT_STYLES.length)],
        hatColor:   hsl(),
        shirtColor: SHIRT_COLORS[rnd(SHIRT_COLORS.length)],
        headSize:   14 + rnd(5),
        bodyHeight: 22 + rnd(8),
        legLength:  18 + rnd(8),
        armAngle:   20 + rnd(40),
    };
}

export function buildFigureSVG(p) {
    const a  = p.appearance;
    const cx = 30;
    const svgH = 50;
    const bodyColor = a.skinTone;
    const bellyColor = a.shirtColor;
    // Scale patterns based on hat style
    let featureSVG = '';
    if (a.hatStyle === 'hornplate') {
        featureSVG = `<rect x="${cx-8}" y="4" width="16" height="6" rx="3" fill="${a.hatColor}" opacity=".7"/>`;
    } else if (a.hatStyle === 'spines') {
        featureSVG = `<polygon points="${cx-6},8 ${cx-3},2 ${cx},8 ${cx+3},2 ${cx+6},8" fill="${a.hatColor}" opacity=".8"/>`;
    } else if (a.hatStyle === 'scarscar') {
        featureSVG = `<line x1="${cx-4}" y1="10" x2="${cx+4}" y2="6" stroke="#c0392b" stroke-width="1.5" opacity=".7"/>`;
    } else if (a.hatStyle === 'crest') {
        featureSVG = `<path d="M${cx-5},6 Q${cx},0 ${cx+5},6" fill="${a.hatColor}" opacity=".75"/>`;
    }

    return `<svg class="figure" width="60" height="${svgH}" viewBox="0 0 60 ${svgH}">
      <!-- Body -->
      <ellipse cx="${cx}" cy="24" rx="18" ry="10" fill="${bodyColor}" stroke="rgba(0,0,0,.2)" stroke-width="1"/>
      <!-- Belly -->
      <ellipse cx="${cx}" cy="26" rx="12" ry="6" fill="${bellyColor}" opacity=".6"/>
      <!-- Head -->
      <ellipse cx="${cx+14}" cy="18" rx="10" ry="7" fill="${bodyColor}" stroke="rgba(0,0,0,.15)" stroke-width=".8"/>
      <!-- Snout -->
      <ellipse cx="${cx+22}" cy="19" rx="6" ry="4" fill="${bodyColor}"/>
      <!-- Nostrils -->
      <circle cx="${cx+25}" cy="17" r="1" fill="#222"/>
      <circle cx="${cx+25}" cy="21" r="1" fill="#222"/>
      <!-- Eyes -->
      <circle cx="${cx+12}" cy="14" r="3" fill="#ff0" stroke="#333" stroke-width=".5"/>
      <circle cx="${cx+12}" cy="14" r="1.5" fill="#222"/>
      <circle cx="${cx+18}" cy="14" r="2.5" fill="#ff0" stroke="#333" stroke-width=".5"/>
      <circle cx="${cx+18}" cy="14" r="1.2" fill="#222"/>
      <!-- Tail -->
      <path d="M${cx-18},24 Q${cx-28},20 ${cx-26},30 Q${cx-24},36 ${cx-18},28" fill="${bodyColor}" stroke="rgba(0,0,0,.15)" stroke-width=".5"/>
      <!-- Legs -->
      <line x1="${cx-8}" y1="32" x2="${cx-12}" y2="42" stroke="${bodyColor}" stroke-width="3" stroke-linecap="round"/>
      <line x1="${cx+8}" y1="32" x2="${cx+12}" y2="42" stroke="${bodyColor}" stroke-width="3" stroke-linecap="round"/>
      <line x1="${cx-4}" y1="32" x2="${cx-6}" y2="40" stroke="${bodyColor}" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="${cx+4}" y1="32" x2="${cx+6}" y2="40" stroke="${bodyColor}" stroke-width="2.5" stroke-linecap="round"/>
      <!-- Teeth -->
      <line x1="${cx+20}" y1="22" x2="${cx+20}" y2="25" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="${cx+23}" y1="22" x2="${cx+23}" y2="24.5" stroke="#fff" stroke-width="1" stroke-linecap="round"/>
      ${featureSVG}
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

export function pickRelationThought(val) {
    const pool = RELATION_THOUGHTS[relationTier(val)];
    return pool[rnd(pool.length)];
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
    const radius = Math.min(W, H) * 0.34;
    const houseR = radius + 72;

    const housePositions = [];
    for (let i = 0; i < PEOPLE_COUNT; i++) {
        const angle = (i / PEOPLE_COUNT) * Math.PI * 2 - Math.PI / 2;
        const hx = cx + Math.cos(angle) * houseR;
        const hy = cy + Math.sin(angle) * houseR;
        const doorX = hx + Math.cos(angle + Math.PI) * 36;
        const doorY = hy + Math.sin(angle + Math.PI) * 36;
        housePositions.push({ x: hx, y: hy, doorX, doorY, angle });
    }
    // Fruit store sits in the centre of the cul-de-sac park
    const storeCX = cx;
    const storeCY = cy - 10;
    const storeDoorX = storeCX;
    const storeDoorY = storeCY + 26;
    return { cx, cy, radius, housePositions, storeCX, storeCY, storeDoorX, storeDoorY };
}

export function buildCuldesacSVG(layout) {
    const el = document.getElementById('world');
    const W  = el.clientWidth, H = el.clientHeight;
    const { cx, cy, radius } = layout;
    const roadW = 44;

    let driveways = '';
    for (const h of layout.housePositions) {
        const rx = cx + Math.cos(h.angle + Math.PI) * radius;
        const ry = cy + Math.sin(h.angle + Math.PI) * radius;
        driveways += `<line x1="${h.doorX}" y1="${h.doorY}" x2="${rx}" y2="${ry}"
            stroke="#1a3a20" stroke-width="14" stroke-linecap="round" opacity=".45"/>`;
    }

    let houseSVGs = '';
    for (let i = 0; i < layout.housePositions.length; i++) {
        const h  = layout.housePositions[i];
        const c  = HOUSE_COLORS[i % HOUSE_COLORS.length];
        const padR = 28;
        const deg = (h.angle * 180 / Math.PI) + 90;
        houseSVGs += `
        <g transform="translate(${h.x},${h.y})">
          <!-- Lilypad -->
          <ellipse cx="0" cy="0" rx="${padR}" ry="${padR*0.75}" fill="${c.wall}" stroke="${c.roof}" stroke-width="1.5"/>
          <!-- Lilypad vein lines -->
          <line x1="0" y1="0" x2="0" y2="${-padR*0.7}" stroke="${c.trim}" stroke-width=".8" opacity=".5"/>
          <line x1="0" y1="0" x2="${padR*0.5}" y2="${-padR*0.4}" stroke="${c.trim}" stroke-width=".6" opacity=".4"/>
          <line x1="0" y1="0" x2="${-padR*0.5}" y2="${-padR*0.4}" stroke="${c.trim}" stroke-width=".6" opacity=".4"/>
          <!-- Lilypad notch -->
          <path d="M-3,0 L0,${-padR*0.7} L3,0" fill="#2a4a28"/>
          <!-- Small flower bud -->
          <circle cx="${padR*0.4}" cy="${-padR*0.3}" r="3" fill="${c.door}" opacity=".7"/>
        </g>`;
          }

          return `<svg id="culdesac"
      <!-- Swamp water background -->
      <rect width="${W}" height="${H}" fill="#2a4a28"/>
      <!-- Murky water patches -->
      <circle cx="${cx*0.3}" cy="${cy*0.4}" r="${radius*0.3}" fill="#1e3a20" opacity=".5"/>
      <circle cx="${cx*1.6}" cy="${cy*1.5}" r="${radius*0.25}" fill="#1e3a20" opacity=".4"/>
      <circle cx="${cx*0.8}" cy="${cy*1.3}" r="${radius*0.2}" fill="#1e3a20" opacity=".35"/>
      ${driveways}
      <!-- Swamp waterway ring -->
      <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#1a3a22" stroke-width="${roadW}" opacity=".6"/>
      <circle cx="${cx}" cy="${cy}" r="${radius + roadW/2 - 3}" fill="none" stroke="#254a30" stroke-width="2" stroke-dasharray="8 12" opacity=".4"/>
      <circle cx="${cx}" cy="${cy}" r="${radius - roadW/2 + 3}" fill="none" stroke="#254a30" stroke-width="2" stroke-dasharray="8 12" opacity=".4"/>
      <!-- Central swamp island -->
      <circle cx="${cx}" cy="${cy}" r="${radius - roadW/2 - 2}" fill="#2d5028"/>
      <circle cx="${cx}" cy="${cy}" r="${radius - roadW/2 - 14}" fill="#264822" opacity=".6"/>
      ${houseSVGs}
      <!-- Fish market in swamp centre -->
      <g transform="translate(${layout.storeCX}, ${layout.storeCY})">
        <ellipse cx="0" cy="0" rx="24" ry="18" fill="#3a6a38" stroke="#2a5028" stroke-width="1.5"/>
        <rect x="-16" y="-12" width="32" height="24" fill="#5a4a30" rx="3" opacity=".85"/>
        <polygon points="0,-26 -22,-12 22,-12" fill="#4a3a20"/>
        <rect x="-7" y="4" width="14" height="14" fill="#3a2a18" rx="2"/>
        <circle cx="5" cy="11" r="1.5" fill="#5a4a30"/>
        <text x="0" y="-30" text-anchor="middle" font-size="13" font-family="serif">\u{1F41F}\u{1F3A3}</text>
        <text x="0" y="26" text-anchor="middle" font-size="7" font-family="system-ui,sans-serif" fill="#cde0c0" font-weight="bold" letter-spacing="1">FISH MARKET</text>
      </g>
    </svg>`;
}
