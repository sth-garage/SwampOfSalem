// ── Constants ─────────────────────────────────────────────────
const PERSON_SIZE  = 80;
const PEOPLE_COUNT = 5;
const TICK_MS      = 2200;
const TALK_DIST    = 130;
const TALK_STOP    = 88;

// Social need
const SOCIAL_DECAY  = 12;   // points lost per tick when not talking
const SOCIAL_GAIN   = 22;   // points gained per tick while talking
const SOCIAL_MAX    = 100;
const SOCIAL_URGENT = 30;   // below this, talking weight is boosted strongly

const PERSONALITIES = ['cheerful','grumpy','lazy','energetic','introvert','extrovert'];

const PERSONALITY_EMOJI = {
    cheerful:'😊', grumpy:'😠', lazy:'😴',
    energetic:'⚡', introvert:'🤫', extrovert:'🎉'
};

const ACTIVITY_EMOJI = { eating:'🍔', sleeping:'💤', moving:'🚶', talking:'💬' };

// Base activity weights – social need modifier applied at runtime
const ACTIVITY_WEIGHTS = {
    cheerful:  { eating:15, sleeping: 8, moving:30, talking:47 },
    grumpy:    { eating:25, sleeping:22, moving:38, talking:15 },
    lazy:      { eating:18, sleeping:48, moving:12, talking:22 },
    energetic: { eating:12, sleeping: 4, moving:58, talking:26 },
    introvert: { eating:32, sleeping:28, moving:32, talking: 8 },
    extrovert: { eating:12, sleeping: 8, moving:24, talking:56 }
};

// Starting social values per personality (introverts start fuller)
const SOCIAL_START = {
    cheerful:70, grumpy:50, lazy:60,
    energetic:65, introvert:85, extrovert:55
};

const ACTIVITY_TICKS = {
    eating:[3,7], sleeping:[5,14], moving:[1,4], talking:[2,5]
};

const MOOD_MATRIX = {
    cheerful:  { eating:+1, sleeping: 0, moving:+1, talking:+2 },
    grumpy:    { eating: 0, sleeping:+1, moving:-1, talking:-1 },
    lazy:      { eating:+1, sleeping:+2, moving:-1, talking: 0 },
    energetic: { eating: 0, sleeping:-2, moving:+2, talking:+1 },
    introvert: { eating:+1, sleeping:+1, moving: 0, talking:-1 },
    extrovert: { eating: 0, sleeping:-1, moving: 0, talking:+2 }
};

const MOOD_EMOJI = s => s>=2?'😄':s>=1?'😊':s>=0?'😐':s>=-1?'😟':'😤';

const WALK_SPEED = {
    cheerful:0.70, grumpy:0.55, lazy:0.33,
    energetic:1.20, introvert:0.50, extrovert:0.85
};

const NAMES = ['Alice','Bob','Carol','Dan','Eve','Frank','Grace','Hank','Iris','Jack'];

const DIALOGUE = {
    cheerful:  ['Nice weather today! ☀️','You look amazing!','This is so fun!','Did you hear the news?',
                'Let\'s hang out more!','I love it here! 😄','How\'s your day?','Want coffee? ☕',
                'That\'s so exciting!','You\'re the best!'],
    grumpy:    ['Ugh, not you again.','Can we wrap this up?','Whatever.','I\'d rather be alone.',
                'This is pointless.','Are we done yet?','I hate small talk.','Fine. Whatever.',
                'You\'re in my way.','This place is too loud.'],
    lazy:      ['I\'m so tired... 😴','Can we sit down?','I just woke up.','Can we do this later?',
                'I need a nap.','Walking is exhausting.','Zzzz... oh, hi.','Too much effort.',
                'Can\'t we just text?','My feet hurt.'],
    energetic: ['LET\'S GO!! ⚡','Did you run today?','I did 50 pushups!','So much to do!',
                'What\'s the plan?!','Race you somewhere!','Up since 5am!','Try sprinting!',
                'I love being busy!','KEEP MOVING!!'],
    introvert: ['Oh... hi.','This is a bit much.','I prefer reading.','I\'ll be quick.',
                'Quiet is underrated.','I need alone time.','Is this necessary?',
                'I liked the silence.','OK, leaving soon.','...'],
    extrovert: ['Oh my gosh, HI!! 🎉','Tell me everything!','We should throw a party!',
                'I love meeting people!','You\'re my favorite!','Let\'s get everyone together!',
                'Did you hear about—','This is SO exciting!!','Have you met my friend?',
                'I know everyone here!']
};

const pickMessage = p => { const d = DIALOGUE[p]; return d[rnd(d.length)]; };

// ── State ─────────────────────────────────────────────────────
let people       = [];
let tickInterval = null;
let rafId        = null;
let paused       = false;
let nextId       = 0;
const talkLines  = new Map();
const bubbles    = new Map();

// ── Helpers ───────────────────────────────────────────────────
const rnd  = n => Math.floor(Math.random() * n);
const rndF = n => Math.random() * n;
const hsl  = () => `hsl(${rnd(360)},${55+rnd(30)}%,${45+rnd(20)}%)`;

function weightedPick(weights) {
    const e = Object.entries(weights);
    let r = Math.random() * e.reduce((s,[,w]) => s+w, 0);
    for (const [k,w] of e) { r -= w; if (r <= 0) return k; }
    return e[0][0];
}

const rndTicks = a => { const [mn,mx] = ACTIVITY_TICKS[a]; return mn + rnd(mx-mn+1); };

function stageBounds() {
    const el = document.getElementById('world');
    return { W: el.clientWidth - PERSON_SIZE, H: el.clientHeight - PERSON_SIZE };
}

function dist(a, b) {
    const cx = PERSON_SIZE / 2;
    const dx = (a.x+cx)-(b.x+cx), dy = (a.y+cx)-(b.y+cx);
    return Math.sqrt(dx*dx + dy*dy);
}

// Build weighted table with social-need boost applied
function socialWeights(person) {
    const base = { ...ACTIVITY_WEIGHTS[person.personality] };
    if (person.socialNeed < SOCIAL_URGENT) {
        // Exponential urgency: the emptier the bar the harder they crave social contact
        const urgency = ((SOCIAL_URGENT - person.socialNeed) / SOCIAL_URGENT) * 120;
        base.talking = (base.talking || 0) + urgency;
        // Also nudge them to move so they can reach someone
        base.moving  = (base.moving  || 0) + urgency * 0.5;
    }
    return base;
}

// Social-bar colour: green → yellow → red as need drops
function socialColor(need) {
    if (need >= 60) return '#4caf50';
    if (need >= SOCIAL_URGENT) return '#ffc107';
    return '#e94560';
}

// ── Person factory ────────────────────────────────────────────
function createPerson(index) {
    const personality = PERSONALITIES[rnd(PERSONALITIES.length)];
    const { W, H }    = stageBounds();
    const cols = 3, rows = Math.ceil(PEOPLE_COUNT / cols);
    const col  = index % cols, row = Math.floor(index / cols);
    const x    = Math.max(0, Math.min(W, ((col + .2 + rndF(.6)) / cols) * W));
    const y    = Math.max(0, Math.min(H, ((row + .2 + rndF(.6)) / rows) * H));
    return {
        id: nextId++,
        name: NAMES[(nextId-1) % NAMES.length],
        color: hsl(),
        personality,
        activity: 'moving',
        talkingTo: null,
        message: null,
        socialNeed: SOCIAL_START[personality],
        ticksLeft: rndTicks('moving'),
        x, y,
        targetX: rndF(W),
        targetY: rndF(H),
        speed: WALK_SPEED[personality]
    };
}

// ── Activity tick ─────────────────────────────────────────────
function tick() {
    const free = new Set(
        people.filter(p => p.activity !== 'sleeping' && p.talkingTo === null).map(p => p.id)
    );

    for (const person of people) {
        person.ticksLeft--;

        // Update social need
        if (person.activity === 'talking') {
            person.socialNeed = Math.min(SOCIAL_MAX, person.socialNeed + SOCIAL_GAIN);
        } else {
            person.socialNeed = Math.max(0, person.socialNeed - SOCIAL_DECAY);
        }

        // Cycle dialogue each tick while still mid-conversation
        if (person.activity === 'talking' && person.ticksLeft > 0) {
            person.message = pickMessage(person.personality);
        }

        if (person.ticksLeft > 0) continue;

        if (person.talkingTo !== null) {
            const partner = people.find(p => p.id === person.talkingTo);
            if (partner && partner.talkingTo === person.id) {
                partner.talkingTo = null;
                partner.ticksLeft = 0;
                free.add(partner.id);
            }
            person.talkingTo = null;
            free.add(person.id);
        }

        let next = weightedPick(socialWeights(person));

        if (next === 'talking') {
            const nearby = [...free]
                .filter(id => id !== person.id)
                .map(id => people.find(p => p.id === id))
                .filter(p => dist(person, p) <= TALK_DIST);

            if (nearby.length > 0) {
                const partner = nearby[rnd(nearby.length)];
                const dur     = rndTicks('talking');
                person.activity  = 'talking'; person.talkingTo = partner.id; person.ticksLeft = dur;
                person.message   = pickMessage(person.personality);
                partner.activity = 'talking'; partner.talkingTo = person.id; partner.ticksLeft = dur;
                partner.message  = pickMessage(partner.personality);
                free.delete(person.id);
                free.delete(partner.id);
                continue;
            }
            // Nobody nearby — walk toward loneliest free person instead
            const anyFree = [...free].filter(id => id !== person.id).map(id => people.find(p => p.id === id));
            if (anyFree.length > 0) {
                const target = anyFree.reduce((a, b) => a.socialNeed < b.socialNeed ? a : b);
                person.targetX = target.x;
                person.targetY = target.y;
            }
            next = 'moving';
        }

        person.activity  = next;
        person.ticksLeft = rndTicks(next);

        if (next === 'moving') {
            const { W, H } = stageBounds();
            person.targetX = rndF(W);
            person.targetY = rndF(H);
        }

        if (next === 'sleeping') free.delete(person.id);
        else free.add(person.id);
    }

    people.forEach(renderPerson);
    updateStats();
}

// ── Animation loop ────────────────────────────────────────────
function gameLoop() {
    if (!paused) {
        const { W, H } = stageBounds();
        const cx = PERSON_SIZE / 2;

        for (const p of people) {
            if (p.activity === 'eating' || p.activity === 'sleeping') {
                // Stationary
            } else if (p.activity === 'talking') {
                const partner = people.find(q => q.id === p.talkingTo);
                if (partner) {
                    const dx = (partner.x+cx) - (p.x+cx);
                    const dy = (partner.y+cx) - (p.y+cx);
                    const d  = Math.sqrt(dx*dx + dy*dy);
                    if (d > TALK_STOP) {
                        const s = p.speed * 0.5;
                        p.x = Math.max(0, Math.min(W, p.x + (dx/d)*s));
                        p.y = Math.max(0, Math.min(H, p.y + (dy/d)*s));
                    }
                }
            } else {
                const dx = p.targetX - p.x;
                const dy = p.targetY - p.y;
                const d  = Math.sqrt(dx*dx + dy*dy);
                if (d <= p.speed) {
                    p.x = p.targetX; p.y = p.targetY;
                    p.targetX = rndF(W); p.targetY = rndF(H);
                } else {
                    p.x = Math.max(0, Math.min(W, p.x + (dx/d)*p.speed));
                    p.y = Math.max(0, Math.min(H, p.y + (dy/d)*p.speed));
                }
            }

            const el = document.getElementById(`person-${p.id}`);
            if (el) {
                el.style.left = `${p.x}px`;
                el.style.top  = `${p.y}px`;
                const fill = el.querySelector('.social-bar-fill');
                if (fill) {
                    fill.style.height = `${p.socialNeed}%`;
                    fill.style.backgroundColor = socialColor(p.socialNeed);
                }
            }

            const bubbleEl = bubbles.get(p.id);
            if (bubbleEl) {
                const bh = bubbleEl.offsetHeight || 36;
                bubbleEl.style.left = `${p.x + PERSON_SIZE / 2}px`;
                bubbleEl.style.top  = `${Math.max(4, p.y - bh - 14)}px`;
            }
        }

        syncTalkLines();
    }

    rafId = requestAnimationFrame(gameLoop);
}

// ── DOM helpers ───────────────────────────────────────────────
function renderPerson(p) {
    const el = document.getElementById(`person-${p.id}`);
    if (!el) return;
    el.className = `person activity-${p.activity}`;
    el.querySelector('.activity-icon').textContent = ACTIVITY_EMOJI[p.activity];

    // Create, update, or remove chat bubble
    let bubble = bubbles.get(p.id);
    if (p.activity === 'talking') {
        if (!bubble) {
            bubble = document.createElement('div');
            bubble.id        = `bubble-${p.id}`;
            bubble.className = 'chat-bubble';
            bubble.style.left = `${p.x + PERSON_SIZE / 2}px`;
            bubble.style.top  = `${p.y - 60}px`;
            document.getElementById('world').appendChild(bubble);
            bubbles.set(p.id, bubble);
        }
        if (p.message && bubble.textContent !== p.message) {
            bubble.textContent = p.message;
            bubble.style.animation = 'none';
            bubble.offsetHeight; // force reflow
            bubble.style.animation = '';
        }
    } else if (bubble) {
        bubble.remove();
        bubbles.delete(p.id);
    }
}

function spawnPeople() {
    stopAll();
    people = []; nextId = 0;

    document.getElementById('world').querySelectorAll('.person').forEach(e => e.remove());
    document.getElementById('world').querySelectorAll('.chat-bubble').forEach(e => e.remove());
    talkLines.forEach(l => l.remove()); talkLines.clear();
    bubbles.forEach(b => b.remove()); bubbles.clear();

    const world = document.getElementById('world');
    for (let i = 0; i < PEOPLE_COUNT; i++) {
        const p = createPerson(i);
        people.push(p);

        const el = document.createElement('div');
        el.id = `person-${p.id}`;
        el.className = `person activity-${p.activity}`;
        el.style.cssText = `background:${p.color};left:${p.x}px;top:${p.y}px`;

        const socialBar  = document.createElement('div'); socialBar.className  = 'social-bar';
        const socialFill = document.createElement('div'); socialFill.className = 'social-bar-fill';
        socialFill.style.height = `${p.socialNeed}%`;
        socialFill.style.backgroundColor = socialColor(p.socialNeed);
        socialBar.appendChild(socialFill);

        el.append(
            Object.assign(document.createElement('span'), { className:'activity-icon',     textContent: ACTIVITY_EMOJI[p.activity] }),
            Object.assign(document.createElement('span'), { className:'personality-badge', textContent: PERSONALITY_EMOJI[p.personality] }),
            Object.assign(document.createElement('span'), { className:'name-label',        textContent: p.name }),
            socialBar
        );

        el.addEventListener('mouseenter', e => showTooltip(e, p));
        el.addEventListener('mousemove',  moveTooltip);
        el.addEventListener('mouseleave', hideTooltip);

        world.appendChild(el);
    }

    updateStats();
    startAll();
}

// ── SVG talk lines ────────────────────────────────────────────
function syncTalkLines() {
    const svg = document.getElementById('connections');
    const cx  = PERSON_SIZE / 2;

    const activePairs = new Set();
    for (const p of people) {
        if (p.talkingTo !== null) {
            activePairs.add(`${Math.min(p.id, p.talkingTo)}-${Math.max(p.id, p.talkingTo)}`);
        }
    }

    for (const [key, line] of talkLines) {
        if (!activePairs.has(key)) { line.remove(); talkLines.delete(key); }
    }

    for (const key of activePairs) {
        const [aid, bid] = key.split('-').map(Number);
        const a = people.find(p => p.id === aid);
        const b = people.find(p => p.id === bid);
        if (!a || !b) continue;

        let line = talkLines.get(key);
        if (!line) {
            line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('stroke', 'rgba(255,240,80,.38)');
            line.setAttribute('stroke-width', '2');
            line.setAttribute('stroke-dasharray', '6 4');
            svg.appendChild(line);
            talkLines.set(key, line);
        }

        line.setAttribute('x1', a.x + cx); line.setAttribute('y1', a.y + cx);
        line.setAttribute('x2', b.x + cx); line.setAttribute('y2', b.y + cx);
    }
}

// ── Stats ─────────────────────────────────────────────────────
function updateStats() {
    const c = { eating:0, sleeping:0, moving:0, talking:0 };
    people.forEach(p => c[p.activity]++);
    document.getElementById('stats').innerHTML =
        Object.entries(c).map(([a,n]) =>
            `<span>${ACTIVITY_EMOJI[a]} ${a}: <strong>${n}</strong></span>`
        ).join('');
}

// ── Tooltip ───────────────────────────────────────────────────
const tooltip = document.getElementById('tooltip');

function showTooltip(e, p) {
    const mood    = MOOD_MATRIX[p.personality][p.activity];
    const partner = p.talkingTo !== null ? people.find(q => q.id === p.talkingTo) : null;
    const actDesc = partner
        ? `Talking with ${partner.name}`
        : p.activity[0].toUpperCase() + p.activity.slice(1);
    tooltip.innerHTML =
        `<strong>${p.name}</strong><br>` +
        `${PERSONALITY_EMOJI[p.personality]} ${p.personality[0].toUpperCase() + p.personality.slice(1)}<br>` +
        `${ACTIVITY_EMOJI[p.activity]} ${actDesc}<br>` +
        `Mood: ${MOOD_EMOJI(mood)} (${mood >= 0 ? '+' : ''}${mood})<br>` +
        `🗣 Social need: ${Math.round(p.socialNeed)}%`;
    moveTooltip(e);
    tooltip.style.display = 'block';
}

function moveTooltip(e) {
    const pad = 14;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + 230 > window.innerWidth)  x = e.clientX - 230 - pad;
    if (y + 130 > window.innerHeight) y = e.clientY - 130 - pad;
    tooltip.style.left = `${x}px`; tooltip.style.top = `${y}px`;
}

function hideTooltip() { tooltip.style.display = 'none'; }

// ── Lifecycle ─────────────────────────────────────────────────
function startAll() {
    paused = false;
    document.getElementById('pauseBtn').textContent = '⏸ Pause';
    if (!tickInterval) tickInterval = setInterval(tick, TICK_MS);
    stopRaf(); startRaf();
}

function stopAll() {
    if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
    stopRaf();
}

function startRaf() { rafId = requestAnimationFrame(gameLoop); }
function stopRaf()  { if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } }

// ── Controls ──────────────────────────────────────────────────
document.getElementById('respawnBtn').addEventListener('click', spawnPeople);

document.getElementById('pauseBtn').addEventListener('click', () => {
    if (paused) {
        paused = false;
        document.getElementById('pauseBtn').textContent = '⏸ Pause';
        if (!tickInterval) tickInterval = setInterval(tick, TICK_MS);
    } else {
        paused = true;
        document.getElementById('pauseBtn').textContent = '▶ Resume';
        if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
    }
});

window.addEventListener('resize', () => {
    const { W, H } = stageBounds();
    for (const p of people) {
        p.x = Math.min(p.x, W); p.y = Math.min(p.y, H);
        if (p.targetX > W) p.targetX = rndF(W);
        if (p.targetY > H) p.targetY = rndF(H);
    }
});

requestAnimationFrame(() => requestAnimationFrame(spawnPeople));
