# 🎮 Swamp of Salem — Game Mechanics Reference

> **Audience:** Anyone who wants to understand the game rules, tune the simulation,
> or understand why the AI characters make the decisions they do.
> **Prerequisite:** Read [ARCHITECTURE.md](ARCHITECTURE.md) for the system context.

---

## Table of Contents

1. [The Full Game Cycle](#1-the-full-game-cycle)
2. [Phase Reference](#2-phase-reference)
3. [The Alligator — Stats Explained](#3-the-alligator--stats-explained)
4. [Relations System](#4-relations-system)
5. [Suspicion System](#5-suspicion-system)
6. [Gossip & Opinion Spreading](#6-gossip--opinion-spreading)
7. [Murder — Victim Selection Algorithm](#7-murder--victim-selection-algorithm)
8. [The Vote — How It Works](#8-the-vote--how-it-works)
9. [Conversation Topics](#9-conversation-topics)
10. [Personality Archetypes](#10-personality-archetypes)
11. [Win Conditions](#11-win-conditions)
12. [Tuning the Game](#12-tuning-the-game)

---

## 1. The Full Game Cycle

```
╔══════════════════════════════════════════════════════════════════════════╗
║                    ONE FULL GAME  — TIMELINE OVERVIEW                   ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  GAME START                                                              ║
║    • 6 gators spawn at their house doors                                ║
║    • Relations = 0 (nobody knows anyone yet)                            ║
║    • Suspicion = 0 (nobody suspects anyone yet)                         ║
║    • 1 murderer secretly assigned (prefers extrovert/grumpy personality)║
║    • ~15% of towngators randomly assigned as liars                      ║
║    • All SK agents initialized with personality prompts + topic opinions║
║                                                                          ║
║  ☀️  DAY 1                                                               ║
║    • Gators wander the cul-de-sac                                       ║
║    • When two gators come within 300px: conversation starts             ║
║    • AI generates 6-turn conversation (one batch API call)              ║
║    • After each conversation: relations drift, gossip may spread        ║
║    • After 7 conversations + 3-minute cooldown: nightfall starts        ║
║    • (Hard cap: 818 ticks × 2.2s ≈ 30 minutes max)                     ║
║                                                                          ║
║  🌙 NIGHT 1                                                              ║
║    • All gators go indoors                                              ║
║    • Murderer selects victim: highest suspicion-of-murderer score       ║
║    • Night report: AI reflects on the day (parallel AI calls)           ║
║    • Player reads reflections, clicks "Continue to Morning"             ║
║                                                                          ║
║  🌅 DAWN 2                                                               ║
║    • Body revealed. Dead gator placed as 💀 marker                      ║
║    • dayNumber++                                                         ║
║    • All living gators react ("Oh no! Rex is dead!")                    ║
║    • Suspicion updated (victims close to murderer become more suspected)║
║                                                                          ║
║  💬 DEBATE 2                                                             ║
║    • All gators gather at their house doors                             ║
║    • Each takes turns accusing their top suspect                        ║
║    • Murderer deflects to innocents others already suspect              ║
║    • Persuasion: high-conviction gators influence liked neighbours      ║
║                                                                          ║
║  🗳️  VOTE 2                                                              ║
║    • Gators vote in clockwise house-index order                         ║
║    • Each votes against their highest-suspicion target                  ║
║    • Votes displayed one at a time                                      ║
║    • Most votes → condemned (ties → no execution)                       ║
║                                                                          ║
║  ⚰️  EXECUTE 2                                                           ║
║    • Condemned gator walks to centre stage                              ║
║    • Eliminated from the game                                           ║
║    • WIN CHECK: murderer dead? → TOWN WINS                              ║
║    • WIN CHECK: ≤1 gator remaining? → MURDERER WINS                    ║
║    • Otherwise: back to ☀️ Day (counters reset)                         ║
║                                                                          ║
║  [Repeat Day/Night/Dawn/Debate/Vote/Execute until someone wins]         ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## 2. Phase Reference

### ☀️ Day Phase

```
Duration:
  Max: DAY_TICKS (818) × TICK_MS (2200ms) ≈ 30 minutes
  Auto-ends when: completedConvCount >= CONV_LIMIT_FOR_NIGHTFALL (7)
				  AND NIGHTFALL_DELAY_MS (3 min) has passed
				  AND no conversation is in progress

Gator Activities During Day:
  'moving'    Walk toward a random target position
  'talking'   Engage in an AI conversation with a nearby gator
  'hosting'   Invite a gator inside for a private conversation
  'visiting'  Accept a hosting invitation
  'resting'   (rare during day — mostly used at night)

Activity Selection (per-gator, per tick):
  weightedPick(socialWeights(gator))
  → Uses ACTIVITY_WEIGHTS[personality] from PersonalityConstants.cs
  → If 'talking' chosen but no eligible partner nearby: falls back to 'moving'
  → If 'hosting' chosen but no free guest: falls back to 'moving'
  → 60-second cooldown before talking to the same gator again

New Conversation Eligibility:
  Partner must be:
	✓ Living
	✓ Not currently talking or hosting
	✓ Within TALK_DIST (300px)
	✓ Not disliked severely (relations >= -60)
	✓ Not talked to within the last 60 seconds
  AND:
	✓ state.activeConversation == false (global mutex)
	✓ state.noNewConversations == false
```

### 🌙 Night Phase

```
Duration: NIGHT_TICKS (2) × TICK_MS = ~4 seconds
  (mostly spent waiting for user to click "Continue to Morning")

What Happens:
  1. All gators: activity = 'resting', indoors = true
  2. Murderer's target selected (see §7 — Victim Selection)
  3. Night report AI calls fire in parallel (one per living gator)
  4. Player views the night report panel
  5. Player clicks "Continue to Morning"
  6. triggerDawn() fires
```

### 🌅 Dawn Phase

```
Duration: DAWN_TICKS (6) × TICK_MS ≈ 13 seconds

What Happens:
  1. Night overlay removed
  2. dayNumber++
  3. nightVictimId added to deadIds
  4. 💀 marker placed at victim's last position
  5. All living gators move outside their doors
  6. Each gator gets a reaction message:
	   Murderer: "How terrible… {victim} is gone."
	   Towngators: "Oh no… {victim} was found dead!"
  7. recordMemory() for all gators: dawn event

Suspicion Update at Dawn:
  When a gator is found dead, nearby gators increase suspicion of
  whoever they already disliked most (guilt-by-association heuristic).
```

### 💬 Debate Phase

```
Duration: DEBATE_TICKS (14) × TICK_MS ≈ 30 seconds

What Happens:
  1. All gators positioned near their house doors
  2. Suspicion seeded from negative relations:
	   suspicion[other] = max(0, -(relations[other] × 0.5) + random(20))
  3. Each gator gets a random initial speak delay (staggered 0–15s)
  4. On each tick: gators with canSpeak=true AND debateSpeakerCount < 2 speak

Accusation Lines:
  If gator has a suspect:   "I suspect {suspect.name}!"
							"Watch out for {suspect.name}…"
							"{suspect.name} is acting suspicious."
  If no clear suspect:      "I didn't do it!"
							"Leave me out of this."

Persuasion Mechanic:
  If gator.conviction > CONVICTION_THRESHOLD (55) AND they accuse suspect:
	Pick one liked neighbour (relations > 10)
	influence = (neighbour.relations[gator] / 100) × 22 + 5   [range: 5–27]
	neighbour.suspicion[suspect] += influence
	neighbour.conviction = max(conviction, new_suspicion)

  Effect: Highly convinced extroverts / grumpy gators can "infect" nearby
		  trusted friends with their suspicion.
```

### 🗳️ Vote Phase

```
Vote Order: homeIndex ascending (0, 1, 2, 3, 4, 5)
  → Clockwise around the cul-de-sac

Each Vote:
  JS logic (not AI): vote for highest suspicion[targetId] score
  If multiple tied at max suspicion: random tiebreak
  Result stored in state.voteResults[targetId]++

Display: VOTE_DISPLAY_TICKS ticks per voter (~2 ticks × 2.2s = ~4s each)

Tally After All Votes:
  Find target with highest vote count
  Ties → NO execution this round (no condemnation)
  Clear winner → state.condemnedId = winner.id
```

### ⚰️ Execute Phase

```
Animation:
  Condemned gator walks toward centre of #world
  When distance to centre < 20px: executeTimer counts down
  After countdown: finaliseExecution()

finaliseExecution():
  condemned.deathType  = 'executed'
  condemned.deathDay   = state.dayNumber
  state.deadIds.add(condemned.id)
  Check win conditions (see §11)
  If game continues: reset for next day
	completedConvCount = 0
	dayEndTimerActive  = false
	noNewConversations = false
	activeConversation = false
	cycleTimer         = DAY_TICKS
	gamePhase          = 'Day'
```

---

## 3. The Alligator — Stats Explained

### thoughtStat (1–10)

Controls how frequently a gator generates a thought bubble.

```
Formula: thoughtDelayMs(thoughtStat)
  = (20000 / thoughtStat) × (0.5 + random × 1.0)

Stat 1  → 10–30 seconds between thoughts  (very unobservant)
Stat 5  → 2–6 seconds between thoughts    (average)
Stat 10 → 1–3 seconds between thoughts    (highly perceptive)

Personality baselines (from THOUGHT_STAT_BASE):
  grumpy:    7   (suspicious, always thinking)
  introvert: 7   (quiet but observant)
  energetic: 4   (too busy to think deeply)
  extrovert: 3   (more mouth than mind)
  cheerful:  4
  lazy:      3   (rarely bothers)
```

### socialStat (1–10)

Controls how often and how confidently a gator initiates conversation.

```
Personality baselines (from SOCIAL_STAT_BASE):
  extrovert: 9   (always chatting)
  cheerful:  7
  energetic: 7
  lazy:      5
  introvert: 4
  grumpy:    4   (grumpy but still engages)
```

### conviction (0–100)

How certain a gator is about their top suspect.

```
Initial seed at debate start:
  conviction = max(all suspicion scores for this gator)

Updated when:
  A liked gator persuades them (debate persuasion mechanic)
  They overhear an accusation matching their own suspicion

Conviction >= CONVICTION_THRESHOLD (55):
  Gator actively names suspect in debate
  Gator's vote is locked to that suspect
```

### socialNeed (0–100)

Drives when a gator seeks conversation.

```
Each tick while NOT talking: socialNeed -= SOCIAL_DECAY (12)
Each tick while talking:     socialNeed += SOCIAL_GAIN  (22)
If socialNeed > SOCIAL_URGENT (60): activity weights shift toward 'talking'
```

---

## 4. Relations System

Relations are the backbone of the entire social simulation.

```
relations[otherId] : integer -100 to +100
  -100  = absolute hatred
   -50  = strong dislike
	 0  = neutral / strangers
   +50  = good friends
  +100  = love / best friends

perceivedRelations[otherId] : integer -100 to +100
  What THIS gator SHOWS others (may differ from true feelings for liars).
  Murderer: perceivedRelations ≈ +abs(true) × 0.5 + 20
			  (appears friendly to all, regardless of true feelings)
  Liar:     occasionally flips relations by -(true × 0.6)
  Normal:   perceivedRelations == relations
```

### Relation Drift After Conversation

Called after every conversation ends:

```
driftRelations(a, b):

  Step 1: Look up compatibility bonus
	compat = COMPAT_MATRIX[a.personality + '_' + b.personality]
	Examples:
	  cheerful_grumpy    → -8   (friction)
	  extrovert_introvert → -4  (mild tension)
	  extrovert_extrovert → +6  (bond over shared energy)
	  cheerful_cheerful   → +5  (positive vibes)
	  lazy_lazy           → +3  (shared contentment)

  Step 2: Add random noise
	change = compat + random(-6, +10)
	(Positive bias: random range is -6 to +10, so even incompatible pairs
	 can drift positive on lucky rolls)

  Step 3: Clamp to [-100, +100]
	a.relations[b.id] = clamp(a.relations[b.id] + change, -100, +100)
	b.relations[a.id] = clamp(b.relations[a.id] + change, -100, +100)

  Step 4: Liars update perceivedRelations
	If a.liar:
	  a.perceivedRelations[b.id] = -(a.relations[b.id] × 0.6) + random(20)
	  (They hide their true dislike)
```

### First Meeting Seeding

When two gators meet for the FIRST time (not in `met` set):

```
compat  = topicCompatibility(a.topicOpinions, b.topicOpinions)
		  → Sums alignment on all shared topics (range: ~-100 to +100)
seed    = round(compat × 0.2)   (max ±20 from topics alone)

a.relations[b.id] = clamp(seed, -100, +100)
b.relations[a.id] = clamp(seed, -100, +100)

Effect: Two Rockets fans meeting each other start at slight positive.
		A Rockets fan meeting a Chowda fan starts at slight negative.
```

---

## 5. Suspicion System

```
suspicion[targetId] : float 0–100
  0   = zero suspicion ("no reason to think they did it")
  50  = moderate suspicion
  100 = absolutely certain they're the murderer

conviction : float 0–100
  The gator's overall confidence level (max of all suspicion scores).
```

### How Suspicion Builds

Suspicion accumulates from multiple sources:

```
SOURCE 1: Gossip (30% chance per conversation)
  Speaker shares opinion of third gator:
	influence = (listener.relations[speaker] / 100) × 18 + 4
	(Range: 4–22; trusted speakers have more influence)

	Negative opinion → listener.suspicion[target] += influence × 0.4
	Positive opinion → (no suspicion change, only relation change)

SOURCE 2: Lying / Framing (path inside _maybeShareOpinion)
  Speaker dislikes both listener AND a target, picks victim:
	influence = (listener.relations[speaker] / 100) × 25 + 8
	listener.suspicion[target] += influence
	listener.relations[target] -= influence × 0.5

SOURCE 3: Overhearing
  Gators within TALK_DIST hear public conversations.
  If the overheard line mentions a gator name →
	subtle suspicion update in the AI's memory context

SOURCE 4: Debate persuasion
  High-conviction gator accuses suspect →
	liked neighbours:  suspicion[suspect] += (liking/100) × 22 + 5

SOURCE 5: Relation-based seeding at Debate start
  suspicion[other] = max(0, -(relations[other] × 0.5) + random(20))
  (Gators who dislike someone start the debate already suspicious of them)

SOURCE 6: Dawn update
  After body discovered: gators adjust suspicion based on memory strength
  and who they already suspected most.
```

### Suspicion Decay

Suspicion does NOT naturally decay over time.
Once a gator suspects another, that suspicion persists unless:
- A highly trusted gator convinces them otherwise (gossip path A)
- The suspect is exonerated by being executed (they're then in deadIds)

---

## 6. Gossip & Opinion Spreading

Called by `_maybeShareOpinion(speaker, listener)` at the end of every conversation.

```
30% chance to trigger per conversation.

IF speaker dislikes listener (relations < -30):

  Path A1 (50%): Guarded response
	Speaker says little. Sets 2.5s speak cooldown.
	No opinion shared.
	History entry: 'guarded'

  Path A2 (50%): Lie to frame an enemy
	Requirements: speaker has enemy (relations < -20) AND victim (relations > 10)
	Speaker picks:
	  target = random enemy to frame
	  victim = random liked gator (implies they were harmed by target)
	AI call: "You are lying to {listener} to frame {target}."
	Effect on listener:
	  trust = max(0, listener.relations[speaker])
	  influence = (trust/100) × 25 + 8   [range: 8–33]
	  listener.suspicion[target]  += influence
	  listener.relations[target]  -= influence × 0.5

IF speaker likes / is neutral to listener:

  Path B: Honest (or dishonest) opinion sharing
	Speaker picks the gator they have the STRONGEST opinion about
	(highest absolute value of relations[otherId]).

	If speaker is a liar AND listener doesn't fully trust them (relations ≤ 20):
	  40% chance to FLIP the opinion:
		opinion = -opinion
		History entry: 'lied_opinion'

	AI call: "You are sharing your [positive/negative] opinion about {target}."

	Effect on listener:
	  trust = max(0, listener.relations[speaker])
	  influence = (trust/100) × 18 + 4   [range: 4–22]
	  nudge = isPositive ? +influence : -influence
	  listener.relations[target] += nudge    (clamped -100..+100)
	  listener.perceivedRelations[target] = listener.relations[target]

	  Mutual distrust reinforcement:
		if listener.relations[target] < -20:
		  listener.suspicion[target] += abs(nudge) × 0.4
```

---

## 7. Murder — Victim Selection Algorithm

Called at `triggerNightfall()` in `phases.js`:

```
murderVictim():
  candidates = living() minus the murderer

  For each candidate:
	score(c) =
		(c.suspicion[murderer.id] × 0.6)       ← how much this gator suspects the killer
	  - (killer.relations[c.id] × 0.3)          ← killer prefers to remove disliked gators
	  + random(0, 20)                            ← small random factor (unpredictability)

  victim = candidate with HIGHEST score

Interpretation:
  • If Marge suspects the killer at 80/100 → she is HIGH priority target
  • If Bobby is the killer's best friend (+80 relations) → he is LOW priority
  • The random factor means even low-suspicion gators have a small chance
	(preventing the killer from being too predictable)

Strategic implication:
  Gators who are vocal about their suspicions during debate are painting
  a target on themselves. The murderer watches who is most onto them
  and eliminates that threat first.
```

---

## 8. The Vote — How It Works

### Vote Order

Gators vote in ascending `homeIndex` order — clockwise around the cul-de-sac:
`house[0] → house[1] → house[2] → ... → house[n-1]`

### How Each Vote Is Decided

```javascript
// phases.js decideVote(gator, candidates)

candidates = living gators minus the voter themselves

voter.vote = candidates.reduce((best, c) => {
	const bScore = (voter.suspicion[best.id] ?? 0) × 0.8
				 - (voter.relations[best.id] ?? 0) × 0.2;
	const cScore = (voter.suspicion[c.id]    ?? 0) × 0.8
				 - (voter.relations[c.id]    ?? 0) × 0.2;
	return cScore > bScore ? c : best;
}, candidates[0]);
```

**Formula explained:**
- `suspicion × 0.8` — Suspicion score is the dominant factor (80%)
- `- relations × 0.2` — Disliked gators get a small extra push (20%)
- Combined: A gator you both suspect AND dislike is very likely to get your vote.

### Tally

```
After all votes are cast:
  voteResults = { [gatorId]: voteCount }

  Most votes → condemned
  Tie (equal highest votes) → no execution this round
```

### Vote Display

Votes are shown one at a time on a timer (`VOTE_DISPLAY_TICKS` ticks per voter)
to create a suspenseful reveal. Each voter's choice is displayed as:
```
💚 Bobby votes against Rex (2 votes)
```

---

## 9. Conversation Topics

Topics are the content of daily conversations and shape long-term relationships.

### The Four Topics

| Topic Key | Label | What It Represents |
|---|---|---|
| `sports_team` | ⚽ Sports Team | Which local team they support |
| `swamp_leadership` | 🏛️ Leadership | Approval of swamp governance (-100 to +100) |
| `local_gossip` | 📰 Gossip | Interest in village gossip (-100 to +100) |
| `favorite_swamp_activity` | 🌿 Activities | Enjoyment of swamp activities (-100 to +100) |

### Sports Teams

```
Local teams:
  Rockets — most gators (town pride)
  Jets    — some gators (local rival)

Out-of-town team:
  Chowda — out-of-towners' team; Rockets and Jets fans look down on Chowda fans

Matching sport teams → +20 relation seed at first meeting
Opposing teams     → -10 to -20 relation seed
```

### Topic Compatibility Score

Used to seed relations at first meeting:

```
topicCompatibility(aOpinions, bOpinions):
  score = 0

  sports_team:
	if same team:          score += 30
	if one is Chowda:      score -= 20
	if different local:    score -= 10

  For each numeric topic (leadership, gossip, activities):
	diff = abs(aOpinions[topic] - bOpinions[topic])
	score += diff < 30  ? +10   (agree)
		   : diff < 70  ?   0   (moderate difference)
		   : diff >= 70 ? -10   (strongly disagree)

  Return clamp(score, -100, +100)
```

### Topic Relation Delta (Hosting Visits)

At the end of a private hosting visit, `applyTopicRelationDelta` is called:

```
For each topic where both gators have opinions:
  diff = abs(host.topicOpinions[topic] - guest.topicOpinions[topic])

  if diff < 25:   delta += 8    (strong agreement → bond)
  if diff < 50:   delta += 3    (mild agreement → slight bond)
  if diff >= 75:  delta -= 5    (significant disagreement → tension)
  if diff >= 90:  delta -= 12   (fundamental disagreement → friction)
  if sameTeam:    delta += 15   (sports alignment is a strong bond)

Final delta applied to both relations:
  host.relations[guest] = clamp(host.relations[guest] + delta, -100, +100)
  guest.relations[host] = clamp(guest.relations[host] + delta, -100, +100)
```

---

## 10. Personality Archetypes

Each personality affects five systems: activity weights, walk speed, stats,
AI prompt tone, and social strategy.

### 😊 Cheerful

```
Activity:    Talking: 65  Moving: 20  Hosting: 5  Visiting: 5  Resting: 5
Walk speed:  1.5 px/frame
ThoughtStat: 4    (positive thinker, not deeply analytical)
SocialStat:  7    (loves talking)
AI tone:     Upbeat, trusting, positive language, avoids negativity
Strategy:    High conversation rate → many relations → good at gathering info
Weakness:    Trusting nature → easily deceived by liars
```

### 😤 Grumpy

```
Activity:    Talking: 40  Moving: 27  Hosting: 10  Visiting: 13  Resting: 10
Walk speed:  1.2 px/frame  (stomps around)
ThoughtStat: 7    (always suspicious)
SocialStat:  4    (reluctant but engaged)
AI tone:     Blunt, irritable, voice complaints freely, hold grudges
Strategy:    High suspicion accumulation → often right about the killer
Weakness:    Easy to vote out because they accuse everyone
```

### 😴 Lazy

```
Activity:    Talking: 50  Moving: 8  Hosting: 10  Visiting: 12  Resting: 20
Walk speed:  0.9 px/frame  (slow drift)
ThoughtStat: 3    (doesn't think much)
SocialStat:  5    (talks when approached)
AI tone:     Vague, short answers, easily distracted
Strategy:    Low suspicion of anyone → hard to get them to vote correctly
Weakness:    Low mobility → rarely finds conversation partners
```

### ⚡ Energetic

```
Activity:    Talking: 50  Moving: 39  Hosting: 5  Visiting: 4  Resting: 2
Walk speed:  2.2 px/frame  (fastest in the swamp)
ThoughtStat: 4    (impulsive, not analytical)
SocialStat:  7    (enthusiastic)
AI tone:     Enthusiastic, impulsive, jumps to conclusions
Strategy:    Covers lots of ground → meets many gators → spreads info fast
Weakness:    Jump-to-conclusions → may accuse wrong gator
```

### 🤫 Introvert

```
Activity:    Talking: 40  Moving: 22  Hosting: 10  Visiting: 10  Resting: 18
Walk speed:  1.1 px/frame
ThoughtStat: 7    (observant, quiet analyst)
SocialStat:  4    (reluctant but deep)
AI tone:     Quiet, thoughtful, guards words, shares only what's necessary
Strategy:    Deep relations with few gators → very accurate on select targets
Weakness:    Small social network → limited gossip reach
```

### 🎉 Extrovert

```
Activity:    Talking: 72  Moving: 15  Hosting: 5  Visiting: 5  Resting: 3
Walk speed:  1.8 px/frame
ThoughtStat: 3    (more mouth than mind)
SocialStat:  9    (always chatting)
AI tone:     Chatty, dominant, gossip magnet, loves drama
Strategy:    Most conversations per day → greatest influence on others
Weakness:    Gossips freely → murderer knows to kill extroverts early
```

---

## 11. Win Conditions

```
Checked by PhaseManager.CheckWinCondition() after every execution:

╔═════════════════════════════════════════════════════════════════╗
║  TOWN WINS  🏆                                                  ║
║                                                                 ║
║  Condition: state.murdererId is in state.deadIds               ║
║  Meaning:   The community correctly identified and executed     ║
║             the murderer.                                       ║
║  Display:   "The town has defeated the murderer!"              ║
╠═════════════════════════════════════════════════════════════════╣
║  MURDERER WINS  🔪                                              ║
║                                                                 ║
║  Condition: living().length <= 1                               ║
║             (only 1 or 0 gators remain, murderer still alive)  ║
║  Meaning:   The murderer eliminated everyone without being      ║
║             caught.                                             ║
║  Display:   "The murderer has taken over the swamp!"           ║
╠═════════════════════════════════════════════════════════════════╣
║  GAME CONTINUES                                                 ║
║                                                                 ║
║  Condition: All other cases.                                    ║
║  Action:    Reset day counters, back to Day phase.             ║
╚═════════════════════════════════════════════════════════════════╝
```

### Typical Game Length

With 6 gators:
- **Fastest town win:** Day 1 (got lucky, suspected correctly immediately)
- **Average:** 2–3 days
- **Murderer win:** Kills 4 innocents before being caught (or never caught)

---

## 12. Tuning the Game

All constants are in `SwampOfSalem.AppLogic/Constants/`. Change them in C# —
they propagate to JS automatically. See [BACKEND.md](BACKEND.md) for details.

### Make the Game Faster (Good for Development)

```csharp
// GameConstants.cs
GatorCount          = 2;      // Fewer gators → faster debug cycle
ConvLimitForNightfall = 2;    // Night after only 2 conversations
NightfallDelayMs    = 5_000;  // 5 seconds instead of 3 minutes
DayTicks            = 50;     // Max day length much shorter
DebateTicks         = 6;      // Quicker debate
TickMs              = 1000;   // Faster tick (makes everything 2.2× faster)
```

### Make Murderer Harder to Catch

```csharp
// GameConstants.cs
ConvictionThreshold = 70;  // Gators need 70% suspicion before voting against someone
						   // (default 55 — making this higher helps the murderer)

// RelationshipConstants.cs
LiarChance = 0.30;         // More liars → more confusion → harder to trust
```

### Make the Murderer Easier to Catch

```csharp
ConvictionThreshold = 40;  // Lower bar for accusation
MemoryStrength = 10;       // All personalities have strong memories
```

### More Social / Chatty Days

```csharp
// PersonalityConstants.cs — adjust ActivityWeights
ActivityWeights["lazy"]["talking"] = 70;   // Even lazy gators talk more
TalkDist = 500;                            // Gators converse from farther away
ConvLimitForNightfall = 12;               // More conversations before nightfall
```

### Longer Debate / More Accusation Drama

```csharp
DebateTicks = 30;               // 30 × 2.2s ≈ 66 seconds
MaxDebateSpeakers = 3;          // Allow 3 simultaneous accusers
ConvictionThreshold = 45;       // Lower bar → more aggressive accusations
```

---

*Back: [ARCHITECTURE.md](ARCHITECTURE.md) — System design overview*
*Back: [FRONTEND.md](FRONTEND.md) — JavaScript module reference*
*Back: [BACKEND.md](BACKEND.md) — .NET project reference*
