/**
 * @fileoverview simulation.js — Core simulation tick loop and conversation engine.
 *
 * This is the largest and most central module in the frontend. It exports two
 * public functions consumed by main.js:
 *
 *   initSimulation()
 *     Called once at page load. Spawns houses and gators, assigns the murderer,
 *     initialises all relationships, registers the setInterval tick loop, and
 *     calls the .NET API to initialise SK agents.
 *
 *   testConversation()
 *     Debug helper: picks two random living gators and a random topic, then
 *     immediately launches a full AI conversation between them.
 *
 * Internal tick loop (runs every TICK_MS ms via setInterval):
 *   Each tick:
 *     1. Decrements the day/night cycle timer.
 *     2. Moves each gator toward their target position.
 *     3. Evaluates whether any two gators are close enough to start a conversation.
 *     4. Manages the active conversation lock (only 1 AI conv at a time).
 *     5. Plays back buffered AI conversation turns if one is queued.
 *     6. Triggers phase transitions (night, dawn, debate, vote, execute) when timers expire.
 *     7. Calls renderAllGators() for the current frame.
 *
 * Conversation flow (public conversations):
 *   Two gators approach each other ? simulation triggers requestFullConversation() ?
 *   agentQueue buffers memories, calls POST /api/agent/conversation ? AI returns
 *   all turns ? agentQueue plays them back one at a time ? onComplete callback resets
 *   both gators to 'moving'.
 *
 * Private conversations (hosting/visiting):
 *   Same flow but isPrivate=true — speech is not shown to passers-by and
 *   the conversation enclosure DOM element wraps the house.
 *
 * Overhearing:
 *   When a gator speaks publicly, logChat() broadcasts the message to all gators
 *   within TALK_DIST. Overheard speech can update nearby gators' suspicion scores.
 *
 * @module simulation
 */
import {
    GATOR_SIZE, PHASE, TICK_MS, TALK_DIST, TALK_STOP,
    HOME_WARN_TICKS,
    VOTE_DISPLAY_TICKS,
    CONVICTION_THRESHOLD, GATOR_COUNT,
    PERSONALITY_EMOJI, DEBATE_SPEAK_COOLDOWN,
    BITE_DEATH_THRESHOLD, BITE_FLEE_MIN_MS, BITE_FLEE_EXTRA_MS,
    BITE_COUNTER_CHANCE, LIAR_FLIP_CHANCE, CONVERSATION_EXTRA_TURNS,
    TOWN_RADIUS_GUARD
} from './gameConfig.js';
import {
    rnd, rndF, rndTicks, stageBounds, dist, weightedPick,
    buildFigureSVG, culdesacLayout, buildCuldesacSVG,
    speakDelayMs, topicCompatibility, applyTopicRelationDelta,
    TOPICS, TOPIC_LABELS
} from './helpers.js';
import {
    createGator, initRelations, driftRelations, socialWeights, living
} from './gator.js';
import { state, resetGameState } from './state.js';
import {
    triggerNightfall, triggerDawn, triggerDebate, triggerVote,
    triggerExecute, showNextVoter, finaliseExecution,
    pickDebateSuspect, advanceDebateSpeaker
} from './phases.js';
import {
    renderGator, renderAllGators, updateStats, updatePhaseLabel,
    updateHouseGuests, syncTalkLines,
    initTooltip, showTooltip, moveTooltip, hideTooltip,
    pinTooltip, refreshPinnedTooltip, cleanPrivateChatBubbles,
    syncBabylonMeshes
} from './rendering.js';
import { ISLAND_TREE_POSITIONS, hudMakeAttack, hudInfluence } from './gatorBabylon.js';
import { requestDialog, requestFullConversation, requestVote, recordMemory, drainNextConvTurn, setTickFunction } from './agentQueue.js';

// -- Test Conversation -----------------------------------------
export function testConversation() {
    const alive = living();
    if (alive.length < 2) { console.warn('Need at least 2 gators'); return; }

    // Pick two random gators
    const shuffled = alive.sort(() => Math.random() - 0.5);
    const a = shuffled[0];
    const b = shuffled[1];

    // Pick a random topic
    const topic = TOPICS[rnd(TOPICS.length)];
    const topicLabel = TOPIC_LABELS[topic] ?? topic;

    // Build context from their personalities and topic opinions
    const aOpinion = a.topicOpinions?.[topic] ?? 'unknown';
    const bOpinion = b.topicOpinions?.[topic] ?? 'unknown';
    const context = `Test conversation about ${topicLabel}. ` +
        `${a.name} (${a.personality}) feels ${aOpinion} about ${topic}. ` +
        `${b.name} (${b.personality}) feels ${bOpinion} about ${topic}.`;

    // Random turn count: base 5 + a random extra (controlled by CONVERSATION_EXTRA_TURNS in GameConstants.cs)
    const maxTurns = 5 + rnd(CONVERSATION_EXTRA_TURNS);
    const openingLine = `Hey ${b.name}, what do you think about ${topicLabel}?`;

    // Position them near each other
    const { W, H } = stageBounds();
    const cx = W / 2, cy = H / 2;
    a.x = cx - 40; a.y = cy; a.targetX = cx - 40; a.targetY = cy;
    b.x = cx + 40; b.y = cy; b.targetX = cx + 40; b.targetY = cy;

    // Set them to talking state
    a.activity = 'talking'; a.talkingTo = b.id; a.ticksLeft = 9999;
    b.activity = 'talking'; b.talkingTo = a.id; b.ticksLeft = 9999;
    a.message = openingLine;
    state.activeConversation = true;

    console.log(`?? Test Conversation: ${a.name} & ${b.name} about ${topicLabel} (${maxTurns} turns)`);

    requestFullConversation(a, b, openingLine, maxTurns, context, false, () => {
        _onConversationCompleted();
        a.activity = 'moving'; a.talkingTo = null; a.ticksLeft = rndTicks('moving');
        b.activity = 'moving'; b.talkingTo = null; b.ticksLeft = rndTicks('moving');
    });
}

/**
 * Starts a conversation initiated by the POV-controlled gator with a chosen partner.
 * Called from gatorBabylon.js when the player clicks "Start Conversation" in the
 * POV context menu.  Mirrors the tick()-based conversation logic but bypasses all
 * guards (distance, cooldown, etc.) since the player explicitly requested it.
 *
 * Returns false if a conversation is already active or either gator is busy.
 */
export function startPovConversation(povGator, partner) {
    if (!povGator || !partner) return false;
    if (state.activeConversation) return false;
    if (povGator.talkingTo !== null || partner.talkingTo !== null) return false;
    if (povGator.activity === 'resting' || partner.activity === 'resting') return false;

    const dur = rndTicks('talking');
    povGator.activity  = 'talking'; povGator.talkingTo  = partner.id; povGator.ticksLeft = dur;
    partner.activity   = 'talking'; partner.talkingTo   = povGator.id; partner.ticksLeft = dur;
    state.activeConversation = true;

    const firstMeeting = !(povGator.met ??= new Set()).has(partner.id);
    if (firstMeeting) {
        povGator.met.add(partner.id);
        (partner.met ??= new Set()).add(povGator.id);
        const compat = topicCompatibility(povGator.topicOpinions ?? {}, partner.topicOpinions ?? {});
        const seed = Math.round(compat * 0.2);
        povGator.relations[partner.id] = Math.max(-100, Math.min(100, seed));
        partner.relations[povGator.id] = Math.max(-100, Math.min(100, seed));
        povGator.perceivedRelations[partner.id] = seed;
        partner.perceivedRelations[povGator.id]  = seed;
        const introCtx = `First meeting. ${povGator.name} has opinions: ${Object.entries(povGator.topicOpinions ?? {}).map(([t,v])=>`${t}:${v>0?'+':''}${v}`).join(', ')}.`;
        const openingLine = `Hi, I'm ${povGator.name}!`;
        povGator.message = openingLine;
        requestFullConversation(povGator, partner, openingLine, 6, introCtx, false, _onConversationCompleted);
        recordMemory(povGator.id, state.dayNumber, 'first_meeting', `Met ${partner.name} for the first time`, partner.id);
        recordMemory(partner.id, state.dayNumber, 'first_meeting', `Met ${povGator.name} for the first time`, povGator.id);
    } else {
        const openingLine = `Hey ${partner.name}!`;
        povGator.message = openingLine;
        requestFullConversation(povGator, partner, openingLine, 6, null, false, _onConversationCompleted);
        recordMemory(povGator.id, state.dayNumber, 'conversation_start', `Started talking with ${partner.name}`, partner.id);
        recordMemory(partner.id, state.dayNumber, 'conversation_start', `${povGator.name} started talking to me`, povGator.id);
    }
    return true;
}

/**
 * Cancels an active POV-initiated conversation between two gators.
 * Both gators immediately leave the talking state. Relation scores take a small
 * penalty since abruptly ending a conversation is rude.
 * Called from gatorBabylon.js when the player clicks "? Cancel Conversation".
 */
export function cancelPovConversation(povGator, partner) {
    if (!povGator || !partner) return;

    // Unlink talking state for both gators
    for (const g of [povGator, partner]) {
        g.talkingTo = null;
        g.activity  = 'moving';
        g.ticksLeft = rndTicks('moving');
        g.message   = null;
    }
    state.activeConversation = false;

    // Small relation penalty for the rude hang-up
    const CANCEL_PENALTY = 8;
    povGator.relations[partner.id]  = Math.max(-100, (povGator.relations[partner.id]  ?? 0) - CANCEL_PENALTY);
    partner.relations[povGator.id]  = Math.max(-100, (partner.relations[povGator.id]  ?? 0) - CANCEL_PENALTY);

    // Memory entry so they remember being snubbed
    recordMemory(partner.id, state.dayNumber, 'conversation_cancelled',
        `${povGator.name} walked away from our conversation abruptly.`, povGator.id);
}

// -- Chat logging & overhearing --------------------------------
/**
 * Logs a speech (or thought) event into the relevant gators' chat histories
 * and broadcasts it to nearby observers who can overhear.
 *
 * CALLED BY:
 *   - agentQueue._drainNextConvTurn() — for each AI conversation turn
 *   - Various phase helpers that generate scripted one-liners
 *
 * WHAT IT DOES:
 *   1. Builds a chat log entry { day, from, to, message, thought, ts, type }
 *      and pushes it to the speaker's chatLog.
 *   2. Pushes the same entry (without the thought) to the target's chatLog
 *      so both sides of the conversation are recorded from each perspective.
 *   3. If NOT private, iterates every LIVING gator. Any gator within TALK_DIST
 *      of the speaker receives an 'overheard' entry in their chatLog AND a
 *      recordMemory() call so the AI will remember they overheard this line.
 *
 * PRIVATE CONVERSATIONS (isPrivate = true):
 *   Hosting/visiting conversations are private. No overhearing. The only gators
 *   who receive the entry are the speaker and the direct target. This reflects
 *   that conversations inside a home are not audible to passersby.
 *
 * NOTE — SUSPICION via overhearing:
 *   When a gator overhears a line that mentions the murderer or accuses someone,
 *   that could update their suspicion score. The suspicion update is currently
 *   handled upstream (in _maybeShareOpinion and agentQueue context injection)
 *   rather than inside logChat itself.
 *
 * @param {object}  speaker   - Person object for the gator speaking.
 * @param {number|null} targetId - ID of the gator being spoken to, or null for broadcast.
 * @param {string}  message   - The speech text to log.
 * @param {string|null} thought - The speaker's inner thought (only stored on speaker's log).
 * @param {boolean} isPrivate - If true, no overhearing (hosting conversations).
 */
export function logChat(speaker, targetId, message, thought, isPrivate = false) {
    if (!message) return; // nothing meaningful to log
    const now = Date.now();
    const type = isPrivate ? 'private' : 'said';
    const entry = { day: state.dayNumber, from: speaker.id, to: targetId, message, thought: null, ts: now, type };
    const thoughtEntry = thought ? { day: state.dayNumber, from: speaker.id, to: null, message: null, thought, ts: now, type: 'thought' } : null;

    // Log to speaker
    speaker.chatLog.push(entry);
    if (thoughtEntry) speaker.chatLog.push(thoughtEntry);
    speaker.gameLog.push({ day: state.dayNumber, type: 'spoke', detail: `Said to ${state.gators.find(q => q.id === targetId)?.name ?? 'someone'}: "${message}"`, ts: now });

    // Log to target
    if (targetId !== null) {
        const target = state.gators.find(q => q.id === targetId);
        if (target) {
            target.chatLog.push({ ...entry, thought: null }); // target doesn't see speaker's thought
        }
    }

    // Private conversations cannot be overheard
    if (!isPrivate) {
        for (const obs of living()) {
            if (obs.id === speaker.id || obs.id === targetId) continue;
            if (dist(obs, speaker) <= TALK_DIST) {
                obs.chatLog.push({ day: state.dayNumber, from: speaker.id, to: targetId, message, thought: null, ts: now, type: 'overheard' });
                recordMemory(obs.id, state.dayNumber, 'overheard', `Overheard ${speaker.name} say: "${message}"`, speaker.id);
            }
        }
    }
}

// -- POV Attack -----------------------------------------------

// -- Vocabulary helpers -----------------------------------------------------
// Each function returns a randomly-selected reaction line for a specific
// social situation.  Keeping them in dedicated arrays makes it easy to add
// more lines later without touching any game logic.
//
// The seven contexts covered:
//   1. _vocabGetBit        — the victim's internal/spoken reaction to being bitten
//   2. _vocabBiting        — the attacker's internal monologue after biting someone
//   3. _vocabSawBite       — a neutral bystander who witnessed the bite
//   4. _vocabSawBiteOfLiked — bystander who *likes* the victim reacts with outrage
//   5. _vocabSawBiteOfHated — bystander who *dislikes* the victim feels little sympathy
//   6. _vocabLikedBitesHated — bystander likes the biter AND hates the victim (approves)
//   7. _vocabHatedBitesLiked — bystander hates the biter AND likes the victim (furious)

// -- 1. Getting bit: the victim's raw reaction -----------------
function _vocabGetBit(victim, biter) {
    const LINES = [
        // Original 5
        `${biter.name} sank their teeth right into me — I'll never forget this!`,
        `I can't believe ${biter.name} just BIT me! The nerve!`,
        `${biter.name} bit me hard. My scales are stinging and my blood is boiling.`,
        `Ouch! ${biter.name} just attacked me out of nowhere. I'm furious and shaking.`,
        `${biter.name} drew blood. I will NOT let this go.`,
        // Added lines (×3 total)
        `${biter.name} just bit me! That hurt — and I will make sure everyone knows!`,
        `The audacity of ${biter.name}! They bit me like I'm prey. I am NOT prey.`,
        `Pain shooting through my side — ${biter.name} just clamped down on me!`,
        `${biter.name}! How DARE you sink your teeth into me?! You're going to pay for that!`,
        `I'm bleeding and I'm furious. ${biter.name} is done as far as I'm concerned.`,
        `${biter.name} bit me without a single word of warning. What kind of swamp animal does that?`,
        `That bite from ${biter.name} is going to leave a mark — on my body AND on my memory.`,
        `${biter.name} attacked me! I can feel my heart pounding with rage right now.`,
        `Never, ever forgetting this. ${biter.name} just bit me in broad daylight.`,
        `My whole body is shaking. ${biter.name} bit me and I am absolutely seething.`,
    ];
    return LINES[rnd(LINES.length)];
}

// -- 2. Biting: the attacker's inner monologue -----------------
function _vocabBiting(biter, victim) {
    const LINES = [
        // Original 5
        `I just bit ${victim.name}. They had it coming.`,
        `Took a chunk out of ${victim.name}. No regrets.`,
        `${victim.name} needed to learn their lesson — so I bit them.`,
        `I snapped at ${victim.name}. Let's see who's laughing now.`,
        `Sank my teeth into ${victim.name}. This swamp has rules.`,
        // Added lines
        `${victim.name} crossed a line and I responded. Simple as that.`,
        `I bit ${victim.name}. Someone had to do it eventually.`,
        `My teeth found ${victim.name}'s hide. I feel no shame about it.`,
        `Bit ${victim.name} hard. Let them remember whose swamp this is.`,
        `${victim.name} won't forget that. Good. Neither will I.`,
        `Sometimes words aren't enough. That's why I bit ${victim.name}.`,
        `${victim.name} pushed me to this. I just gave them what they deserved.`,
        `I warned them, in my own way. Now ${victim.name} knows I'm serious.`,
        `One quick bite and ${victim.name} now understands where they stand.`,
        `Bit ${victim.name} and I'd do it again without hesitation.`,
    ];
    return LINES[rnd(LINES.length)];
}

// -- 3. Neutral witness: saw a bite, no strong feelings either way --
function _vocabSawBite(witness, biter, victim) {
    const LINES = [
        // Original 5
        `I just watched ${biter.name} bite ${victim.name}! That was brutal.`,
        `Did anyone else see that? ${biter.name} just attacked ${victim.name}!`,
        `${biter.name} bit ${victim.name} right in front of me. I'm shaken.`,
        `I can't believe what I just saw — ${biter.name} straight-up bit ${victim.name}.`,
        `${biter.name} is dangerous. I just watched them bite ${victim.name}.`,
        // Added lines
        `I witnessed it with my own eyes: ${biter.name} bit ${victim.name}. This place isn't safe.`,
        `${biter.name} just bit ${victim.name} — I'm still processing what I saw.`,
        `An actual bite! ${biter.name} snapped at ${victim.name} out of nowhere.`,
        `I saw ${biter.name} lunge at ${victim.name}. The violence was shocking.`,
        `${victim.name} is bleeding after ${biter.name}'s attack. I watched the whole thing.`,
        `That wasn't an accident — ${biter.name} intentionally bit ${victim.name}.`,
        `${biter.name} just showed us all who they really are by biting ${victim.name}.`,
        `I keep replaying it: ${biter.name} bit ${victim.name} without hesitation.`,
        `Everyone nearby saw it — ${biter.name} attacked ${victim.name} in the open.`,
        `${biter.name} bit ${victim.name} and then just stood there. Unbelievable.`,
    ];
    return LINES[rnd(LINES.length)];
}

// -- 4. Witness who LIKES the victim: outraged ----------------
function _vocabSawBiteOfLiked(witness, biter, victim) {
    const LINES = [
        // Original 5
        `${biter.name} bit ${victim.name}, who I consider a friend! I'm furious at ${biter.name}.`,
        `How dare ${biter.name} hurt ${victim.name}?! I care about them and this is unforgivable.`,
        `${victim.name} is my friend — seeing ${biter.name} bite them made my scales stand on end!`,
        `${biter.name} just attacked someone I like. This changes everything about how I see them.`,
        `Poor ${victim.name}! They're a friend of mine. ${biter.name} is going to regret that.`,
        // Added lines
        `${victim.name} is one of the kindest gators I know and ${biter.name} just BIT them!`,
        `I can't just stand by — ${biter.name} attacked my friend ${victim.name}. This is personal now.`,
        `${victim.name} didn't deserve that. ${biter.name} is going to answer for this.`,
        `My heart dropped watching ${biter.name} sink their teeth into ${victim.name}.`,
        `${victim.name} has always been good to me. Seeing ${biter.name} attack them is unbearable.`,
        `${biter.name} had no right! ${victim.name} is someone I respect and care about!`,
        `I'll remember this, ${biter.name}. You just hurt someone I genuinely like.`,
        `${victim.name} got bitten by ${biter.name}?! That's devastating — they're a true friend.`,
        `This isn't something I can look past. ${biter.name} attacked ${victim.name}, who I care about.`,
        `My blood is boiling. ${biter.name} bit ${victim.name} and I watched every moment of it.`,
    ];
    return LINES[rnd(LINES.length)];
}

// -- 5. Witness who HATES the victim: unsympathetic -----------
function _vocabSawBiteOfHated(witness, biter, victim) {
    const LINES = [
        // Original 5
        `${biter.name} bit ${victim.name}… honestly, I'm not that upset.`,
        `${victim.name} got bitten? Can't say I feel sorry — they're no friend of mine.`,
        `${biter.name} attacked ${victim.name}. Given what I think of ${victim.name}, I get it.`,
        `I saw the whole thing. ${victim.name} had enemies and it caught up with them.`,
        `${victim.name} got what was coming to them, if you ask me. ${biter.name} did what I wanted to.`,
        // Added lines
        `${biter.name} bit ${victim.name}? Good. ${victim.name} has never done anything for me.`,
        `I watched ${biter.name} bite ${victim.name}. My only reaction is a shrug.`,
        `${victim.name} finally got bit. I won't lose any sleep over that.`,
        `${biter.name} went after ${victim.name}. I can't say I disagree with the choice.`,
        `Honestly? ${victim.name} getting bitten doesn't bother me one bit.`,
        `${victim.name} has made plenty of enemies. Looks like ${biter.name} was just first.`,
        `${biter.name} bit ${victim.name}. I can find it in myself to feel…nothing. Not my concern.`,
        `${victim.name} wasn't exactly beloved around here. ${biter.name} acted on what many thought.`,
        `I saw ${biter.name} bite ${victim.name}. Was it violent? Yes. Do I care? Not particularly.`,
        `${victim.name} is not on my list of friends. Their bite drama is not my problem.`,
    ];
    return LINES[rnd(LINES.length)];
}

// -- 6. Witness LIKES the biter AND HATES the victim: satisfied --
function _vocabLikedBitesHated(witness, biter, victim) {
    const LINES = [
        // Original 5
        `${biter.name} — someone I like — just bit ${victim.name}, who I can't stand. Honestly? I'm relieved.`,
        `I won't lie: watching ${biter.name} bite ${victim.name} felt… satisfying. I dislike ${victim.name}.`,
        `${biter.name} handled ${victim.name}. I've been wanting someone to put ${victim.name} in their place!`,
        `A friend of mine just took a bite out of someone I despise. Hard not to cheer a little.`,
        `${biter.name} bit ${victim.name}. Knowing how awful ${victim.name} is, part of me approves.`,
        // Added lines
        `${biter.name} bit ${victim.name}? I've been waiting for someone to do that. Go, ${biter.name}.`,
        `Is it wrong that I'm glad? ${biter.name}, someone I trust, finally put ${victim.name} in their place.`,
        `${biter.name} and I see eye to eye — and that bite on ${victim.name} proves it.`,
        `${victim.name} has been pushing their luck. ${biter.name} was just the first to snap.`,
        `${biter.name} did what a lot of us wanted to do. ${victim.name} had this coming.`,
        `I like ${biter.name} even more after watching them bite ${victim.name}. Well done.`,
        `My feelings on ${victim.name} are low enough that watching ${biter.name} bite them felt… fair.`,
        `${biter.name} biting ${victim.name}? Best thing I've seen all day, honestly.`,
        `${biter.name} is a friend and they did what a friend does — they dealt with ${victim.name}.`,
        `${victim.name} deserved that. ${biter.name} just confirmed everything I already believed.`,
    ];
    return LINES[rnd(LINES.length)];
}

// -- 7. Witness HATES the biter AND LIKES the victim: enraged --
function _vocabHatedBitesLiked(witness, biter, victim) {
    const LINES = [
        // Original 5
        `${biter.name} — someone I already disliked — just attacked ${victim.name}, who I care about. I'm enraged.`,
        `Of course it was ${biter.name}! I never trusted them, and now they've hurt ${victim.name}.`,
        `${biter.name} bit ${victim.name}?! This confirms every bad thought I've had about ${biter.name}.`,
        `${victim.name} is my friend and ${biter.name} just bit them. I am absolutely done with ${biter.name}.`,
        `I always knew ${biter.name} was trouble. Now they've gone and hurt ${victim.name}. Unforgivable.`,
        // Added lines
        `${biter.name} just bit ${victim.name} — someone I care about deeply. I was right not to trust ${biter.name}.`,
        `Of COURSE ${biter.name} would do this. They've always been rotten and now ${victim.name} is paying for it.`,
        `${biter.name} is exactly the kind of gator I thought they were. Hurting ${victim.name} proves it.`,
        `I never liked ${biter.name} and today showed me why. ${victim.name} deserved none of that.`,
        `This is the worst possible outcome — ${biter.name} attacking ${victim.name}, someone I genuinely care about.`,
        `${biter.name} just attacked my friend ${victim.name}. Every suspicion I had just became a certainty.`,
        `${victim.name} is one of the good ones and ${biter.name} — who I've never trusted — just bit them. Appalling.`,
        `${biter.name} doing this to ${victim.name} is the final straw. I'm done giving them any benefit of the doubt.`,
        `If I had any shred of respect left for ${biter.name}, watching them bite ${victim.name} just destroyed it.`,
        `${biter.name} went after ${victim.name}?! My rage has no words. ${victim.name} is precious to me.`,
    ];
    return LINES[rnd(LINES.length)];
}

// -- Bite-count death -----------------------------------------
/**
 * Kills a gator that has been bitten too many times and broadcasts the event.
 * @param {object} victim - The gator dying from accumulated bites.
 * @param {object} biter  - The gator that delivered the fatal bite.
 */
function _killFromBites(victim, biter) {
    state.deadIds.add(victim.id);
    const day = state.dayNumber;
    const now = Date.now();
    const msg = `${victim.name} has been bitten too many times — they collapse and die! Everyone knows ${biter.name} was responsible.`;

    // Remove DOM element with a fade
    const el = document.getElementById(`gator-${victim.id}`);
    if (el) { el.style.transition = 'opacity 1.5s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 1600); }

    // Flash a global announcement bubble on the victim briefly
    victim.message = '?? I can\'t take any more...';

    // All surviving gators remember who caused this
    for (const g of living()) {
        if (g.id === victim.id) continue;
        g.history.push({ day, type: 'witnessed_death_by_biting', with: biter.id, delta: -40,
            detail: `${victim.name} died from bites delivered by ${biter.name}.` });
        g.chatLog.push({ day, from: biter.id, to: victim.id, message: msg, thought: null, ts: now, type: 'overheard' });
        // Fear the killer — everyone is scared of a gator that can kill
        g.fear[biter.id] = Math.min(100, (g.fear[biter.id] ?? 0) + 40);
        g.fearMemories.push({ day, aboutId: biter.id, reason: `${biter.name} bit ${victim.name} to death` });
        // Suspicion spikes
        g.suspicion[biter.id] = Math.min(100, (g.suspicion[biter.id] ?? 0) + 35);
        recordMemory(g.id, day, 'witnessed_death_by_biting',
            `${victim.name} was bitten to death by ${biter.name}. I fear ${biter.name}.`, biter.id);
    }
    updateStats();
    renderAllGators();
}

// -- Fight-or-flight timer -------------------------------------
/**
 * Starts the victim's panic flee window and schedules a possible counter-attack.
 * Called immediately after a bite is applied.
 */
function _startFightOrFlight(victim, biter) {
    // Flee window and counter-attack chance come from GameConstants.cs so they
    // can be tuned server-side without touching JS.
    const FLEE_MS        = BITE_FLEE_MIN_MS + rnd(BITE_FLEE_EXTRA_MS);
    const COUNTER_CHANCE = BITE_COUNTER_CHANCE;

    victim.biteFleeUntil = Date.now() + FLEE_MS;
    victim.lastBiterId   = biter.id;

    // CSS flash — add class, remove after 3 s
    const el = document.getElementById(`gator-${victim.id}`);
    if (el) {
        el.classList.add('bitten-flash');
        setTimeout(() => el.classList.remove('bitten-flash'), 3000);
    }

    // Give the victim a panic message for a couple of seconds
    victim.message = '?? OW!';
    setTimeout(() => { if (victim.message === '?? OW!') victim.message = null; }, 2500);

    // Make the victim flee toward a random far edge point
    const { W, H } = stageBounds();
    victim.activity  = 'moving';
    victim.talkingTo = null;
    const edge = rnd(4);
    victim.targetX = edge === 0 ? 60 : edge === 1 ? W - 60 : 60 + rnd(W - 120);
    victim.targetY = edge === 2 ? 60 : edge === 3 ? H - 60 : 60 + rnd(H - 120);

    // After the flee window: 45% fight back, 55% continue fleeing and cool down
    setTimeout(() => {
        victim.biteFleeUntil = 0;
        if (!state.deadIds.has(victim.id) && !state.deadIds.has(biter.id) &&
            Math.random() < COUNTER_CHANCE) {
            // Counter-attack!
            victim.message = `?? You'll pay for that, ${biter.name}!`;
            setTimeout(() => { if (victim.message?.includes('pay for that')) victim.message = null; }, 3000);
            // Trigger a smaller bite back — avoids infinite recursion by only one counter allowed
            applyBiteEffect(victim.id, biter.id, /* isCounter */ true);
        } else {
            victim.message = `?? I need to get away from ${biter.name}...`;
            setTimeout(() => { if (victim.message?.includes('get away')) victim.message = null; }, 3000);
        }
    }, FLEE_MS);
}

/**
 * Applies ALL social consequences of one gator biting another.
 *
 * This is the central function for the bite/attack system.  It handles
 * every downstream effect so callers never need to worry about partial state:
 *
 * -----------------------------------------------------------------
 * WHAT HAPPENS WHEN A GATOR IS BITTEN
 * -----------------------------------------------------------------
 *  1. Victim's relation to biter ? instantly -100 (maximum hatred).
 *  2. Victim's suspicion of biter spikes by +60 (often enough to convict).
 *  3. Victim's `biteCount` increments; at BITE_DEATH_THRESHOLD (default 5)
 *     the victim dies — _killFromBites() is called and the gator is removed.
 *  4. If not a counter-attack, victim enters fight-or-flight:
 *       – Red flash + screen-shake on their sprite.
 *       – Forced flee movement toward a random map edge.
 *       – After BITE_FLEE_MIN_MS + random extra, 45% chance of counter-bite.
 *  5. Vocabulary chatLog entries are generated for both biter and victim
 *     so the in-panel history feels natural and unique each time.
 *  6. Every living WITNESS gets one of 4 vocabulary types based on their
 *     existing feelings toward the biter and victim:
 *       – Neutral witness     ? _vocabSawBite()
 *       – Witness likes victim ? _vocabSawBiteOfLiked()
 *       – Witness hates victim ? _vocabSawBiteOfHated()
 *       – Witness likes biter AND hates victim ? _vocabLikedBitesHated()
 *       – Witness hates biter AND likes victim ? _vocabHatedBitesLiked()
 *  7. Fear of the biter rises for all witnesses and the victim.
 *  8. Each witness records a `biteObservation` object so _maybeGossipAboutBite()
 *     can reference it in future conversations.
 *
 * -----------------------------------------------------------------
 * COUNTER-ATTACK RECURSION GUARD
 * -----------------------------------------------------------------
 * When isCounter=true, step 4 (fight-or-flight) is skipped.  This prevents
 * an infinite loop: Gator A bites B ? B counter-bites A ? A counter-bites B ? …
 * Counter-attacks still apply all social consequences (steps 1–3, 5–8).
 *
 /**
 * Command a gator to walk toward a victim and bite them when close enough.
 * The gameLoop will override the attacker's normal wander target until
 * they reach bite range, then automatically fire applyBiteEffect.
 *
 * @param {number} attackerId - ID of the gator that will perform the bite.
 * @param {number} victimId   - ID of the gator to be bitten.
 */
export function commandAttack(attackerId, victimId) {
    const attacker = state.gators.find(g => g.id === attackerId);
    const victim   = state.gators.find(g => g.id === victimId);
    if (!attacker || !victim) return;
    if (state.deadIds.has(attackerId) || state.deadIds.has(victimId)) return;
    // Store the pending attack on the attacker object; gameLoop will consume it.
    attacker._pendingAttackTargetId = victimId;
    attacker.activity = 'moving';
    attacker.talkingTo = null;
}

/**
 * @param {number}  biterId    - Numeric ID of the gator that performed the bite.
 * @param {number}  victimId   - Numeric ID of the gator that was bitten.
 * @param {boolean} [isCounter=false] - Pass true if this is a counter-attack
 *                                      to suppress the fight-or-flight trigger.
 * @returns {{ biter:object, victim:object, witnessCount:number }|null}
 *          Returns null if either gator is dead or not found.
 */
export function applyBiteEffect(biterId, victimId, isCounter = false) {
    const biter  = state.gators.find(g => g.id === biterId);
    const victim = state.gators.find(g => g.id === victimId);
    if (!biter || !victim) return null;
    if (state.deadIds.has(biterId) || state.deadIds.has(victimId)) return null;

    // Guard: ensure array fields exist (defensive against partially-constructed gators)
    biter.history       ??= []; biter.chatLog       ??= [];
    victim.history      ??= []; victim.chatLog      ??= [];
    victim.fearMemories ??= []; biter.fearMemories  ??= [];
    victim.relations    ??= {}; victim.perceivedRelations ??= {}; victim.suspicion ??= {}; victim.fear ??= {};
    biter.relations     ??= {}; biter.perceivedRelations  ??= {}; biter.suspicion  ??= {}; biter.fear  ??= {};

    const day = state.dayNumber;
    const now = Date.now();

    // -- 1. Victim relation & suspicion -----------------------------------
    // The victim immediately despises the biter.  Liars hide this — their
    // perceivedRelations keeps a false positive to deceive the group.
    victim.relations[biterId]          = -100;
    victim.perceivedRelations[biterId] = victim.liar ? 60 : -100;
    victim.suspicion[biterId] = Math.min(100, (victim.suspicion[biterId] ?? 0) + 60);

    // -- 2. Vocabulary: vocab_got_bit -------------------------------------
    // Randomly selected from the 15-line _vocabGetBit() pool.
    const victimQuote = _vocabGetBit(victim, biter);
    victim.history.push({ day, type: 'vocab_got_bit', with: biterId, delta: -100, detail: victimQuote });
    victim.chatLog.push({ day, from: biterId, to: victimId, message: victimQuote, thought: null, ts: now, type: 'said' });

    // -- 3. Vocabulary: vocab_biting --------------------------------------
    // The biter's internal monologue — also from a 15-line pool.
    const biterQuote = _vocabBiting(biter, victim);
    biter.history.push({ day, type: 'vocab_biting', with: victimId, delta: 0, detail: biterQuote });
    biter.chatLog.push({ day, from: biterId, to: victimId, message: biterQuote, thought: null, ts: now, type: 'said' });

    // -- 4. Fear updates for victim -------------------------------
    victim.fear[biterId] = Math.min(100, (victim.fear[biterId] ?? 0) + 50);
    victim.fearMemories.push({ day, aboutId: biterId, reason: `${biter.name} bit me directly` });

    // -- 5. Bite count & possible death ---------------------------
    // Track total bites received.  BITE_DEATH_THRESHOLD is defined in GameConstants.cs.
    victim.biteCount = (victim.biteCount ?? 0) + 1;
    if (victim.biteCount >= BITE_DEATH_THRESHOLD) {
        // Schedule death after the flash finishes
        setTimeout(() => _killFromBites(victim, biter), 3200);
    }

    // -- 6. Fight-or-flight (skip if this is a counter-bite) ------
    if (!isCounter) {
        _startFightOrFlight(victim, biter);
    }

    // -- 7. Witnesses ---------------------------------------------
    const witnesses = living().filter(g =>
        g.id !== biterId && g.id !== victimId && dist(g, victim) <= TALK_DIST
    );

    witnesses.forEach(w => {
        // Guard witness arrays too
        w.history       ??= []; w.chatLog       ??= [];
        w.fearMemories  ??= []; w.relations     ??= {};
        w.perceivedRelations ??= {}; w.suspicion ??= {}; w.fear ??= {};

        const feelsBiter  = w.relations[biterId]  ?? 0;
        const feelsVictim = w.relations[victimId] ?? 0;
        const likesVictim = feelsVictim > 20;
        const hatesVictim = feelsVictim < -20;
        const likesBiter  = feelsBiter  > 20;
        const hatesBiter  = feelsBiter  < -20;

        // Choose vocabulary type
        let witnessQuote, vocabType;
        if (likesBiter && hatesVictim) {
            witnessQuote = _vocabLikedBitesHated(w, biter, victim);
            vocabType    = 'vocab_saw_liked_bite_hated';
        } else if (hatesBiter && likesVictim) {
            witnessQuote = _vocabHatedBitesLiked(w, biter, victim);
            vocabType    = 'vocab_saw_hated_bite_liked';
        } else if (likesVictim) {
            witnessQuote = _vocabSawBiteOfLiked(w, biter, victim);
            vocabType    = 'vocab_saw_bite_of_liked';
        } else if (hatesVictim) {
            witnessQuote = _vocabSawBiteOfHated(w, biter, victim);
            vocabType    = 'vocab_saw_bite_of_hated';
        } else {
            witnessQuote = _vocabSawBite(w, biter, victim);
            vocabType    = 'vocab_saw_bite';
        }

        // Relation change depends on context
        const relDelta = (likesBiter && hatesVictim) ? -5  // mild — kind of agree
                       : (hatesBiter && likesVictim) ? -50 // furious
                       : hatesVictim                 ? -10 // some distrust
                       :                              -30; // default disapproval
        w.relations[biterId] = Math.max(-100, (w.relations[biterId] ?? 0) + relDelta);
        if (!w.liar || w.relations[biterId] >= -20) w.perceivedRelations[biterId] = w.relations[biterId];

        // Suspicion
        const suspDelta = (likesBiter && hatesVictim) ? 5 : hatesVictim ? 10 : 25;
        w.suspicion[biterId] = Math.min(100, (w.suspicion[biterId] ?? 0) + suspDelta);

        // Fear of the biter
        const fearDelta = hatesBiter ? 30 : likesBiter ? 10 : 20;
        w.fear[biterId] = Math.min(100, (w.fear[biterId] ?? 0) + fearDelta);
        w.fearMemories.push({ day, aboutId: biterId, reason: `Saw ${biter.name} bite ${victim.name}` });

        // Store bite observation for future gossip
        w.biteObservations = w.biteObservations ?? [];
        w.biteObservations.push({ day, biterId, biterName: biter.name, victimId, victimName: victim.name, vocabType });

        w.chatLog.push({ day, from: biterId, to: victimId,
            message: witnessQuote, thought: null, ts: now, type: 'overheard' });
        w.history.push({ day, type: vocabType, with: biterId, delta: relDelta,
            detail: witnessQuote });

        // Vote intention nudge based on emotional context
        // If horrified, push toward voting the biter out
        if (relDelta <= -30) {
            w.voteIntentNudge = w.voteIntentNudge ?? {};
            w.voteIntentNudge[biterId] = (w.voteIntentNudge[biterId] ?? 0) + 15;
        } else if (relDelta >= -5) {
            // Slightly agrees with the attack — nudge toward NOT voting biter
            w.voteIntentNudge = w.voteIntentNudge ?? {};
            w.voteIntentNudge[biterId] = (w.voteIntentNudge[biterId] ?? 0) - 5;
        }

        recordMemory(w.id, day, vocabType, witnessQuote, biterId);
    });

    // -- 8. AI memories -----------------------------------------
    recordMemory(victimId, day, 'vocab_got_bit', victimQuote, biterId);
    recordMemory(biterId,  day, 'vocab_biting',  biterQuote,  victimId);

    return { biter, victim, witnessCount: witnesses.length };
}

// -- Conversation completion counter ---------------------------
/**
 * Called every time a full AI conversation concludes (public or hosting).
 *
 * RESPONSIBILITIES:
 *   Clears the global `state.activeConversation` flag so new conversations
 *   can start on the next tick. Days are purely time-based (DAY_TICKS);
 *   nightfall fires when the cycle timer expires.
 *
 * CALL SITES:
 *   - simulation.js tick() — when two street-talking gators finish their conversation
 *   - simulation.js hosting block — via onHostingComplete callback
 *   - agentQueue._drainNextConvTurn() — via the onComplete callback
 *   - simulation.js testConversation() — debug helper
 */
function _onConversationCompleted() {
    state.activeConversation = false;
    console.log('[Day] Conversation completed.');
}

// -- Opinion sharing helper ------------------------------------
/**
 * Called at the END of a street conversation (after driftRelations) to
 * simulate one gator sharing their opinion of a THIRD gator with the listener.
 *
 * This is how rumours and reputation spread through the village — gators gossip
 * about each other and gradually update their second-hand opinions.
 *
 * PROBABILITY:
 *   30% chance per conversation (70% of the time nothing is shared).
 *   This keeps gossip feeling sporadic and organic rather than constant.
 *
 * THREE PATHS depending on speaker's feelings toward the listener:
 *
 * PATH A — Speaker DISLIKES listener (relation < -30):
 *   Sub-path A1 (50%): Guarded response. Speaker says little and is evasive.
 *     Records a 'guarded' history entry. Sets a 2.5s speak cooldown.
 *   Sub-path A2 (50%): Speaker actively LIES to frame an enemy.
 *     Picks a disliked third gator as the "target" and a liked gator as the
 *     "victim." Asks the AI to generate a framing line. Nudges the listener's
 *     suspicion of the target upward, proportional to how much the listener
 *     trusts the speaker.
 *
 * PATH B — Normal (honest) opinion sharing:
 *   Picks the third gator the speaker has the STRONGEST opinion about
 *   (positive or negative, by absolute value).
 *   If the speaker is a liar AND has low trust with the listener, there is a
 *   40% chance they FLIP the opinion (pretend to like someone they hate, or vice versa).
 *   The listener's relation toward the target is nudged by:
 *     influence = (trust / 100) * 18 + 4   (range: ~4..22)
 *     nudge = ±influence depending on whether the opinion was positive or negative
 *   Both speaker and listener get history entries. If nudge > 5, the listener
 *   also gets an 'opinion_changed' history entry for the end-game report.
 *
 * @param {object} speaker  - Person object for the gator doing the gossip.
 * @param {object} listener - Person object for the gator receiving the gossip.
 */
function _maybeShareOpinion(speaker, listener) {
    if (Math.random() > 0.30) return; // 30% chance per conversation
    const others = living().filter(q => q.id !== speaker.id && q.id !== listener.id);
    if (others.length === 0) return;

    const speakerFeelsListener = speaker.relations[listener.id] ?? 0;

    // If speaker dislikes listener, they may be guarded or lie to incriminate
    if (speakerFeelsListener < -30) {
        // Guarded: say little, or actively lie
        if (Math.random() < 0.5) {
            // Guarded response
            const ctx = `You are talking to ${listener.name} but you dislike them. Be evasive.`;
            requestDialog(speaker, 'guarded', listener.id, ctx);
            speaker.nextSpeakAt = Date.now() + 2500;
            speaker.history.push({ day: state.dayNumber, type: 'guarded', with: listener.id, detail: `Was guarded talking to ${listener.name}` });
            return;
        } else {
            // Lie to incriminate: pick someone they dislike and blame them
            const enemies = others.filter(q => (speaker.relations[q.id] ?? 0) < -20);
            const victims = others.filter(q => (speaker.relations[q.id] ?? 0) > 10);
            if (enemies.length > 0 && victims.length > 0) {
                const target = enemies[rnd(enemies.length)];
                const victim = victims[rnd(victims.length)];
                const ctx = `You are lying to ${listener.name} to frame ${target.name}. Blame ${target.name} for something ${victim.name} experienced.`;
                requestDialog(speaker, 'opinion', listener.id, ctx);
                speaker.nextSpeakAt = Date.now() + 2500;
                // Listener adjusts suspicion of the target
                const trust = Math.max(0, listener.relations[speaker.id] ?? 0);
                const influence = (trust / 100) * 25 + 8;
                listener.suspicion[target.id] = Math.min(100, (listener.suspicion[target.id] ?? 0) + influence);
                listener.relations[target.id] = Math.max(-100, (listener.relations[target.id] ?? 0) - influence * 0.5);
                speaker.history.push({ day: state.dayNumber, type: 'lied', to: listener.id, about: target.id, detail: `Lied to ${listener.name} to frame ${target.name}` });
                listener.history.push({ day: state.dayNumber, type: 'heard_rumor', from: speaker.id, about: target.id, detail: `Heard from ${speaker.name} that ${target.name} is suspicious` });
                return;
            }
        }
    }

    // Normal truthful opinion sharing
    // Pick the gator speaker has the strongest opinion about
    const target = others.reduce((best, c) =>
        Math.abs(speaker.relations[c.id] ?? 0) > Math.abs(speaker.relations[best.id] ?? 0) ? c : best
    , others[0]);

    // If speaker likes listener, they're more truthful. If disliking, may flip opinion.
    let opinion = speaker.relations[target.id] ?? 0;
    const trustworthy = speakerFeelsListener > 20;
    // LIAR_FLIP_CHANCE controls how often a dishonest gator deliberately
    // reverses their opinion before sharing it (defined in GameConstants.cs).
    if (!trustworthy && speaker.liar && Math.random() < LIAR_FLIP_CHANCE) {
        opinion = -opinion; // flip the opinion when lying
        speaker.history.push({ day: state.dayNumber, type: 'lied_opinion', to: listener.id, about: target.id, detail: `Lied about feelings toward ${target.name} to ${listener.name}` });
    }

    const isPositive = opinion >= 0;
    const ctx = `You are sharing your ${isPositive ? 'positive' : 'negative'} opinion about ${target.name} with ${listener.name}.`;
    requestDialog(speaker, 'opinion', listener.id, ctx);
    speaker.nextSpeakAt = Date.now() + 2500;

    // Listener adjusts their opinion of the target based on how much they trust the speaker
    const trust = Math.max(0, listener.relations[speaker.id] ?? 0);
    const influence = (trust / 100) * 18 + 4;
    const nudge = isPositive ? influence : -influence;
    const oldRel = listener.relations[target.id] ?? 0;
    listener.relations[target.id] = Math.max(-100, Math.min(100, oldRel + nudge));
    listener.perceivedRelations[target.id] = listener.relations[target.id];
    // Reinforce mutual distrust: distrustful listeners distrust disliked targets more
    if ((listener.relations[target.id] ?? 0) < -20) {
        listener.suspicion[target.id] = Math.min(100,
            (listener.suspicion[target.id] ?? 0) + Math.abs(nudge) * 0.4);
    }

    // Record history
    speaker.history.push({ day: state.dayNumber, type: 'shared_opinion', to: listener.id, about: target.id, positive: isPositive, detail: `Told ${listener.name} ${isPositive ? 'good' : 'bad'} things about ${target.name}` });
    if (Math.abs(nudge) > 5) {
        listener.history.push({ day: state.dayNumber, type: 'opinion_changed', about: target.id, delta: Math.round(nudge), detail: `${speaker.name} ${isPositive ? 'praised' : 'badmouthed'} ${target.name}, changed opinion by ${Math.round(nudge)}` });
    }
}

// -- Bite gossip -----------------------------------------------
/**
 * Called at the END of a conversation (just like _maybeShareOpinion).
 * If the speaker has witnessed a bite this session, there is a 35% chance
 * they bring it up with the listener and the conversation influences:
 *   - Whether the listener agrees/disagrees with the fight (affects relation to biter)
 *   - Who the listener thinks should have won (opinion of biter vs victim)
 *   - Vote-intention nudge toward the biter if both agree on the fight
 *
 * Covers all three conversation sub-goals from the design spec.
 *
 * @param {object} speaker  - Person sharing what they saw.
 * @param {object} listener - Person receiving the account.
 */
function _maybeGossipAboutBite(speaker, listener) {
    if (Math.random() > 0.35) return;
    const obs = speaker.biteObservations;
    if (!obs || obs.length === 0) return;

    // Pick the most recent observation (freshest news)
    const event = obs[obs.length - 1];
    const biter  = state.gators.find(g => g.id === event.biterId);
    const victim = state.gators.find(g => g.id === event.victimId);
    if (!biter || !victim) return;
    if (state.deadIds.has(speaker.id) || state.deadIds.has(listener.id)) return;

    const day = state.dayNumber;
    const now = Date.now();

    // -- 1. Does the listener agree with the fight? --------------
    // Agreement = listener already dislikes the victim OR likes the biter
    const listenerFeelsBiter  = listener.relations[event.biterId]  ?? 0;
    const listenerFeelsVictim = listener.relations[event.victimId] ?? 0;
    const agrees = (listenerFeelsBiter > 10) || (listenerFeelsVictim < -10);

    // Build the gossip line — different pools depending on whether
    // the speaker approves of what the biter did.
    const GOSSIP_AGREE = [
        // Original 3
        `Did you see what ${biter.name} did to ${victim.name}? Honestly… ${victim.name} had it coming.`,
        `I saw ${biter.name} bite ${victim.name}. Between us? I think ${victim.name} pushed them to it.`,
        `${biter.name} bit ${victim.name}. I'm not exactly crying over it, if I'm being honest.`,
        // Added lines
        `${biter.name} finally snapped at ${victim.name}. Can't say I blame them.`,
        `You hear about ${biter.name} and ${victim.name}? I think ${biter.name} was provoked.`,
        `${victim.name} has been asking for trouble. ${biter.name} just delivered it.`,
        `${biter.name} bit ${victim.name} and honestly? That's been a long time coming.`,
        `I watched ${biter.name} attack ${victim.name}. My first thought was 'about time'.`,
        `Between you and me, ${victim.name} isn't exactly innocent here. ${biter.name} just reacted.`,
    ];
    const GOSSIP_DISAGREE = [
        // Original 3
        `I witnessed ${biter.name} bite ${victim.name}! That was completely uncalled for.`,
        `${biter.name} just attacked ${victim.name} out of nowhere. I can't believe anyone would do that.`,
        `Did you hear? ${biter.name} bit ${victim.name}. It was brutal and totally unprovoked.`,
        // Added lines
        `${biter.name} went after ${victim.name} today. It was shocking — totally without warning.`,
        `I saw ${biter.name} bite ${victim.name} and I'm still rattled. That kind of violence scares me.`,
        `${biter.name} is dangerous. They bit ${victim.name} for no reason I could see.`,
        `Can you believe ${biter.name}? They attacked ${victim.name} in broad daylight.`,
        `${biter.name} bit ${victim.name} and I think we all need to take that seriously.`,
        `I'm going to remember that ${biter.name} bit ${victim.name}. That's not something I can ignore.`,
    ];
    const speakerFeelsBiter = speaker.relations[event.biterId] ?? 0;
    const speakerApproves   = (speakerFeelsBiter > 10) || ((speaker.relations[event.victimId] ?? 0) < -10);
    const gossipLine = speakerApproves
        ? GOSSIP_AGREE[rnd(GOSSIP_AGREE.length)]
        : GOSSIP_DISAGREE[rnd(GOSSIP_DISAGREE.length)];

    // Log to both gators
    speaker.chatLog.push({ day, from: speaker.id, to: listener.id, message: gossipLine, thought: null, ts: now, type: 'said' });
    listener.chatLog.push({ day, from: speaker.id, to: listener.id, message: gossipLine, thought: null, ts: now, type: 'overheard' });
    speaker.history.push({ day, type: 'gossiped_about_bite', with: listener.id, detail: gossipLine });

    // -- 2. Who should have won? / Vote influence ----------------
    // If listener agrees with the speaker AND both dislike the victim, they mutually
    // push suspicion toward the victim (they deserved it — but might be dangerous).
    // If listener is horrified, suspicion of biter goes up.
    const trust = Math.max(0, listener.relations[speaker.id] ?? 0);
    const influence = (trust / 100) * 20 + 5;

    if (agrees && speakerApproves) {
        // Both agree the victim deserved it ? nudge suspicion of VICTIM (bad actor)
        listener.suspicion[event.victimId] = Math.min(100, (listener.suspicion[event.victimId] ?? 0) + influence * 0.5);
        // Vote nudge away from victim
        listener.voteIntentNudge = listener.voteIntentNudge ?? {};
        listener.voteIntentNudge[event.victimId] = (listener.voteIntentNudge[event.victimId] ?? 0) + 8;
        listener.history.push({ day, type: 'bite_gossip_agreed', with: event.biterId, detail: `${speaker.name} and I agree ${biter.name} was right to bite ${victim.name}.` });
        recordMemory(listener.id, day, 'bite_gossip_agreed',
            `${speaker.name} told me about ${biter.name} biting ${victim.name}. We both think ${victim.name} had it coming.`, event.biterId);
    } else {
        // Listener horrified ? suspicion of biter goes up, vote nudge toward biter
        listener.suspicion[event.biterId] = Math.min(100, (listener.suspicion[event.biterId] ?? 0) + influence);
        listener.relations[event.biterId] = Math.max(-100, (listener.relations[event.biterId] ?? 0) - influence * 0.4);
        listener.voteIntentNudge = listener.voteIntentNudge ?? {};
        listener.voteIntentNudge[event.biterId] = (listener.voteIntentNudge[event.biterId] ?? 0) + 12;
        listener.history.push({ day, type: 'bite_gossip_horrified', with: event.biterId, detail: `${speaker.name} told me ${biter.name} bit ${victim.name}. I think ${biter.name} is dangerous.` });
        recordMemory(listener.id, day, 'bite_gossip_horrified',
            `${speaker.name} warned me that ${biter.name} attacked ${victim.name}. I see ${biter.name} as a threat.`, event.biterId);
    }
}

// -- Activity tick
/**
 * The main simulation tick — called every TICK_MS milliseconds by setInterval.
 *
 * -----------------------------------------------------------------------
 * TICK LOOP OVERVIEW (runs once per TICK_MS, e.g. every 250ms)
 * -----------------------------------------------------------------------
 *
 * 1. EARLY RETURNS
 *    - If game is OVER or paused, do nothing.
 *
 * 2. CYCLE TIMER
 *    - Decrements state.cycleTimer each tick.
 *    - When it hits 0, triggers the next phase transition:
 *        DAY    ? triggerNightfall()
 *        NIGHT  ? triggerDawn()
 *        DAWN   ? triggerDebate()
 *        DEBATE ? triggerVote()
 *        VOTE   ? triggerExecute()
 *
 * 3. HOME WARNING
 *    - At HOME_WARN_TICKS ticks remaining in the day, all active conversations
 *      are cut short and every gator starts walking home.
 *
 * 4. PHASE-SPECIFIC BRANCHES
 *    - VOTE phase: advances the sequential vote cursor on a timer.
 *    - EXECUTE phase: moves the condemned gator to centre, then finalises.
 *    - NIGHT phase: returns early (no gator logic during night).
 *
 * 6. PER-GATOR LOOP
 *    For each living gator:
 *      a. Decrement ticksLeft.
 *      b. Handle DEBATING (generate accusation/defence messages).
 *      c. Skip gators still mid-activity (ticksLeft > 0).
 *      d. End TALKING: if AI call or turn drain is still running, keep waiting.
 *         Otherwise: drift relations, record memories, fire _maybeShareOpinion,
 *         fire _onConversationCompleted.
 *      e. End HOSTING: release guests, apply topic delta, fire onHostingComplete.
 *      f. End VISITING: release gator, put back to 'moving'.
 *      g. Choose next activity via weightedPick(socialWeights(gator)).
 *         - 'talking': find a nearby eligible partner; start a conversation.
 *         - 'hosting': find a free guest; send them to the host's home.
 *         - 'moving':  pick a new random target position.
 *
 * 7. RENDER
 *    - renderGator() is called on every living gator.
 *    - Private chat enclosures are cleaned up.
 *    - updateStats() refreshes the HUD.
 *
 * NOTE: Pixel movement (smooth animation) happens in gameLoop() via
 * requestAnimationFrame — NOT here. The tick only updates logical activity
 * state; gameLoop() reads that state to move sprites each animation frame.
 */
function tick() {
    if (state.gamePhase === PHASE.OVER) return;
    if (state.paused) return;

    state.cycleTimer--;
    if (state.cycleTimer <= 0) {
        if      (state.gamePhase === PHASE.DAY)    { triggerNightfall(); return; }
        else if (state.gamePhase === PHASE.NIGHT)  { triggerDawn();      return; }
        else if (state.gamePhase === PHASE.DAWN)   { triggerDebate();    return; }
        else if (state.gamePhase === PHASE.DEBATE) { triggerVote();      return; }
        else if (state.gamePhase === PHASE.VOTE)   { triggerExecute();   return; }
    }

    // At HOME_WARN_TICKS left in the day, end all conversations and walk everyone home
    if (state.gamePhase === PHASE.DAY && state.cycleTimer === HOME_WARN_TICKS) {
        for (const p of living()) {
            if (p.talkingTo !== null) {
                const partner = state.gators.find(q => q.id === p.talkingTo);
                if (partner) { partner.talkingTo = null; partner.message = null; partner.ticksLeft = 1; }
                p.talkingTo = null; p.message = null; p.ticksLeft = 1;
            }
            if (!p.indoors) {
                const h = state.houses[p.homeIndex];
                p.targetX = h.doorX - GATOR_SIZE / 2;
                p.targetY = h.doorY + 10;
            }
        }
        state.talkLines.forEach(l => l.remove()); state.talkLines.clear();
        state.noNewConversations = true;
    }

    // Debate floor:
    // debateSpeakerWaiting is true while an async AI call is in-flight; we freeze
    // the timer so the floor doesn't advance before the AI responds.
    if (state.gamePhase === PHASE.DEBATE) {
        if (!state.debateSpeakerWaiting) {
            state.debateSpeakerTimer--;
            if (state.debateSpeakerTimer <= 0) {
                advanceDebateSpeaker();
            }
        }
        updatePhaseLabel();
        // Still run per-gator movement below (they walk to their positions)
    }

    // Sequential vote: advance to next voter each VOTE_DISPLAY_TICKS ticks
    if (state.gamePhase === PHASE.VOTE) {
        state.voteDisplayTimer--;
        if (state.voteDisplayTimer <= 0) {
            state.voteIndex++;
            showNextVoter();
        }
        updatePhaseLabel();
        return;
    }

    // Execute phase: wait for condemned to reach centre, then die
    if (state.gamePhase === PHASE.EXECUTE) {
        if (state.condemnedId !== null) {
            const condemned = state.gators.find(p => p.id === state.condemnedId);
            if (condemned) {
                const worldEl = document.getElementById('world');
                const cx = worldEl.clientWidth  / 2 - GATOR_SIZE / 2;
                const cy = worldEl.clientHeight / 2 - GATOR_SIZE / 2;
                const dx = cx - condemned.x, dy = cy - condemned.y;
                const d  = Math.sqrt(dx*dx + dy*dy);
                if (d < 20) {
                    state.executeTimer--;
                    if (state.executeTimer <= 0) {
                        finaliseExecution();
                        return;
                    }
                }
            }
        } else {
            finaliseExecution();
            return;
        }
        updatePhaseLabel();
        return;
    }

    updatePhaseLabel();
    if (state.gamePhase === PHASE.NIGHT) return;

    const activePeople = living();

    // -- Radial guard: push any gator outside the configured town radius back toward centre --
    {
        const { W, H } = stageBounds();
        const cx = W / 2, cy = H / 2;
        for (const p of activePeople) {
            const dx = p.x - cx, dy = p.y - cy;
            const d  = Math.sqrt(dx * dx + dy * dy);
            if (d > TOWN_RADIUS_GUARD) {
                const scale = TOWN_RADIUS_GUARD / d;
                p.x = cx + dx * scale;
                p.y = cy + dy * scale;
                p.targetX = cx;
                p.targetY = cy;
            }
        }
    }

    const free = new Set(
        activePeople.filter(p =>
            p.activity !== 'resting' &&
            p.activity !== 'visiting' &&
            p.talkingTo === null
        ).map(p => p.id)
    );

    // (debate speaker count tracking removed — floor is now managed by advanceDebateSpeaker())

    for (const gator of activePeople) {
        gator.ticksLeft--;

        // Invitation disabled — conversations limited to 2 alligators

        if (gator.ticksLeft > 0) continue;

        // End talking
        if (gator.talkingTo !== null) {
            const partner = state.gators.find(p => p.id === gator.talkingTo);
            if (partner && partner.talkingTo === gator.id) {
                // Hold gators in place while AI call is in-flight OR turns are still playing back OR in final hold
                const aiPending = gator.isWaiting || partner.isWaiting;
                const gatorDraining = gator._convTurns && gator._convTurnIndex < gator._convTurns.length;
                const partnerDraining = partner._convTurns && partner._convTurnIndex < partner._convTurns.length;
                const finalHold = gator._convHolding || partner._convHolding;
                if (aiPending || gatorDraining || partnerDraining || finalHold) {
                    gator.ticksLeft = 1; // keep ticking until AI + playback finishes
                    continue;
                }
                driftRelations(gator, partner);
                recordMemory(gator.id, state.dayNumber, 'conversation_end', `Finished talking with ${partner.name}`, partner.id);
                recordMemory(partner.id, state.dayNumber, 'conversation_end', `Finished talking with ${gator.name}`, gator.id);
                const pFeels = gator.relations[partner.id] ?? 0;
                const qFeels = partner.relations[gator.id] ?? 0;
                const pSentiment = pFeels > 20 ? 'positive' : pFeels < -20 ? 'negative' : 'neutral';
                const qSentiment = qFeels > 20 ? 'positive' : qFeels < -20 ? 'negative' : 'neutral';
                gator.history.push({ day: state.dayNumber, type: 'talked', with: partner.id, sentiment: pSentiment, detail: `Talked with ${partner.name} (felt ${pSentiment})` });
                partner.history.push({ day: state.dayNumber, type: 'talked', with: gator.id, sentiment: qSentiment, detail: `Talked with ${gator.name} (felt ${qSentiment})` });
                const now = Date.now();
                (gator.recentTalkWith   ??= {})[partner.id] = now;
                (partner.recentTalkWith ??= {})[gator.id]   = now;
                partner.talkingTo = null;
                partner.ticksLeft = 0;
                free.add(partner.id);
                _maybeShareOpinion(gator, partner);
                _maybeGossipAboutBite(gator, partner);

                // Conversation completion is now tracked via the onComplete callback from agentQueue
                _onConversationCompleted();
            }
            gator.talkingTo = null;
            gator.message   = null;
            free.add(gator.id);
        }

        // End hosting — guests leave (but only once AI drain + 3s hold is done)
        if (gator.activity === 'hosting') {
            // Hold in place while AI call is in-flight, drain is still active, or in post-conv hold
            const aiPending = gator.isWaiting || state.gators.some(g => g.guestOfIndex === gator.homeIndex && g.isWaiting);
            const drainActive = (gator._convTurns && gator._convTurns.length > 0);
            const holdActive  = !!gator._convHolding;
            if (aiPending || drainActive || holdActive) {
                gator.ticksLeft = 1;
                continue;
            }
            for (const guest of state.gators) {
                if (guest.guestOfIndex === gator.homeIndex) {
                    driftRelations(gator, guest);
                    const now = Date.now();
                    (gator.recentTalkWith  ??= {})[guest.id]  = now;
                    (guest.recentTalkWith  ??= {})[gator.id]  = now;
                    guest.guestOfIndex = null;
                    guest.talkingTo    = null;
                    guest.indoors      = false;
                    guest.activity     = 'moving';
                    guest.ticksLeft    = rndTicks('moving');
                    const h = state.houses[gator.homeIndex];
                    guest.x = h.doorX + rndF(16) - 8;
                    guest.y = h.doorY + rndF(16) - 8;
                    guest.targetX = guest.x + rndF(60) - 30;
                    guest.targetY = guest.y + rndF(60) - 30;
                    free.add(guest.id);
                }
            }
            gator.talkingTo = null;
            gator.indoors  = false;
            gator.activity = 'moving';
            gator.message  = null;
            gator.ticksLeft = rndTicks('moving');
            const h = state.houses[gator.homeIndex];
            gator.x = h.doorX;
            gator.y = h.doorY;
            free.add(gator.id);
            updateHouseGuests();
            continue;
        }

        // End visiting
        if (gator.activity === 'visiting') {
            gator.guestOfIndex = null;
            gator.talkingTo    = null;
            gator.indoors      = false;
            gator.activity     = 'moving';
            gator.message      = null;
            gator.ticksLeft    = rndTicks('moving');
            free.add(gator.id);
            updateHouseGuests();
            continue;
        }

        // Debating — ends only when the phase timer fires
        if (gator.activity === 'debating') continue;

        let next = weightedPick(socialWeights(gator));

        if (next === 'talking') {
            const TALK_COOLDOWN_MS = 60_000;
            const now = Date.now();
            // Don't start new conversations if one is already active or end-of-day lock is set.
            // Also skip if this gator is currently the POV-controlled gator.
            if (!state.activeConversation && !state.noNewConversations && gator.id !== state.povGatorId) {
            const nearby = [...free]
                .filter(id => id !== gator.id)
                .filter(id => id !== state.povGatorId)  // never drag the POV gator into a conversation
                .map(id => state.gators.find(p => p.id === id))
                .filter(p => p && dist(gator, p) <= TALK_DIST)
                .filter(p => (gator.relations[p.id] ?? 0) > -60)
                .filter(p => (now - ((gator.recentTalkWith ?? {})[p.id] ?? 0)) >= TALK_COOLDOWN_MS)
                .filter(p => p.activity !== 'talking' && p.talkingTo == null); // Don't invite gators already committed to a conversation

            if (nearby.length > 0) {
                const partner = nearby.reduce((best, cand) => {
                    const bScore = (gator.relations[best.id] ?? 0) + rnd(40);
                    const cScore = (gator.relations[cand.id] ?? 0) + rnd(40);
                    return cScore > bScore ? cand : best;
                });
                const dur = rndTicks('talking');
                gator.activity  = 'talking'; gator.talkingTo = partner.id; gator.ticksLeft = dur;
                partner.activity = 'talking'; partner.talkingTo = gator.id; partner.ticksLeft = dur;

                state.activeConversation = true;
                const firstMeeting = !(gator.met ??= new Set()).has(partner.id);
                if (firstMeeting) {
                    // Mark both as met
                    gator.met.add(partner.id);
                    (partner.met ??= new Set()).add(gator.id);

                    // Seed relation from topic compatibility
                    const compat = topicCompatibility(gator.topicOpinions ?? {}, partner.topicOpinions ?? {});
                    const seed = Math.round(compat * 0.2);
                    gator.relations[partner.id]  = Math.max(-100, Math.min(100, seed));
                    partner.relations[gator.id]  = Math.max(-100, Math.min(100, seed));
                    gator.perceivedRelations[partner.id]  = gator.liar && seed < -20 ? Math.min(100, -seed * 0.4 + rnd(20)) : seed;
                    partner.perceivedRelations[gator.id]  = partner.liar && seed < -20 ? Math.min(100, -seed * 0.4 + rnd(20)) : seed;

                    const introCtx = `First meeting. ${gator.name} has opinions: ${Object.entries(gator.topicOpinions ?? {}).map(([t,v])=>`${t}:${v>0?'+':''}${v}`).join(', ')}.`;
                    const openingLine = `Hi, I'm ${gator.name}!`;
                    gator.message = openingLine;
                    requestFullConversation(gator, partner, openingLine, 6, introCtx, false, _onConversationCompleted);

                    gator.history.push({ day: state.dayNumber, type: 'first_meeting', with: partner.id, detail: `Met ${partner.name} for the first time (compat: ${compat})` });
                    partner.history.push({ day: state.dayNumber, type: 'first_meeting', with: gator.id, detail: `Met ${gator.name} for the first time (compat: ${compat})` });
                    recordMemory(gator.id, state.dayNumber, 'first_meeting', `Met ${partner.name} for the first time`, partner.id);
                    recordMemory(partner.id, state.dayNumber, 'first_meeting', `Met ${gator.name} for the first time`, gator.id);
                } else {
                    const openingLine = `Hey ${partner.name}!`;
                    gator.message = openingLine;
                    requestFullConversation(gator, partner, openingLine, 6, null, false, _onConversationCompleted);
                    recordMemory(gator.id, state.dayNumber, 'conversation_start', `Started talking with ${partner.name}`, partner.id);
                    recordMemory(partner.id, state.dayNumber, 'conversation_start', `${gator.name} started talking to me`, gator.id);
                }
                free.delete(gator.id);
                free.delete(partner.id);
                continue;
            }
            } // end if (!state.activeConversation)
            const anyFree = [...free].filter(id => id !== gator.id).map(id => state.gators.find(p => p.id === id)).filter(Boolean);
            if (anyFree.length > 0) {
                const target = anyFree
                    .filter(q => (gator.relations[q.id] ?? 0) > -40)
                    .reduce((a, b) =>
                        (gator.relations[a.id] ?? 0) >= (gator.relations[b.id] ?? 0) ? a : b,
                        anyFree[0]
                    );
                gator.targetX = target.x;
                gator.targetY = target.y;
            }
            next = 'moving';
        }

        if (next === 'hosting' && !state.activeConversation && !state.noNewConversations) {
        const TALK_COOLDOWN_MS = 60_000;
        const now = Date.now();
        const guest = [...free]
            .filter(id => id !== gator.id)
            .filter(id => (now - ((gator.recentTalkWith ?? {})[id] ?? 0)) >= TALK_COOLDOWN_MS)
            .map(id => state.gators.find(p => p.id === id))
            .filter(p => p && p.activity !== 'talking' && p.talkingTo == null) // Don't invite gators already committed
            .filter(Boolean)[0];

        if (guest) {
            const h = state.houses[gator.homeIndex];
            gator.activity   = 'hosting';
            gator.indoors    = true;
            gator.ticksLeft  = rndTicks('hosting');
            gator.talkingTo  = guest.id;
            gator.x          = h.doorX - GATOR_SIZE / 2;
            gator.y          = h.doorY - GATOR_SIZE;
            gator.targetX    = h.doorX;
            gator.targetY    = h.doorY;
            guest.activity      = 'visiting';
            guest.guestOfIndex  = gator.homeIndex;
            guest.ticksLeft     = gator.ticksLeft;
            guest.talkingTo     = gator.id;
            guest.targetX       = h.doorX;
            guest.targetY       = h.doorY;
            free.delete(gator.id);
            free.delete(guest.id);

            // Build topic-discussion context for the AI
            const hostOpinions  = gator.topicOpinions ?? {};
            const guestOpinions = guest.topicOpinions ?? {};
            const topicCtx = [
                `Private visit at ${gator.name}'s home.`,
                `Topics to discuss (weave naturally into conversation):`,
                `- Sports: ${gator.name} supports ${hostOpinions.sports_team ?? '?'}, ${guest.name} supports ${guestOpinions.sports_team ?? '?'}.`,
                `  Rockets and Jets are the local teams; Chowda fans are out-of-towners looked down on by locals.`,
                `- Local gossip: share opinions/rumours about neighbours.`,
                `- Swamp leadership: ${gator.name} ${(hostOpinions.swamp_leadership ?? 0) >= 0 ? 'approves' : 'disapproves'} of leadership; ${guest.name} ${(guestOpinions.swamp_leadership ?? 0) >= 0 ? 'approves' : 'disapproves'}.`,
                `- Favorite swamp activities: discuss what each loves to do.`,
                `Keep it casual and in-character.`,
            ].join(' ');

            // On completion: apply topic-based relation delta, then release gators
            // NOTE: No recordMemory here — private conversations are off the record.
            const _host = gator;
            const _guest = guest;
            const onHostingComplete = () => {
                const { delta, reasons } = applyTopicRelationDelta(_host, _guest);
                console.log(`[Hosting] ${_host.name} & ${_guest.name} topic delta: ${delta > 0 ? '+' : ''}${delta}`, reasons);
                _host.history.push({ day: state.dayNumber, type: 'hosted', with: _guest.id, detail: `Hosted ${_guest.name}; topic bond: ${delta > 0 ? '+' : ''}${delta}` });
                _guest.history.push({ day: state.dayNumber, type: 'visited', with: _host.id, detail: `Visited ${_host.name}; topic bond: ${delta > 0 ? '+' : ''}${delta}` });
                _onConversationCompleted();
            };

            state.activeConversation = true;
            // Start a private conversation between host and guest
            const openingLine = `Come on in, ${guest.name}!`;
            gator.message = openingLine;
            requestFullConversation(gator, guest, openingLine, 6, topicCtx, true, onHostingComplete);
            // Private conversations are not recorded as memories — gators won't reference them later.

                updateHouseGuests();
                continue;
            }
            next = 'moving';
        }

        gator.activity  = next;
        gator.ticksLeft = rndTicks(next);
        gator.message   = null;
        if (next === 'moving') {
            const { W, H } = stageBounds();
            const cx = W / 2, cy = H / 2;
            const TOWN_RADIUS = 200; // sim-px
            const WALL_MARGIN = 20;
            let tx, ty, tries = 0;
            do {
                // Pick a random angle and radius within the town circle
                const ang = Math.random() * Math.PI * 2;
                const r   = Math.random() * TOWN_RADIUS;
                tx = cx + Math.cos(ang) * r;
                ty = cy + Math.sin(ang) * r;
                // Clamp to wall-safe area as a secondary guard
                tx = Math.max(WALL_MARGIN, Math.min(W - WALL_MARGIN, tx));
                ty = Math.max(WALL_MARGIN, Math.min(H - WALL_MARGIN, ty));
                tries++;
            } while (_isInsideObstacle(tx + GATOR_SIZE/2, ty + GATOR_SIZE/2) && tries < 15);
            gator.targetX = tx;
            gator.targetY = ty;
            gator.indoors = false;
            }

        if (next === 'resting') free.delete(gator.id);
        else free.add(gator.id);
    }

    activePeople.forEach(renderGator);
    cleanPrivateChatBubbles();
    updateStats();
}

// -- Animation loop --------------------------------------------
/**
 * The requestAnimationFrame (rAF) loop — runs at ~60fps independent of tick().
 *
 * SEPARATION OF CONCERNS:
 *   tick()      = LOGICAL state (activity, relations, conversation starts)  — every 250ms
 *   gameLoop()  = VISUAL state  (pixel positions, DOM style updates)        — every ~16ms
 *
 * This separation is what makes the simulation feel smooth even though the
 * logic only updates 4 times per second. Gators glide between positions
 * rather than jumping in discrete steps.
 *
 * HOW MOVEMENT WORKS:
 *   Each frame, gameLoop() reads `p.x, p.y, p.targetX, p.targetY, p.speed`
 *   and moves the gator a tiny step toward their target. When they arrive,
 *   a new random target is picked.
 *
 * ACTIVITY-SPECIFIC MOVEMENT:
 *   - 'resting':  Snap to house position, mark indoors.
 *   - 'hosting':  Walk to door; once inside, drift gently within the enclosure bubble.
 *   - 'visiting': Walk to host's door; once inside, drift within host bubble.
 *   - 'debating': Walk toward debate target position (in front of house).
 *   - 'talking':  Close in toward partner during conversation.
 *                 (set by agentQueue while AI is in-flight or turns are playing back).
 *   - default:    Normal wandering toward targetX/targetY; picks new random target on arrival.
 *
 * EXECUTE PHASE SPECIAL CASE:
 *   Only the condemned gator moves. All others are frozen in place while
 *   they watch the condemned walk to the centre for execution.
 *
 * DOM UPDATES:
 *   After calculating each gator's new position:
 *     el.style.left / el.style.top  — moves the gator DOM element
 *     bubbleEl.style.left / .top    — keeps the speech bubble tracking the gator
 *     el.classList.toggle('indoors'/'indoors-private') — controls CSS visibility
 */
let _rafFrameCount = 0;

// -- Obstacle avoidance -----------------------------------------------------
// Obstacles in state.obstacles are stored directly in sim-px: { x, y, r, type }
// This avoids any coordinate-system mismatch between Babylon world units and
// the 2-D simulation pixel space.

/**
 * Nudge gator p out of any circular obstacle and clamp to the stage wall.
 * All values are in sim-px. Called every rAF frame for moving gators.
 */
// Minimum pixel gap between a gator's sprite edge and the stage wall (3 feet × 20 px/ft).
const WALL_CLEAR = 60;

function _pushOutOfObstacles(p) {
    const GATOR_R = GATOR_SIZE / 2;
    // Wall: keep sprite edge at least WALL_CLEAR (3 ft) from each wall.
    // p.x is the top-left corner, so right-edge = p.x + GATOR_SIZE.
    const { W, H } = stageBounds();
    p.x = Math.max(WALL_CLEAR, Math.min(W - GATOR_SIZE - WALL_CLEAR, p.x));
    p.y = Math.max(WALL_CLEAR, Math.min(H - GATOR_SIZE - WALL_CLEAR, p.y));

    const pcx = p.x + GATOR_R;
    const pcy = p.y + GATOR_R;

    for (const obs of state.obstacles) {
        const ddx = pcx - obs.x;
        const ddy = pcy - obs.y;
        const dd  = Math.sqrt(ddx * ddx + ddy * ddy);
        const minD = obs.r + GATOR_R;
        if (dd < minD && dd > 0.001) {
            const push = (minD - dd) / dd;
            p.x += ddx * push;
            p.y += ddy * push;
        }
    }
}

/**
 * Returns true if a gator centred at (cx, cy) would overlap any obstacle.
 */
function _isInsideObstacle(cx, cy) {
    const GATOR_R = GATOR_SIZE / 2;
    for (const obs of state.obstacles) {
        const ddx = cx - obs.x, ddy = cy - obs.y;
        if (Math.sqrt(ddx * ddx + ddy * ddy) < obs.r + GATOR_R) return true;
    }
    return false;
}

function gameLoop() {
    if (!state.paused) {
        _rafFrameCount++;
        if (_rafFrameCount % 60 === 0) refreshPinnedTooltip();
        const { W, H } = stageBounds();
        const cx = GATOR_SIZE / 2;

        for (const p of state.gators) {
            if (state.deadIds.has(p.id)) continue;
            if (state.gamePhase === PHASE.NIGHT) continue;
            // POV-controlled gator: skip ALL autonomous movement — player drives it
            if (p.id === state.povGatorId) continue;

            // During execute phase: only move the condemned
            if (state.gamePhase === PHASE.EXECUTE) {
                if (p.id !== state.condemnedId) continue;
                const worldEl = document.getElementById('world');
                const destX = (worldEl.clientWidth  / 2) - GATOR_SIZE / 2;
                const destY = (worldEl.clientHeight / 2) - GATOR_SIZE / 2;
                const dx = destX - p.x, dy = destY - p.y;
                const d  = Math.sqrt(dx*dx + dy*dy);
                if (d > 4) {
                    p.x = Math.max(WALL_CLEAR, Math.min(W - GATOR_SIZE - WALL_CLEAR, p.x + (dx/d) * p.speed * 1.5));
                    p.y = Math.max(WALL_CLEAR, Math.min(H - GATOR_SIZE - WALL_CLEAR, p.y + (dy/d) * p.speed * 1.5));
                }
                const el = document.getElementById(`gator-${p.id}`);
                if (el) { el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; }
                const bubbleEl = state.bubbles.get(p.id);
                if (bubbleEl) {
                    bubbleEl.style.left = `${p.x + GATOR_SIZE / 2 - 20}px`;
                    bubbleEl.style.top  = `${p.y - 38}px`;
                }
                continue;
            }
            if (p.activity === 'resting') {
                if (!p.indoors) {
                        const h = state.houses[p.homeIndex];
                        p.x = h.doorX - GATOR_SIZE / 2;
                        p.y = h.doorY - GATOR_SIZE;
                        p.indoors = true;
                    }
            } else if (p.activity === 'hosting') {
                if (!p.indoors) {
                    const h   = state.houses[p.homeIndex];
                    const ddx = h.doorX - (p.x + cx);
                    const ddy = h.doorY - (p.y + cx);
                    const dd  = Math.sqrt(ddx*ddx + ddy*ddy);
                    if (dd > 5) {
                        p.x = Math.max(WALL_CLEAR, Math.min(W - GATOR_SIZE - WALL_CLEAR, p.x + (ddx/dd) * p.speed));
                        p.y = Math.max(WALL_CLEAR, Math.min(H - GATOR_SIZE - WALL_CLEAR, p.y + (ddy/dd) * p.speed));
                    } else {
                        p.x = h.doorX - GATOR_SIZE / 2;
                        p.y = h.doorY - GATOR_SIZE;
                        p.indoors = true;
                    }
                } else {
                    // Face-to-face: host stands on one side of house centre, guest on the other
                    const h = state.houses[p.homeIndex];
                    const faceGap = GATOR_SIZE * 0.65; // offset from pad centre
                    const hostTargetX = h.x - faceGap - GATOR_SIZE / 2;
                    const hostTargetY = h.y - GATOR_SIZE / 2;
                    const ddx = hostTargetX - p.x, ddy = hostTargetY - p.y;
                    const dd  = Math.sqrt(ddx*ddx + ddy*ddy);
                    if (dd > 2) {
                        p.x = Math.max(WALL_CLEAR, Math.min(W - GATOR_SIZE - WALL_CLEAR, p.x + (ddx/dd)*Math.min(p.speed*0.6, dd)));
                        p.y = Math.max(WALL_CLEAR, Math.min(H - GATOR_SIZE - WALL_CLEAR, p.y + (ddy/dd)*Math.min(p.speed*0.6, dd)));
                    }
                    p.targetX = p.x; p.targetY = p.y;
                }
            } else if (p.activity === 'visiting') {
                if (!p.indoors) {
                    const h   = state.houses[p.guestOfIndex];
                    const ddx = h.doorX - (p.x + cx);
                    const ddy = h.doorY - (p.y + cx);
                    const dd  = Math.sqrt(ddx*ddx + ddy*ddy);
                    if (dd > 8) {
                        p.x = Math.max(WALL_CLEAR, Math.min(W - GATOR_SIZE - WALL_CLEAR, p.x + (ddx/dd) * p.speed));
                        p.y = Math.max(WALL_CLEAR, Math.min(H - GATOR_SIZE - WALL_CLEAR, p.y + (ddy/dd) * p.speed));
                    } else {
                        p.x = h.x - GATOR_SIZE / 2;
                        p.y = h.y - GATOR_SIZE / 2;
                        p.indoors = true;
                    }
                } else {
                    // Face-to-face: guest stands opposite the host
                    const h = state.houses[p.guestOfIndex];
                    const faceGap = GATOR_SIZE * 0.65; // offset from pad centre
                    const guestTargetX = h.x + faceGap - GATOR_SIZE / 2;
                    const guestTargetY = h.y - GATOR_SIZE / 2;
                    const ddx = guestTargetX - p.x, ddy = guestTargetY - p.y;
                    const dd  = Math.sqrt(ddx*ddx + ddy*ddy);
                    if (dd > 2) {
                        p.x = Math.max(WALL_CLEAR, Math.min(W - GATOR_SIZE - WALL_CLEAR, p.x + (ddx/dd)*Math.min(p.speed*0.6, dd)));
                        p.y = Math.max(WALL_CLEAR, Math.min(H - GATOR_SIZE - WALL_CLEAR, p.y + (ddy/dd)*Math.min(p.speed*0.6, dd)));
                    }
                    p.targetX = p.x; p.targetY = p.y;
                }
            } else if (p.activity === 'debating') {
                const dx = p.targetX - p.x, dy = p.targetY - p.y;
                const d  = Math.sqrt(dx*dx + dy*dy);
                if (d > 4) {
                    p.x = Math.max(WALL_CLEAR, Math.min(W - GATOR_SIZE - WALL_CLEAR, p.x + (dx/d) * p.speed));
                    p.y = Math.max(WALL_CLEAR, Math.min(H - GATOR_SIZE - WALL_CLEAR, p.y + (dy/d) * p.speed));
                }
            } else if (p.activity === 'talking') {
                const partner = state.gators.find(q => q.id === p.talkingTo);
                if (partner && p.id < partner.id) {
                    // Only the lower-id gator computes the facing positions (once per frame)
                    // to avoid both gators fighting over the midpoint calculation.
                    const mx = (p.x + partner.x) / 2;
                    const my = (p.y + partner.y) / 2;
                    // 5 feet (100px) gap between sprite edges ? each stands 110px from midpoint.
                    const faceGap = (GATOR_SIZE + 100) / 2;
                    // Determine facing axis: if mostly horizontal, stand side-by-side
                    const rawDx = partner.x - p.x;
                    const rawDy = partner.y - p.y;
                    const rawD  = Math.sqrt(rawDx*rawDx + rawDy*rawDy) || 1;
                    // Snap each gator toward their face-to-face slot
                    const pDx = p.x - mx, pDy = p.y - my;
                    const pD  = Math.sqrt(pDx*pDx + pDy*pDy) || 1;
                    const pTargetX = mx + (pDx/pD) * faceGap;
                    const pTargetY = my + (pDy/pD) * faceGap;
                    const bDx = partner.x - mx, bDy = partner.y - my;
                    const bD  = Math.sqrt(bDx*bDx + bDy*bDy) || 1;
                    const bTargetX = mx + (bDx/bD) * faceGap;
                    const bTargetY = my + (bDy/bD) * faceGap;
                    // Move toward face-to-face slot at reduced speed, then stop
                    const SNAP_SPEED = p.speed * 0.8;
                    const pdx = pTargetX - p.x, pdy2 = pTargetY - p.y;
                    const pd  = Math.sqrt(pdx*pdx + pdy2*pdy2);
                    if (pd > 2) {
                        p.x = Math.max(WALL_CLEAR, Math.min(W - GATOR_SIZE - WALL_CLEAR, p.x + (pdx/pd)*Math.min(SNAP_SPEED, pd)));
                        p.y = Math.max(WALL_CLEAR, Math.min(H - GATOR_SIZE - WALL_CLEAR, p.y + (pdy2/pd)*Math.min(SNAP_SPEED, pd)));
                    }
                    const bdx = bTargetX - partner.x, bdy2 = bTargetY - partner.y;
                    const bd  = Math.sqrt(bdx*bdx + bdy2*bdy2);
                    if (bd > 2) {
                        partner.x = Math.max(WALL_CLEAR, Math.min(W - GATOR_SIZE - WALL_CLEAR, partner.x + (bdx/bd)*Math.min(SNAP_SPEED, bd)));
                        partner.y = Math.max(WALL_CLEAR, Math.min(H - GATOR_SIZE - WALL_CLEAR, partner.y + (bdy2/bd)*Math.min(SNAP_SPEED, bd)));
                    }
                    // Lock targets so nothing else moves them
                    p.targetX = p.x; p.targetY = p.y;
                    partner.targetX = partner.x; partner.targetY = partner.y;
                }
            } else {
                // -- Commanded attack: move toward target and bite when close --
                if (p._pendingAttackTargetId != null) {
                    const target = state.gators.find(g => g.id === p._pendingAttackTargetId);
                    if (!target || state.deadIds.has(target.id)) {
                        // Target gone — cancel the command
                        p._pendingAttackTargetId = null;
                    } else {
                        const tdx = target.x - p.x, tdy = target.y - p.y;
                        const td  = Math.sqrt(tdx * tdx + tdy * tdy);
                        const ATTACK_RANGE = GATOR_SIZE * 1.1; // close enough to bite
                        if (td <= ATTACK_RANGE) {
                            // In range — fire the bite and clear the command
                            p._pendingAttackTargetId = null;
                            applyBiteEffect(p.id, target.id);
                        } else {
                            // Keep chasing — override the wander target every frame
                            p.targetX = target.x;
                            p.targetY = target.y;
                            p.x = Math.max(WALL_CLEAR, Math.min(W - GATOR_SIZE - WALL_CLEAR, p.x + (tdx / td) * p.speed * 1.4));
                            p.y = Math.max(WALL_CLEAR, Math.min(H - GATOR_SIZE - WALL_CLEAR, p.y + (tdy / td) * p.speed * 1.4));
                            _pushOutOfObstacles(p);
                            // Skip normal wander logic this frame
                            const el = document.getElementById(`gator-${p.id}`);
                            if (el) { el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; }
                            continue;
                        }
                    }
                }
                // Default movement behavior
                const dx = p.targetX - p.x, dy = p.targetY - p.y;
                const d  = Math.sqrt(dx*dx+dy*dy);
                if (d <= p.speed) {
                    p.x = p.targetX; p.y = p.targetY;
                    // Pick a target that respects the wall clearance and avoids obstacles.
                    const { W: bW, H: bH } = stageBounds();
                    let tx, ty, tries = 0;
                    do {
                        tx = WALL_CLEAR + Math.random() * (bW - GATOR_SIZE - WALL_CLEAR * 2);
                        ty = WALL_CLEAR + Math.random() * (bH - GATOR_SIZE - WALL_CLEAR * 2);
                        tries++;
                    } while (_isInsideObstacle(tx + GATOR_SIZE/2, ty + GATOR_SIZE/2) && tries < 15);
                    p.targetX = tx; p.targetY = ty;
                } else {
                    const nx = p.x + (dx/d)*p.speed;
                    const ny = p.y + (dy/d)*p.speed;
                    const { W: bW2, H: bH2 } = stageBounds();
                    const minX2 = WALL_CLEAR, maxX2 = bW2 - GATOR_SIZE - WALL_CLEAR;
                    const minY2 = WALL_CLEAR, maxY2 = bH2 - GATOR_SIZE - WALL_CLEAR;
                    p.x = Math.max(minX2, Math.min(maxX2, nx));
                    p.y = Math.max(minY2, Math.min(maxY2, ny));
                    // If we were clamped, bounce: pick a new target on the interior side
                    if (nx < minX2 || nx > maxX2 || ny < minY2 || ny > maxY2) {
                        let tx2, ty2, tries2 = 0;
                        const bW3 = bW2, bH3 = bH2;
                        do {
                            tx2 = WALL_CLEAR + Math.random() * (bW3 - GATOR_SIZE - WALL_CLEAR * 2);
                            ty2 = WALL_CLEAR + Math.random() * (bH3 - GATOR_SIZE - WALL_CLEAR * 2);
                            tries2++;
                        } while (_isInsideObstacle(tx2 + GATOR_SIZE/2, ty2 + GATOR_SIZE/2) && tries2 < 15);
                        p.targetX = tx2; p.targetY = ty2;
                    }
                }
                _pushOutOfObstacles(p);
            }

            const el = document.getElementById(`gator-${p.id}`);
            if (el) {
                el.style.left = `${p.x}px`;
                el.style.top  = `${p.y}px`;
                const isPrivate = p.indoors && (p.activity === 'hosting' || p.activity === 'visiting');
                el.classList.toggle('indoors',         p.indoors && !isPrivate);
                el.classList.toggle('indoors-private', isPrivate);
            }

            }

            syncTalkLines();
    }

    state.rafId = requestAnimationFrame(gameLoop);
}

// -- Spawn / lifecycle -----------------------------------------
/**
 * Starts both the tick interval and the rAF loop, and sets the Pause button text.
 * Called by initSimulation() at startup and by spawnGators() after a respawn.
 */
function startAll() {
    state.paused = false;
    document.getElementById('pauseBtn').textContent = '\u23F8 Pause';
    if (!state.tickInterval) state.tickInterval = setInterval(tick, TICK_MS);
    stopRaf(); startRaf();
}

/**
 * Stops the tick interval and the rAF loop. Called at game-over and
 * at the start of spawnGators() to clear state before a fresh run.
 */
function stopAll() {
    if (state.tickInterval) { clearInterval(state.tickInterval); state.tickInterval = null; }
    stopRaf();
}

/** Starts the requestAnimationFrame loop. Saves the handle in state.rafId for cancellation. */
function startRaf() { state.rafId = requestAnimationFrame(gameLoop); }
/** Cancels any in-flight rAF handle and nulls state.rafId. */
function stopRaf()  { if (state.rafId !== null) { cancelAnimationFrame(state.rafId); state.rafId = null; } }

/**
 * Destroys and recreates the entire simulation from scratch.
 *
 * WHAT spawnGators() DOES (in order):
 *   1. Stops tick loop + rAF loop.
 *   2. Clears DOM: removes gator elements, bubbles, thought bubbles, house labels,
 *      talk lines, and old SVG background.
 *   3. Calls culdesacLayout() to compute fresh house positions.
 *   4. Calls buildCuldesacSVG() and inserts the new background SVG.
 *   5. Creates house-label and guest-badge span elements for each house.
 *   6. Calls createGator(i, house) for each slot ? pushes to state.gators[].
 *   7. Creates the DOM div for each gator (with SVG figure, name label, personality badge).
 *   8. Calls resetGameState() to clear day counter, dead set, conversation counters, etc.
 *   9. Calls initRelations() to seed all relations/suspicion to 0.
 *   10. Picks the MURDERER:
 *       - Prefers extrovert or grumpy (thematically fitting).
 *       - Sets murderer.liar = true.
 *       - Adjusts murderer's perceivedRelations to appear friendly toward everyone
 *         (the murderer masks their true negative feelings).
 *   11. POSTs all gator data to /api/agent/initialize to create SK agents on the server.
 *   12. Calls startAll() to begin the tick loop and rAF loop.
 *
 * CALLED BY:
 *   - initSimulation() via requestAnimationFrame (first run).
 *   - The Respawn button click handler.
 *   - The "Restart" button on the game-over overlay.
 */
function spawnGators() {
    stopAll();
    state.gators = []; state.nextId = 0;

    // Close the gator panel if open
    const panel = document.getElementById('gator-panel');
    if (panel) { panel.style.display = 'none'; panel.classList.remove('panel-open'); }

    const world = document.getElementById('world');
    world.querySelectorAll('.gator').forEach(e => e.remove());
    world.querySelectorAll('.chat-bubble').forEach(e => e.remove());
    world.querySelectorAll('.thought-bubble').forEach(e => e.remove());
    world.querySelectorAll('.house-label').forEach(e => e.remove());
    world.querySelectorAll('.house-guests').forEach(e => e.remove());
    state.talkLines.forEach(l => l.remove()); state.talkLines.clear();
    state.bubbles.forEach(b => b.remove()); state.bubbles.clear();
    state.thoughts.forEach(t => t.remove()); state.thoughts.clear();
    cleanPrivateChatBubbles();

    // Rebuild cul-de-sac SVG
    const existing = document.getElementById('culdesac');
    if (existing) existing.remove();
    const layout = culdesacLayout();
    state.houses = layout.housePositions;
    world.insertAdjacentHTML('afterbegin', buildCuldesacSVG(layout));

    // House labels and guest badges
    for (let i = 0; i < GATOR_COUNT; i++) {
        const h = state.houses[i];
        const lbl = document.createElement('span');
        lbl.className = 'house-label';
        lbl.id        = `house-label-${i}`;
        lbl.style.left = `${h.x}px`;
        lbl.style.top  = `${h.y - 52}px`;
        world.appendChild(lbl);

        const badge = document.createElement('span');
        badge.className = 'house-guests';
        badge.id        = `house-guests-${i}`;
        badge.style.left = `${h.x - 20}px`;
        badge.style.top  = `${h.y - 36}px`;
        world.appendChild(badge);
    }

    for (let i = 0; i < GATOR_COUNT; i++) {
        const p  = createGator(i, state.houses[i]);
        state.gators.push(p);

        const lbl = document.getElementById(`house-label-${i}`);
        if (lbl) lbl.textContent = `${p.name}'s`;

        const el = document.createElement('div');
        el.id = `gator-${p.id}`;
        el.className = `gator activity-${p.activity}`;
        el.style.cssText = `left:${p.x}px;top:${p.y}px`;

        const nameEl = document.createElement('span');
        nameEl.className = 'name-above';
        nameEl.textContent = p.name;

        const badge = document.createElement('span');
        badge.className = 'personality-badge';
        badge.textContent = PERSONALITY_EMOJI[p.personality];

        el.insertAdjacentHTML('beforeend', buildFigureSVG(p));
        el.appendChild(badge);

        el.insertBefore(nameEl, el.firstChild);

        el.addEventListener('click',      e => pinTooltip(e, p));

        world.appendChild(el);
    }

    // Reset game state
    resetGameState();

    // -- Pre-populate obstacles in sim-px so 2-D collision works immediately --
    // These positions mirror the rock & tree positions used by gatorBabylon.js.
    // BABYLON_SCALE = 0.1; sim-px = world-unit / 0.1 = world-unit * 10
    const _B2S = 10; // Babylon world-unit ? sim-px
    state.obstacles = [];

    // Rocks (world-unit coords from buildRocks, using fixed median size ˜ 1.1)
    const _rockDefs = [
        [8,12],[15,70],[110,8],[108,70],[3,40],
        [118,42],[35,5],[82,75],[55,38],[72,18],
        [25,62],[95,30],[42,72],[68,8],
    ];
    _rockDefs.forEach(([wx, wz]) => {
        state.obstacles.push({ x: wx * _B2S, y: wz * _B2S, r: 20, type: 'rock' });
    });

    // Island-perimeter trees – use the same fixed list as gatorBabylon.js
    ISLAND_TREE_POSITIONS.forEach(([wx, wz]) => {
        state.obstacles.push({ x: wx * _B2S, y: wz * _B2S, r: 18, type: 'tree' });
    });

    // Houses (from state.houses which was just populated by culdesacLayout)
    state.houses.forEach(h => {
        // house half-diagonal ˜ 85px (HOUSE_W=12, HOUSE_D=12 world units ? 120×120 sim-px)
        state.obstacles.push({ x: h.x, y: h.y, r: 90, type: 'house' });
    });

    // Sync Babylon.js 3D meshes with the new gator + house roster
    try { syncBabylonMeshes(); } catch (e) { console.warn('[babylon] syncBabylonMeshes failed', e); }

    // Clear dead body markers from previous game
    document.querySelectorAll('.dead-marker').forEach(e => e.remove());

    // Hide overlays
    const goOverlay = document.getElementById('game-over-overlay');
    if (goOverlay) goOverlay.style.display = 'none';
    const tallyPanel = document.getElementById('vote-tally');
    if (tallyPanel) tallyPanel.style.display = 'none';

    const nightOv = document.getElementById('night-overlay');
    if (nightOv) nightOv.classList.remove('active');
    document.getElementById('world').classList.remove('night');

    initRelations();

    // Pick murderer
    const pool      = state.gators.slice().sort(() => Math.random() - 0.5);
    const preferred = pool.find(p => p.personality === 'extrovert' || p.personality === 'grumpy');
    const murderer  = preferred || pool[0];
    state.murdererId      = murderer.id;
    murderer.liar   = true;
    for (const q of state.gators) {
        if (q.id === murderer.id) continue;
        murderer.perceivedRelations[q.id] = Math.abs(murderer.relations[q.id] ?? 0) * 0.5 + 20;
    }

    updateStats();
    updatePhaseLabel();

    // Initialize SK agents on the server with the spawned alligator data
    const alligatorData = state.gators.map(p => {
        const { sports_team, ...numericOpinions } = p.topicOpinions ?? {};
        return {
            id: p.id,
            name: p.name,
            personality: p.personality,
            isMurderer: p.id === state.murdererId,
            isLiar: p.liar,
            topicOpinions: numericOpinions,
            sportsTeam: sports_team ?? ''
        };
    });
    fetch('/api/agent/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alligatorData)
    })
        .then(() => console.log('SK agents initialized'))
        .catch(err => console.warn('SK agent init failed (continuing without AI):', err));

    startAll();
}

// -- Module entry point ----------------------------------------
/**
 * Module initialisation — called once from main.js after the page loads.
 *
 * WHAT initSimulation() DOES:
 *   1. Calls initTooltip() to set up the mouse-follow tooltip panel.
 *   2. Calls setTickFunction(tick) to give agentQueue a reference to the tick
 *      function without creating a circular import
 *      (agentQueue imports simulation.js, simulation.js imports agentQueue.js;
 *       passing the function reference at runtime breaks the cycle).
 *   3. Wires up DOM button click handlers:
 *        #respawnBtn     ? spawnGators()
 *        #goRestartBtn   ? spawnGators()  (game-over overlay "Play Again" button)
 *        #pauseBtn       ? toggle state.paused / restart interval / update label
 *        #testConvBtn    ? testConversation() (debug shortcut)
 *   4. Wires up a window resize handler that regenerates the cul-de-sac layout
 *      and clamps gator positions to the new stage bounds.
 *   5. Defers the first spawnGators() call to the NEXT two animation frames
 *      (requestAnimationFrame ? requestAnimationFrame) so the DOM has fully
 *      rendered and el.clientWidth/clientHeight return accurate values before
 *      the layout math runs.
 *
 * @param {object} agentInterop - Reserved for future Blazor/.NET interop (currently unused).
 */
export function initSimulation(agentInterop, dialogSource) {
    initTooltip();

    // Provide tick function reference to agentQueue to avoid circular import
    setTickFunction(tick);

    document.getElementById('respawnBtn').addEventListener('click', spawnGators);
    document.getElementById('goRestartBtn').addEventListener('click', spawnGators);

    document.getElementById('pauseBtn').addEventListener('click', () => {
        if (state.paused) {
            state.paused = false;
            document.getElementById('pauseBtn').textContent = '\u23F8 Pause';
            if (!state.tickInterval) state.tickInterval = setInterval(tick, TICK_MS);
        } else {
            state.paused = true;
            document.getElementById('pauseBtn').textContent = '\u25B6 Resume';
            if (state.tickInterval) { clearInterval(state.tickInterval); state.tickInterval = null; }
        }
    });

    document.getElementById('testConvBtn')?.addEventListener('click', testConversation);

    document.getElementById('makeAttackBtn')?.addEventListener('click', () => hudMakeAttack());
    document.getElementById('influenceBtn')?.addEventListener('click', () => hudInfluence());

    // Relationship-delta toggle (2D screen)
    document.getElementById('relDeltaToggleBtn')?.addEventListener('click', () => {
        state.showRelDelta = !state.showRelDelta;
        const btn = document.getElementById('relDeltaToggleBtn');
        if (btn) btn.textContent = `\ud83d\udcac Rel. Changes: ${state.showRelDelta ? 'ON' : 'OFF'}`;
    });

    window.addEventListener('resize', () => {
        const existing = document.getElementById('culdesac');
        if (existing) {
            const layout = culdesacLayout();
            state.houses = layout.housePositions;
            existing.outerHTML = buildCuldesacSVG(layout);
        }
        const { W, H } = stageBounds();
        for (const p of state.gators) {
            p.x = Math.min(p.x, W); p.y = Math.min(p.y, H);
            if (p.targetX > W) p.targetX = rndF(W);
            if (p.targetY > H) p.targetY = rndF(H);
        }
    });

    requestAnimationFrame(() => requestAnimationFrame(spawnGators));
}


