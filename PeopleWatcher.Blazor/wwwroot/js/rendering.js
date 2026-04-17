import {
    PERSON_SIZE, PHASE, ACTIVITY_EMOJI, PERSONALITY_EMOJI,
    MOOD_MATRIX, MOOD_EMOJI, PEOPLE_COUNT
} from './constants.js';
import { socialColor, relationEmoji, relationColor } from './helpers.js';
import { living } from './people.js';
import { state } from './state.js';

// ── Stats bar ─────────────────────────────────────────────────
export function updateStats() {
    const c = { eating:0, sleeping:0, moving:0, talking:0, hosting:0, visiting:0, debating:0, shopping:0 };
    state.people.forEach(p => { if (!state.deadIds.has(p.id) && c[p.activity] !== undefined) c[p.activity]++; });
    const alive = living().length;
    const dead  = state.deadIds.size;
    document.getElementById('stats').innerHTML =
        `<span>\uD83D\uDC65 Alive: <strong>${alive}</strong></span>` +
        (dead > 0 ? `<span>\u26B0\uFE0F Dead: <strong>${dead}</strong></span>` : '') +
        Object.entries(c).filter(([,n]) => n > 0).map(([a,n]) =>
            `<span>${ACTIVITY_EMOJI[a] ?? '\uD83D\uDDE3\uFE0F'} ${a}: <strong>${n}</strong></span>`
        ).join('');
}

// ── Phase label ───────────────────────────────────────────────
export function updatePhaseLabel() {
    const el = document.getElementById('phase-label');
    if (!el) return;
    let voteLabel = `\uD83D\uDDF3\uFE0F Voting...`;
    if (state.gamePhase === PHASE.VOTE && state.voteIndex < state.voteOrder.length) {
        const voter = state.voteOrder[state.voteIndex];
        if (voter) voteLabel = `\uD83D\uDDF3\uFE0F ${voter.name} is voting... (${state.voteIndex + 1}/${state.voteOrder.length})`;
    }
    let executeLabel = `\u2694\uFE0F Execution...`;
    if (state.gamePhase === PHASE.EXECUTE && state.condemnedId !== null) {
        const condemned = state.people.find(p => p.id === state.condemnedId);
        if (condemned) executeLabel = `\u2694\uFE0F ${condemned.name} walks to the centre...`;
    }
    const map = {
        [PHASE.DAY]:     `\u2600\uFE0F Day ${state.dayNumber}`,
        [PHASE.NIGHT]:   `\uD83C\uDF19 Night \u2014 Someone is in danger...`,
        [PHASE.DAWN]:    `\uD83C\uDF05 A body has been found!`,
        [PHASE.DEBATE]:  `\uD83D\uDDE3\uFE0F The town debates...`,
        [PHASE.VOTE]:    voteLabel,
        [PHASE.EXECUTE]: executeLabel,
        [PHASE.OVER]:    `\uD83C\uDFAE Game Over`
    };
    el.textContent = map[state.gamePhase] ?? '';
    el.className   = `phase-label phase-${state.gamePhase}`;
}

// ── House guests ──────────────────────────────────────────────
export function updateHouseGuests() {
    for (let i = 0; i < state.houses.length; i++) {
        const count = state.people.filter(p => p.guestOfIndex === i).length;
        const badge = document.getElementById(`house-guests-${i}`);
        if (!badge) continue;
        if (count > 0) {
            badge.textContent = count === 1 ? '1 guest' : `${count} guests`;
            badge.classList.add('visible');
        } else {
            badge.classList.remove('visible');
        }
    }
}

// ── Dead body marker ──────────────────────────────────────────
export function showDeadBody(personId) {
    const p = state.people.find(q => q.id === personId);
    if (!p) return;
    const h = state.houses[p.homeIndex];
    const el = document.getElementById(`person-${p.id}`);
    if (el) el.classList.add('dead');
    const marker = document.createElement('div');
    marker.className = 'dead-marker';
    marker.id = `dead-${p.id}`;
    marker.innerHTML = `<span class="dead-icon">\u26B0\uFE0F</span><span class="dead-name">${p.name}</span>`;
    marker.style.left = `${h.doorX - 18}px`;
    marker.style.top  = `${h.doorY + 4}px`;
    document.getElementById('world').appendChild(marker);
}

// ── Render single person ──────────────────────────────────────
export function renderPerson(p) {
    const el = document.getElementById(`person-${p.id}`);
    if (!el) return;
    const isDead = state.deadIds.has(p.id);
    el.className = `person activity-${p.activity}${p.indoors ? ' indoors' : ''}${isDead ? ' dead' : ''}`;

    // Dead people: remove bubbles and thoughts
    if (isDead) {
        const bubble = state.bubbles.get(p.id);
        if (bubble) { bubble.remove(); state.bubbles.delete(p.id); }
        const thought = state.thoughts.get(p.id);
        if (thought) { thought.remove(); state.thoughts.delete(p.id); }
        p.message = null;
        p.thought = null;
        return;
    }

    // Chat bubble — show whenever the person has a message to display
    let bubble = state.bubbles.get(p.id);
    const showBubble = !!p.message;
    if (showBubble) {
        if (!bubble) {
            bubble = document.createElement('div');
            bubble.id        = `bubble-${p.id}`;
            bubble.className = 'chat-bubble';
            bubble.style.left = `${p.x + PERSON_SIZE / 2 - 20}px`;
            bubble.style.top  = `${p.y - 38}px`;
            document.getElementById('world').appendChild(bubble);
            state.bubbles.set(p.id, bubble);
        }
        if (p.message) {
            const textSpan = bubble.querySelector('.bubble-text');
            if (!textSpan || textSpan.textContent !== p.message) {
                bubble.innerHTML =
                    `<span class="bubble-name">${p.name}</span>` +
                    `<span class="bubble-text">${p.message}</span>`;
                bubble.style.animation = 'none';
                void bubble.offsetHeight;
                bubble.style.animation = '';
            }
        }
    } else if (bubble) {
        bubble.remove();
        state.bubbles.delete(p.id);
    }

    // Thought bubble
    let thoughtEl = state.thoughts.get(p.id);
    if (!thoughtEl) {
        thoughtEl = document.createElement('div');
        thoughtEl.id        = `thought-${p.id}`;
        thoughtEl.className = 'thought-bubble';
        thoughtEl.textContent = p.thought;
        thoughtEl.style.left = `${p.x + PERSON_SIZE / 2 + 10}px`;
        thoughtEl.style.top  = `${p.y - 50}px`;
        document.getElementById('world').appendChild(thoughtEl);
        state.thoughts.set(p.id, thoughtEl);
    } else if (thoughtEl.textContent !== p.thought) {
        thoughtEl.textContent = p.thought;
        thoughtEl.style.animation = 'none';
        void thoughtEl.offsetHeight;
        thoughtEl.style.animation = '';
    }
}

export function renderAllPeople() { state.people.forEach(renderPerson); }

// ── SVG talk lines — disabled ─────────────────────────────────
export function syncTalkLines() {
    // Remove any existing lines
    for (const [key, line] of state.talkLines) {
        line.remove();
    }
    state.talkLines.clear();
}

// ── Person detail panel (left sidebar) ───────────────────────
let panel        = null;
let panelContent = null;
let pinnedPersonId = null;

export function initTooltip() {
    panel        = document.getElementById('person-panel');
    panelContent = document.getElementById('person-panel-content');

    document.getElementById('panelCloseBtn').addEventListener('click', e => {
        e.stopPropagation();
        closePanel();
    });
}

function closePanel() {
    pinnedPersonId = null;
    panel.style.display = 'none';
    panel.classList.remove('panel-open');
}

// Opens or switches the panel to a different person (called on click)
export function pinTooltip(e, p) {
    e.stopPropagation();
    if (pinnedPersonId === p.id) { closePanel(); return; }
    pinnedPersonId = p.id;
    _renderPanel(p);
    panel.style.display = 'flex';
    // Trigger CSS open transition on next frame
    requestAnimationFrame(() => panel.classList.add('panel-open'));
}

// Hover show/hide — no-op since we use the sidebar now
export function showTooltip(_e, _p) {}
export function moveTooltip(_e) {}
export function hideTooltip() {}

// Refresh the open panel's content each tick so data stays live
export function refreshPinnedTooltip() {
    if (pinnedPersonId === null) return;
    const p = state.people.find(q => q.id === pinnedPersonId);
    if (!p) { closePanel(); return; }
    _renderPanel(p);
}

function _renderPanel(p) {
    const isDead = state.deadIds.has(p.id);
    if (isDead) {
        panelContent.innerHTML =
            `<div class="panel-name">${p.name} <span class="panel-dead">\u26B0\uFE0F Deceased</span></div>`;
        return;
    }

    const mood      = MOOD_MATRIX[p.personality][p.activity] ?? 0;
    const partner   = p.talkingTo !== null ? state.people.find(q => q.id === p.talkingTo) : null;
    const host      = p.guestOfIndex !== null ? state.people.find(q => q.homeIndex === p.guestOfIndex) : null;
    const actDesc   = partner ? `Talking with ${partner.name}`
                   : host     ? `Visiting ${host.name}'s house`
                   : p.activity === 'hosting'  ? 'Hosting at home'
                   : p.activity === 'debating' ? 'Debating in the square'
                   : p.activity === 'shopping' ? 'Shopping at the fruit store'
                   : p.activity[0].toUpperCase() + p.activity.slice(1);
    const isMurderer = p.id === state.murdererId;

    const statBar = val => {
        const filled = Math.round(Math.max(0, Math.min(10, val)));
        return '<span class="stat-bar">' +
            '<span class="stat-pip filled"></span>'.repeat(filled) +
            '<span class="stat-pip"></span>'.repeat(10 - filled) +
            '</span>';
    };

    // Relations
    const relRows = living()
        .filter(q => q.id !== p.id)
        .map(q => {
            const trueVal = Math.round(p.relations[q.id] ?? 0);
            const percVal = Math.round(p.perceivedRelations[q.id] ?? 0);
            const susp    = Math.round(p.suspicion[q.id] ?? 0);
            const isLying = p.liar && Math.abs(trueVal - percVal) > 15;
            const liarTag = isLying ? '<span class="rel-lying">(lies)</span>' : '';
            const suspTag = susp > 20 ? `<span class="rel-susp">susp ${susp}</span>` : '';
            const cls     = trueVal > 20 ? 'rel-pos' : trueVal < -20 ? 'rel-neg' : 'rel-neu';
            return `<div class="rel-row ${cls}">
                <span class="rel-name">${relationEmoji(trueVal)} ${q.name}</span>
                <span class="rel-val">${trueVal >= 0 ? '+' : ''}${trueVal}${liarTag}${suspTag}</span>
            </div>`;
        }).join('');

    // Top suspect
    const suspEntries = living()
        .filter(q => q.id !== p.id)
        .map(q => ({ q, s: p.suspicion[q.id] ?? 0 }))
        .sort((a, b) => b.s - a.s);
    const topSuspect = suspEntries.length > 0 && suspEntries[0].s > 15
        ? `<div class="panel-suspect">\uD83D\uDD75\uFE0F Suspects <strong>${suspEntries[0].q.name}</strong> (${Math.round(suspEntries[0].s)}%)</div>`
        : '';

    // Vote history
    const myVotes = (state.voteHistory || []).filter(v => v.voterId === p.id);
    const votedStr = myVotes.length > 0
        ? `<div class="panel-votes">Voted: ${myVotes.map(v => { const t = state.people.find(q => q.id === v.targetId); return t ? `<strong>${t.name}</strong>` : ''; }).filter(Boolean).join(', ')}</div>`
        : '';

    // Witnessed thefts
    const theftRows = (p.witnessedThefts || []).map(t => {
        const thief  = state.people.find(q => q.id === t.thiefId);
        const victim = state.people.find(q => q.id === t.victimId);
        return (thief && victim) ? `<div class="panel-theft">\uD83D\uDC41\uFE0F ${thief.name} stole from ${victim.name} (Day ${t.day})</div>` : '';
    }).filter(Boolean).join('');

    // Money / fruit
    const moneyStr = `\uD83D\uDCB5 $${p.money}${p.debt > 0 ? ` <span class="panel-debt">(debt $${p.debt})</span>` : ''}`;
    const fruitStr = (p.apples > 0 || p.oranges > 0)
        ? `\uD83C\uDF4E ${p.apples} apple${p.apples !== 1 ? 's' : ''}&nbsp;&nbsp;\uD83C\uDF4A ${p.oranges} orange${p.oranges !== 1 ? 's' : ''}`
        : '\uD83C\uDF4E No fruit yet';
    const loverBadge = p.orangeLover ? '<span class="panel-orange-badge">\uD83C\uDF4A Orange obsessed!</span>' : '';

    // History
    const historyRows = (p.history || []).slice().reverse().map(h =>
        `<div class="history-entry">Day ${h.day ?? '?'} — ${h.detail}</div>`
    ).join('');
    const historySection = p.history && p.history.length > 0
        ? `<div class="panel-section-title">\uD83D\uDCD6 History <span class="panel-count">${p.history.length}</span></div>
           <div class="panel-history">${historyRows}</div>`
        : '';

    panelContent.innerHTML =
        `<div class="panel-name">${p.name}${isMurderer ? ' <span class="panel-murderer">\uD83D\uDD2A Murderer</span>' : ''}${p.liar && !isMurderer ? ' <span class="panel-liar">\uD83C\uDFA0 Liar</span>' : ''}</div>` +
        `<div class="panel-meta">${PERSONALITY_EMOJI[p.personality]} ${p.personality[0].toUpperCase() + p.personality.slice(1)}</div>` +
        `<div class="panel-meta">${ACTIVITY_EMOJI[p.activity] ?? '\uD83D\uDDE3\uFE0F'} ${actDesc}</div>` +
        `<div class="panel-meta">Mood ${MOOD_EMOJI(mood)} &nbsp; Social ${Math.round(p.socialNeed)}%</div>` +
        `<div class="panel-stats">` +
            `<div class="panel-stat-row">\uD83D\uDCAD Thought ${statBar(p.thoughtStat)} <span>${p.thoughtStat}/10</span></div>` +
            `<div class="panel-stat-row">\uD83D\uDCAC Social&nbsp;&nbsp; ${statBar(p.socialStat)} <span>${p.socialStat}/10</span></div>` +
        `</div>` +
        `<div class="panel-divider"></div>` +
        `<div class="panel-meta">${moneyStr}</div>` +
        `<div class="panel-meta">${fruitStr} ${loverBadge}</div>` +
        topSuspect + votedStr + theftRows +
        `<div class="panel-divider"></div>` +
        `<div class="panel-section-title">\uD83E\uDD1D Relations</div>` +
        `<div class="panel-relations">${relRows}</div>` +
        (historySection ? `<div class="panel-divider"></div>${historySection}` : '');
}
