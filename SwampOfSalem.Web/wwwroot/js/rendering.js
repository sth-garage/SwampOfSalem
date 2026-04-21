import {
    GATOR_SIZE, PHASE, ACTIVITY_EMOJI, PERSONALITY_EMOJI,
    MOOD_MATRIX, MOOD_EMOJI, GATOR_COUNT, DAY_TICKS, TICK_MS, HOME_WARN_TICKS
} from './gameConfig.js';
import { relationEmoji, relationColor } from './helpers.js';
import { living } from './gator.js';
import { state } from './state.js';

// ── Stats bar ─────────────────────────────────────────────────
export function updateStats() {
    const c = { moving:0, talking:0, hosting:0, visiting:0, debating:0 };
    state.gators.forEach(p => { if (!state.deadIds.has(p.id) && c[p.activity] !== undefined) c[p.activity]++; });
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

    // Nightfall countdown timer
    const timerEl = document.getElementById('nightfall-timer');
    if (timerEl) {
        if (state.gamePhase === PHASE.DAY && state.cycleTimer > 0) {
            if (state.dayEndTimerActive && state.dayEndTimerExpiresAt > 0) {
                // Show the 1-minute conversation-limit countdown
                const msLeft = Math.max(0, state.dayEndTimerExpiresAt - Date.now());
                if (state.noNewConversations) {
                    timerEl.textContent = `🌙 Night coming — finishing conversations…`;
                    timerEl.style.color = '#ff6040';
                    timerEl.style.borderColor = 'rgba(200,60,40,.4)';
                } else {
                    const secsLeft = Math.ceil(msLeft / 1000);
                    const mins = Math.floor(secsLeft / 60);
                    const secs = secsLeft % 60;
                    timerEl.textContent = `🌙 Night in ${mins}:${secs.toString().padStart(2, '0')} (no new conversations after)`;
                    timerEl.style.color = secsLeft <= 10 ? '#ff6040' : '';
                    timerEl.style.borderColor = secsLeft <= 10 ? 'rgba(200,60,40,.4)' : '';
                }
                timerEl.classList.add('visible');
            } else {
                const secsLeft = Math.ceil(state.cycleTimer * TICK_MS / 1000);
                const mins = Math.floor(secsLeft / 60);
                const secs = secsLeft % 60;
                timerEl.textContent = `\u{1F319} Nightfall in ${mins}:${secs.toString().padStart(2, '0')}`;
                timerEl.classList.add('visible');
                if (state.cycleTimer <= HOME_WARN_TICKS) {
                    timerEl.style.color = '#ff6040';
                    timerEl.style.borderColor = 'rgba(200,60,40,.4)';
                } else {
                    timerEl.style.color = '';
                    timerEl.style.borderColor = '';
                }
            }
        } else {
            timerEl.classList.remove('visible');
        }
    }
    let voteLabel = `\uD83D\uDDF3\uFE0F Voting...`;
    if (state.gamePhase === PHASE.VOTE && state.voteIndex < state.voteOrder.length) {
        const voter = state.voteOrder[state.voteIndex];
        if (voter) voteLabel = `\uD83D\uDDF3\uFE0F ${voter.name} is voting... (${state.voteIndex + 1}/${state.voteOrder.length})`;
    }
    let executeLabel = `\u2694\uFE0F Execution...`;
    if (state.gamePhase === PHASE.EXECUTE && state.condemnedId !== null) {
        const condemned = state.gators.find(p => p.id === state.condemnedId);
        if (condemned) executeLabel = `\u2694\uFE0F ${condemned.name} walks to the centre...`;
    }
    const map = {
        [PHASE.DAY]:     `\u2600\uFE0F Day ${state.dayNumber}`,
        [PHASE.NIGHT]:   `\uD83C\uDF19 Night \u2014 Someone is in danger...`,
        [PHASE.DAWN]:    `\uD83C\uDF05 A body has been found in the swamp!`,
        [PHASE.DEBATE]:  `\uD83D\uDDE3\uFE0F The swamp debates...`,
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
        const count = state.gators.filter(p => p.guestOfIndex === i).length;
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
export function showDeadBody(gatorId) {
    const p = state.gators.find(q => q.id === gatorId);
    if (!p) return;
    const h = state.houses[p.homeIndex];
    const el = document.getElementById(`gator-${p.id}`);
    if (el) el.classList.add('dead');
    const marker = document.createElement('div');
    marker.className = 'dead-marker';
    marker.id = `dead-${p.id}`;
    marker.innerHTML = `<span class="dead-icon">\u26B0\uFE0F</span><span class="dead-name">${p.name}</span>`;
    marker.style.left = `${h.doorX - 18}px`;
    marker.style.top  = `${h.doorY + 4}px`;
    document.getElementById('world').appendChild(marker);
}

// ── Private-chat enclosure management ────────────────────────
const PAD_R = 62; // lilypad collision radius — matches helpers.js

function _updateEnclosure(p) {
    const isPrivate = p.indoors && (p.activity === 'hosting' || p.activity === 'visiting');
    const homeIdx   = p.activity === 'hosting' ? p.homeIndex : p.guestOfIndex;

    if (isPrivate && homeIdx != null) {
        if (!state.privateChatBubbles.has(homeIdx)) {
            const h   = state.houses[homeIdx];
            const enc = document.createElement('div');
            enc.className   = 'private-chat-enclosure';
            enc.id          = `private-enclosure-${homeIdx}`;
            const size      = PAD_R * 2 + 20;
            enc.style.width  = `${size}px`;
            enc.style.height = `${size}px`;
            enc.style.left   = `${h.x - PAD_R - 10}px`;
            enc.style.top    = `${h.y - PAD_R - 10}px`;
            enc.innerHTML    = `<span class="private-label">🤫 Private</span>`;
            document.getElementById('world').appendChild(enc);
            state.privateChatBubbles.set(homeIdx, enc);
        }
    }
}

function _cleanEnclosures() {
    if (!state.privateChatBubbles) return;
    for (const [homeIdx, enc] of state.privateChatBubbles) {
        const inUse = state.gators.some(p =>
            !state.deadIds.has(p.id) &&
            p.indoors &&
            (p.activity === 'hosting' || p.activity === 'visiting') &&
            (p.homeIndex === homeIdx || p.guestOfIndex === homeIdx)
        );
        if (!inUse) {
            enc.remove();
            state.privateChatBubbles.delete(homeIdx);
        }
    }
}

// ── Render single gator ──────────────────────────────────────
export function renderGator(p) {
    const el = document.getElementById(`gator-${p.id}`);
    if (!el) return;
    const isDead    = state.deadIds.has(p.id);
    const isPrivate = p.indoors && (p.activity === 'hosting' || p.activity === 'visiting');
    el.className = `gator activity-${p.activity}${p.indoors ? (isPrivate ? ' indoors-private' : ' indoors') : ''}${isDead ? ' dead' : ''}`;

    // Dead gators: remove bubbles and thoughts
    if (isDead) {
        const bubble = state.bubbles.get(p.id);
        if (bubble) { bubble.remove(); state.bubbles.delete(p.id); }
        const thought = state.thoughts.get(p.id);
        if (thought) { thought.remove(); state.thoughts.delete(p.id); }
        p.message = null;
        p.thought = null;
        return;
    }

    // Private-chat enclosure for hosting/visiting pairs
    _updateEnclosure(p);

    // Chat bubble — show animated dots when waiting, text when message arrives
    let bubble = state.bubbles.get(p.id);
    const showBubble = p.isWaiting || !!p.message;
    if (showBubble) {
        if (!bubble) {
            bubble = document.createElement('div');
            bubble.id        = `bubble-${p.id}`;
            bubble.className = 'chat-bubble';
            document.getElementById('world').appendChild(bubble);
            state.bubbles.set(p.id, bubble);
        }

        // Determine left/right positioning for conversation bubbles
        let bubbleOffsetX = 0; // horizontal offset from gator center
        let bubbleClass = 'chat-bubble';
        let alignSide = 'center'; // 'left', 'right', or 'center'

        if (p.talkingTo != null) {
            const partner = state.gators.find(q => q.id === p.talkingTo);
            if (partner) {
                // Determine if this gator is on the left or right
                if (p.x < partner.x) {
                    // This gator is on the left - bubble goes to the left
                    bubbleOffsetX = -90;
                    alignSide = 'left';
                    bubbleClass = `chat-bubble bubble-left bubble-gator-${p.id % 8}`;
                } else {
                    // This gator is on the right - bubble goes to the right
                    bubbleOffsetX = 90;
                    alignSide = 'right';
                    bubbleClass = `chat-bubble bubble-right bubble-gator-${p.id % 8}`;
                }
            }
        }

        bubble.className = bubbleClass;

        // Position bubble - offset vertically to prevent overlap, horizontally for left/right
        let bubbleOffsetY = -38;
        if (p.talkingTo != null) {
            const partner = state.gators.find(q => q.id === p.talkingTo);
            if (partner) {
                const dy = p.y - partner.y;
                if (Math.abs(dy) < 60) {
                    // Gators at similar height — stagger by id order
                    bubbleOffsetY = p.id < partner.id ? -78 : -38;
                } else {
                    // The higher gator gets the higher bubble
                    bubbleOffsetY = dy < 0 ? -78 : -38;
                }
            }
        }

        if (alignSide === 'left') {
            bubble.style.left = `${p.x + GATOR_SIZE / 2 + bubbleOffsetX}px`;
            bubble.style.transform = 'translateX(0)';
        } else if (alignSide === 'right') {
            bubble.style.left = `${p.x + GATOR_SIZE / 2 + bubbleOffsetX}px`;
            bubble.style.transform = 'translateX(-100%)';
        } else {
            bubble.style.left = `${p.x + GATOR_SIZE / 2 - 20}px`;
            bubble.style.transform = 'translateX(-50%)';
        }
        bubble.style.top = `${p.y + bubbleOffsetY}px`;

        if (p.isWaiting && !p.message) {
            // Show animated dots while waiting for AI response
            if (!bubble.querySelector('.bubble-waiting')) {
                bubble.innerHTML =
                    `<span class="bubble-name">${p.name}</span>` +
                    `<span class="bubble-waiting"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>`;
            }
        } else if (p.message) {
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

    // No thought bubbles on the swamp — thoughts are only shown in the detail pane
}

export function renderAllGators() {
    state.gators.forEach(renderGator);
    _cleanEnclosures();
}

export function cleanPrivateChatBubbles() {
    if (!state.privateChatBubbles) return;
    state.privateChatBubbles.forEach(enc => enc.remove());
    state.privateChatBubbles.clear();
}

// ── SVG talk lines — disabled ─────────────────────────────────
export function syncTalkLines() {
    // Remove any existing lines
    for (const [key, line] of state.talkLines) {
        line.remove();
    }
    state.talkLines.clear();
}

// ── Gator detail panel (left sidebar) ───────────────────────
let panel        = null;
let panelContent = null;
let pinnedGatorId = null;

export function initTooltip() {
    panel        = document.getElementById('gator-panel');
    panelContent = document.getElementById('gator-panel-content');

    document.getElementById('panelCloseBtn').addEventListener('click', e => {
        e.stopPropagation();
        closePanel();
    });
}

function closePanel() {
    pinnedGatorId = null;
    panel.style.display = 'none';
    panel.classList.remove('panel-open');
}

// Opens or switches the panel to a different gator (called on click)
export function pinTooltip(e, p) {
    e.stopPropagation();
    if (pinnedGatorId === p.id) { closePanel(); return; }
    pinnedGatorId = p.id;
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
    if (pinnedGatorId === null) return;
    const p = state.gators.find(q => q.id === pinnedGatorId);
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
    const partner   = p.talkingTo !== null ? state.gators.find(q => q.id === p.talkingTo) : null;
    const host      = p.guestOfIndex !== null ? state.gators.find(q => q.homeIndex === p.guestOfIndex) : null;
    const actDesc   = partner ? `Talking with ${partner.name}`
                   : host     ? `Visiting ${host.name}'s lilypad`
                   : p.activity === 'hosting'  ? 'Hosting on lilypad'
                   : p.activity === 'debating' ? 'Debating at the gathering spot'
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
        ? `<div class="panel-votes">Voted: ${myVotes.map(v => { const t = state.gators.find(q => q.id === v.targetId); return t ? `<strong>${t.name}</strong>` : ''; }).filter(Boolean).join(', ')}</div>`
        : '';

    // Witnessed thefts
    // History
    const historyRows = (p.history || []).slice().reverse().map(h =>
        `<div class="history-entry">Day ${h.day ?? '?'} — ${h.detail}</div>`
    ).join('');
    const historySection = p.history && p.history.length > 0
        ? `<div class="panel-section-title">\uD83D\uDCD6 History <span class="panel-count">${p.history.length}</span></div>
           <div class="panel-history">${historyRows}</div>`
        : '';

    // Chat history with inner thoughts
    const chatLogEntries = (p.chatLog || []).slice(-50).map(entry => {
        const gators = state.gators;
        const fromP = gators.find(q => q.id === entry.from);
        const toP = entry.to !== null ? gators.find(q => q.id === entry.to) : null;
        if (entry.type === 'thought') {
            return `<div class="chat-entry chat-entry-thought">
                <span class="chat-speaker">\uD83D\uDCAD Inner thought</span>
                ${entry.thought}
            </div>`;
        }
        if (entry.type === 'overheard') {
            return `<div class="chat-entry chat-entry-overheard">
                <span class="chat-speaker">\uD83D\uDC42 Overheard ${fromP?.name ?? '?'} → ${toP?.name ?? '?'}</span>
                ${entry.message}
            </div>`;
        }
        if (entry.type === 'private') {
            const isSelf = entry.from === p.id;
            const cls = isSelf ? 'chat-entry-self' : 'chat-entry-other';
            const speaker = fromP?.name ?? '?';
            const target = toP ? ` → ${toP.name}` : '';
            let html = `<div class="chat-entry ${cls} chat-entry-private">
                <span class="chat-speaker">🏠 ${speaker}${target} <span class="chat-private-badge">(private)</span></span>
                ${entry.message || ''}
            </div>`;
            if (isSelf && entry.thought) {
                html += `<div class="chat-entry chat-entry-thought">
                    <span class="chat-speaker">\uD83D\uDCAD What I was really thinking...</span>
                    ${entry.thought}
                </div>`;
            }
            return html;
        }
        const isSelf = entry.from === p.id;
        const cls = isSelf ? 'chat-entry-self' : 'chat-entry-other';
        const speaker = fromP?.name ?? '?';
        const target = toP ? ` → ${toP.name}` : '';
        let html = `<div class="chat-entry ${cls}">
            <span class="chat-speaker">${speaker}${target}</span>
            ${entry.message || 'empty/null'}
        </div>`;
        // Show truthful thought right after their own message
        if (isSelf && entry.thought) {
            html += `<div class="chat-entry chat-entry-thought">
                <span class="chat-speaker">\uD83D\uDCAD What I was really thinking...</span>
                ${entry.thought}
            </div>`;
        }
        return html;
    }).join('');
    const chatSection = (p.chatLog || []).length > 0
        ? `<div class="panel-section-title">\uD83D\uDCAC Chat Log <span class="panel-count">${p.chatLog.length}</span></div>
           <div class="panel-chat-history">${chatLogEntries}</div>`
        : '';

    panelContent.innerHTML =
        `<div class="panel-name">${p.name}${isMurderer ? ' <span class="panel-murderer">\uD83D\uDD2A Murderer</span>' : ''}${p.liar && !isMurderer ? ' <span class="panel-liar">\uD83C\uDFA0 Liar</span>' : ''}</div>` +
        `<div class="panel-meta">${PERSONALITY_EMOJI[p.personality]} ${p.personality[0].toUpperCase() + p.personality.slice(1)}</div>` +
        `<div class="panel-meta">${ACTIVITY_EMOJI[p.activity] ?? '\uD83D\uDDE3\uFE0F'} ${actDesc}</div>` +
        `<div class="panel-meta">Mood ${MOOD_EMOJI(mood)}</div>` +
        `<div class="panel-stats">` +
            `<div class="panel-stat-row">💭 Thought ${statBar(p.thoughtStat)} <span>${p.thoughtStat}/10</span></div>` +
        `</div>` +
        `<div class="panel-divider"></div>` +
        topSuspect + votedStr +
        `<div class="panel-divider"></div>` +
        `<div class="panel-section-title">\uD83E\uDD1D Relations</div>` +
        `<div class="panel-relations">${relRows}</div>` +
        (chatSection ? `<div class="panel-divider"></div>${chatSection}` : '') +
        (historySection ? `<div class="panel-divider"></div>${historySection}` : '');
}
