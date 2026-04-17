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
    const hr = a.headSize;
    const hy = hr + 2;
    const neckY   = hy + hr;
    const bodyY   = neckY + a.bodyHeight;
    const legEndY = bodyY + a.legLength;
    const svgH    = legEndY + 4;
    const armY    = neckY + a.bodyHeight * 0.38;
    const rad     = a.armAngle * Math.PI / 180;
    const armLen  = 16 + rnd(4);
    const axL = cx - Math.sin(rad) * armLen, ayL = armY + Math.cos(rad) * armLen;
    const axR = cx + Math.sin(rad) * armLen, ayR = armY + Math.cos(rad) * armLen;

    let hatSVG = '';
    if (a.hatStyle === 'cap') {
        hatSVG = `<ellipse cx="${cx}" cy="${hy-hr+1}" rx="${hr+3}" ry="5" fill="${a.hatColor}"/>
                  <rect x="${cx-hr+1}" y="${hy-hr*1.6}" width="${(hr-1)*2}" height="${hr*0.85}" rx="4" fill="${a.hatColor}"/>`;
    } else if (a.hatStyle === 'beanie') {
        hatSVG = `<ellipse cx="${cx}" cy="${hy-hr+3}" rx="${hr+1}" ry="7" fill="${a.hatColor}"/>
                  <circle cx="${cx}" cy="${hy-hr-5}" r="3" fill="${a.hatColor}"/>`;
    } else if (a.hatStyle === 'tophat') {
        hatSVG = `<rect x="${cx-hr+2}" y="${hy-hr*1.9}" width="${(hr-2)*2}" height="${hr*1.1}" rx="2" fill="${a.hatColor}"/>
                  <rect x="${cx-hr-1}" y="${hy-hr*0.85}" width="${hr*2+2}" height="4" rx="2" fill="${a.hatColor}"/>`;
    } else if (a.hatStyle === 'hood') {
        hatSVG = `<path d="M${cx-hr-2},${hy} Q${cx-hr-4},${hy-hr*1.5} ${cx},${hy-hr-6} Q${cx+hr+4},${hy-hr*1.5} ${cx+hr+2},${hy}" fill="${a.hatColor}" opacity=".85"/>`;
    }

    return `<svg class="figure" width="60" height="${svgH}" viewBox="0 0 60 ${svgH}">
      <line x1="${cx}" y1="${neckY}" x2="${cx}" y2="${bodyY}" stroke="${a.shirtColor}" stroke-width="4" stroke-linecap="round"/>
      <line x1="${cx}" y1="${bodyY}" x2="${cx-7}" y2="${legEndY}" stroke="#555" stroke-width="3" stroke-linecap="round"/>
      <line x1="${cx}" y1="${bodyY}" x2="${cx+7}" y2="${legEndY}" stroke="#555" stroke-width="3" stroke-linecap="round"/>
      <line x1="${cx}" y1="${armY}" x2="${axL}" y2="${ayL}" stroke="${a.shirtColor}" stroke-width="3" stroke-linecap="round"/>
      <line x1="${cx}" y1="${armY}" x2="${axR}" y2="${ayR}" stroke="${a.shirtColor}" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${hy}" r="${hr}" fill="${a.skinTone}" stroke="rgba(0,0,0,.2)" stroke-width="1"/>
      ${hatSVG}
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

// ── Cul-de-sac layout ────────────────────────────────────────
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
            stroke="#b8a88a" stroke-width="18" stroke-linecap="round" opacity=".85"/>`;
    }

    let houseSVGs = '';
    for (let i = 0; i < layout.housePositions.length; i++) {
        const h  = layout.housePositions[i];
        const c  = HOUSE_COLORS[i % HOUSE_COLORS.length];
        const hw = 40, hh = 34;
        const deg = (h.angle * 180 / Math.PI) + 90;
        houseSVGs += `
        <g transform="translate(${h.x},${h.y}) rotate(${deg})">
          <rect x="${-hw/2}" y="${-hh/2}" width="${hw}" height="${hh}" fill="${c.wall}" rx="3"/>
          <polygon points="0,${-hh/2-18} ${-hw/2-6},${-hh/2} ${hw/2+6},${-hh/2}" fill="${c.roof}"/>
          <rect x="-7" y="${hh/2-18}" width="14" height="18" fill="${c.door}" rx="2"/>
          <circle cx="5" cy="${hh/2-9}" r="2" fill="${c.trim}"/>
          <rect x="${-hw/2+5}" y="${-hh/2+8}" width="10" height="9" fill="${c.trim}" rx="1" opacity=".8"/>
          <rect x="${hw/2-15}" y="${-hh/2+8}" width="10" height="9" fill="${c.trim}" rx="1" opacity=".8"/>
        </g>`;
    }

    return `<svg id="culdesac" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="#4a7c42"/>
      ${driveways}
      <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#8c8070" stroke-width="${roadW}"/>
      <circle cx="${cx}" cy="${cy}" r="${radius + roadW/2 - 3}" fill="none" stroke="#a09080" stroke-width="2" stroke-dasharray="12 8"/>
      <circle cx="${cx}" cy="${cy}" r="${radius - roadW/2 + 3}" fill="none" stroke="#a09080" stroke-width="2" stroke-dasharray="12 8"/>
      <circle cx="${cx}" cy="${cy}" r="${radius - roadW/2 - 2}" fill="#5a9050"/>
      <circle cx="${cx}" cy="${cy}" r="${radius - roadW/2 - 14}" fill="#4a7c42" opacity=".6"/>
      ${houseSVGs}
      <!-- Fruit store in park centre -->
      <g transform="translate(${layout.storeCX}, ${layout.storeCY})">
        <rect x="-20" y="-18" width="40" height="36" fill="#f5deb3" rx="3" stroke="#c8a870" stroke-width="1.5"/>
        <polygon points="0,-34 -26,-18 26,-18" fill="#e67e22"/>
        <rect x="-7" y="8" width="14" height="18" fill="#c0392b" rx="2"/>
        <rect x="-17" y="-14" width="12" height="10" fill="#fffde7" rx="1" opacity=".9"/>
        <rect x="6" y="-14" width="12" height="10" fill="#fffde7" rx="1" opacity=".9"/>
        <circle cx="5" cy="17" r="1.5" fill="#f5deb3"/>
        <text x="0" y="-38" text-anchor="middle" font-size="13" font-family="serif">&#x1F34E;&#x1F34A;</text>
        <text x="0" y="32" text-anchor="middle" font-size="7" font-family="system-ui,sans-serif" fill="#fff" font-weight="bold" letter-spacing="1">STORE</text>
      </g>
    </svg>`;
}
