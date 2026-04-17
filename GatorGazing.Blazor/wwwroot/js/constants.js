// ── Constants ─────────────────────────────────────────────────
export const PERSON_SIZE   = 60;
export const PEOPLE_COUNT  = 10;
export const TICK_MS       = 2200;
export const TALK_DIST     = 200;
export const TALK_STOP     = 80;
export const HOUSE_ENTER_D = 48;

// ── Fish market ───────────────────────────────────────────────
export const APPLE_PRICE           = 1;
export const ORANGE_PRICE          = 10;
export const ORANGE_LOVER_DEBT_MAX = 20;  // max debt a swordfish-obsessed gator will take on
export const OBSERVE_SHOP_RADIUS   = 240; // how far others can see you buying fish

export const ORANGE_LOVER_CHANCE = {
    cheerful:0.12, grumpy:0.22, lazy:0.35,
    energetic:0.15, introvert:0.45, extrovert:0.10
};

// Social need
export const SOCIAL_DECAY  = 12;
export const SOCIAL_GAIN   = 22;
export const SOCIAL_MAX    = 100;
export const SOCIAL_URGENT = 60;

export const PERSONALITIES = ['cheerful','grumpy','lazy','energetic','introvert','extrovert'];

// How frequently each personality thinks (1 = rarely, 10 = constantly)
export const THOUGHT_STAT_BASE = {
    cheerful:4, grumpy:7, lazy:3,
    energetic:5, introvert:9, extrovert:3
};

// How driven each personality is to talk (1 = almost never, 10 = non-stop)
export const SOCIAL_STAT_BASE = {
    cheerful:7, grumpy:3, lazy:4,
    energetic:6, introvert:2, extrovert:10
};

export const PERSONALITY_EMOJI = {
    cheerful:'\u{1F60A}', grumpy:'\u{1F620}', lazy:'\u{1F634}',
    energetic:'\u26A1', introvert:'\u{1F92B}', extrovert:'\u{1F389}'
};

export const ACTIVITY_EMOJI = {
    eating:'\u{1F356}', sleeping:'\u{1F4A4}',
    moving:'\u{1F40A}', talking:'\u{1F4AC}',
    hosting:'\u{1FAB7}', visiting:'\u{1F40A}',
    debating:'\uD83D\uDDE3\uFE0F', shopping:'\u{1F3A3}'
};

export const ACTIVITY_WEIGHTS = {
    cheerful:  { eating:10, sleeping: 5, moving:20, talking:55, hosting:10, shopping: 8 },
    grumpy:    { eating:18, sleeping:15, moving:27, talking:32, hosting: 8, shopping: 6 },
    lazy:      { eating:14, sleeping:32, moving: 6, talking:40, hosting: 8, shopping: 5 },
    energetic: { eating: 8, sleeping: 3, moving:35, talking:44, hosting:10, shopping:12 },
    introvert: { eating:20, sleeping:18, moving:22, talking:28, hosting:12, shopping:15 },
    extrovert: { eating: 8, sleeping: 5, moving:12, talking:55, hosting:20, shopping:10 }
};

export const SOCIAL_START = {
    cheerful:70, grumpy:50, lazy:60,
    energetic:65, introvert:85, extrovert:55
};

export const ACTIVITY_TICKS = {
    eating:[3,7], sleeping:[5,14], moving:[1,4],
    talking:[1,4], hosting:[8,20], visiting:[8,20], shopping:[2,5]
};

export const MOOD_MATRIX = {
    cheerful:  { eating:+1, sleeping: 0, moving:+1, talking:+2, hosting:+2, visiting:+1, shopping:+1 },
    grumpy:    { eating: 0, sleeping:+1, moving:-1, talking:-1, hosting:-1, visiting:-1, shopping:-1 },
    lazy:      { eating:+1, sleeping:+2, moving:-1, talking: 0, hosting: 0, visiting: 0, shopping:-1 },
    energetic: { eating: 0, sleeping:-2, moving:+2, talking:+1, hosting:+1, visiting:+1, shopping:+1 },
    introvert: { eating:+1, sleeping:+1, moving: 0, talking:-1, hosting: 0, visiting:-2, shopping:+2 },
    extrovert: { eating: 0, sleeping:-1, moving: 0, talking:+2, hosting:+3, visiting:+2, shopping:+1 }
};

export const MOOD_EMOJI = s => s>=2?'\u{1F604}':s>=1?'\u{1F60A}':s>=0?'\u{1F610}':s>=-1?'\u{1F61F}':'\u{1F624}';

export const WALK_SPEED = {
    cheerful:0.35, grumpy:0.275, lazy:0.165,
    energetic:0.60, introvert:0.25, extrovert:0.425
};

// Day / night cycle  (TICK_MS=2200 → 1 min≈27 ticks, 30 s≈14 ticks, 5 s≈2 ticks)
export const DAY_TICKS          = 27;   // ~1 min real time
export const NIGHT_TICKS        = 2;    // ~5 s — pure black screen
export const DAWN_TICKS         = 6;    // ~13 s — body reveal + reaction
export const DEBATE_TICKS       = 14;   // ~30 s standing at own houses
export const HOME_WARN_TICKS    = 5;    // ticks left in day when talks end & all go home
export const VOTE_DISPLAY_TICKS = 1;    // ticks shown per sequential voter (~2 s)

// Max simultaneous speakers during debate (staggered speech)
export const MAX_DEBATE_SPEAKERS = 2;
// Ticks a person stays silent between debate utterances
export const DEBATE_SPEAK_COOLDOWN = [2, 4];

// Game phases
export const PHASE = Object.freeze({
    DAY:'day', NIGHT:'night', DAWN:'dawn',
    DEBATE:'debate', VOTE:'vote', EXECUTE:'execute', OVER:'over'
});

// ── Personality-bucketed phrase system ─────────────────────────
// Each personality has a distinct speech style:
//   cheerful  → upbeat, warm, polite, indirect
//   grumpy    → blunt, short, harsh, cynical
//   lazy      → low-effort, abbreviated, slurred
//   energetic → loud, excited, direct, urgent
//   introvert → quiet, measured, understated, careful
//   extrovert → dramatic, emotional, performative

// Murderer bluff lines (said during day conversations)
export const MURDERER_BLUFF = {
    cheerful:  ["Anyone else feeling a little nervous? Just me?","We should really stick together, right?","I'd never hurt a soul! Honest!","I just want everyone to be safe \u263A","Has anyone noticed anything weird?"],
    grumpy:    ["Something stinks around here.","I don't trust any of you.","Keep your eyes open. That's all I'm saying.","Don't look at me like that.","One of you did this. Not me."],
    lazy:      ["I dunno... something feels off...","I was sleeping the whole time, so...","Can we just... figure this out later?","I didn't see anything. Too tired.","Wasn't me. I was napping."],
    energetic: ["WE NEED TO FIND THIS KILLER!","Stay alert, people! STAY ALERT!","I'm watching everything! Trust me!","Nobody's getting past ME!","Let's GO! We can solve this!"],
    introvert: ["I... noticed something odd.","I don't want to point fingers, but...","Just be careful out there.","I've been thinking about what happened...","Someone here isn't who they seem."],
    extrovert: ["Oh my god you guys, I'm SO scared!","Trust me, I'm on EVERYONE'S side!","Has ANYONE seen ANYTHING?!","We need to talk about this, like, NOW!","I would NEVER! You all know me!"]
};

// Debate-phase accusation lines
export const ACCUSE_LINES = {
    cheerful:  ["I hate to say it, but... I think it's {name}.","Sorry {name}, but something doesn't add up.","I really don't want to believe it, but {name}...","Gosh, I think {name} might be the one.","It breaks my heart, but I'm pointing at {name}."],
    grumpy:    ["It's {name}. Obviously.","Open your eyes. {name} did it.","I KNEW {name} was trouble.","Don't waste my time—it's {name}.","Who else could it be? {name}!"],
    lazy:      ["{name}... probably.","I mean... {name}, right?","Eh, my money's on {name}.","I guess {name}? I dunno.","Yeah... {name}. Can I sit down now?"],
    energetic: ["{name}!! IT'S {name}!!","LOOK AT {name}! It's SO obvious!","I'm 100% SURE it's {name}!","EVERYONE VOTE {name}! RIGHT NOW!","There's NO DOUBT—it's {name}!"],
    introvert: ["I've been watching {name} closely...","Quietly, I think {name} is the one.","I don't say this lightly... {name}.","The evidence points to {name}.","I've noticed {name} acting differently."],
    extrovert: ["OH MY GOD it's TOTALLY {name}!","I've been saying it all along—{name}!","Can we PLEASE talk about {name}?!","Everyone listen! {name} is the killer!","{name}, {name}, {name}! It's SO obvious!"]
};

// Debate-phase defense lines
export const DEFEND_LINES = {
    cheerful:  ["I promise, it wasn't me!","Please believe me, I'm innocent!","I would never hurt anyone!","You guys know me, right? Right?!","I swear on my life!"],
    grumpy:    ["It wasn't me. Period.","You have zero proof.","Back off.","This is ridiculous.","Accuse me again and see what happens."],
    lazy:      ["Wasn't me... too much effort.","I was sleeping, dude.","Nah.","Can't be me, I don't do anything.","Ugh, leave me alone."],
    energetic: ["NO WAY! NOT ME!","I was doing pushups ALL NIGHT!","You've got the WRONG person!","CHECK MY ALIBI!","I'm INNOCENT and I'll PROVE it!"],
    introvert: ["...it wasn't me.","I was home. Alone. Reading.","Please, just... think about this rationally.","I don't have the energy to hurt anyone.","That's not who I am."],
    extrovert: ["ARE YOU KIDDING ME?! ME?!","I would NEVER! Everyone loves me!","This is SO unfair!","Ask ANYONE! I'm innocent!","How DARE you! I'm the friendliest person here!"]
};

// Mourn lines
export const MOURN_LINES = {
    cheerful:  ["Oh no... this is awful...","I can't believe they're gone...","We have to find who did this!","My heart is broken.","Who would do such a thing?"],
    grumpy:    ["Tch. Another one gone.","This is bad.","Whoever did this will pay.","I told you all something was wrong.","Great. Just great."],
    lazy:      ["Whoa... that's... bad.","Oh man...","I don't feel so good about this.","This is really heavy...","Can we just... be safe?"],
    energetic: ["NO! This can't be happening!","We HAVE to act NOW!","This is TERRIBLE!","I'm SO angry right now!","Justice! We need JUSTICE!"],
    introvert: ["...oh no.","I feel sick.","This is terrible.","I need a moment.","Who could have done this?"],
    extrovert: ["OH MY GOD NO!","I can't believe this! I CAN'T!","This is the WORST thing ever!","We need to stick together, gators!","I'm devastated! DEVASTATED!"]
};

// Debate backing arguments (may be truth or lies)
export const DEBATE_ARGUMENT_LINES = {
    cheerful:  ["I saw {name} wandering around at night!","Didn't {name} say something really weird yesterday?","{name} was avoiding everyone, and that's not normal.","I noticed {name} near the victim's house!","Call me crazy, but {name} looked nervous."],
    grumpy:    ["{name} was skulking around in the dark.","Nobody acts that suspicious without a reason.","{name}'s been lying to all of us.","I saw {name} with my own eyes near the scene.","Wake up—{name} has motive and opportunity."],
    lazy:      ["{name} was up when everyone else was asleep... just saying.","I half-saw {name} doing something sketchy.","Even I noticed {name} acting weird, and I notice nothing.","{name} was the only one outside... I think.","I was dozing but I'm pretty sure I saw {name}."],
    energetic: ["I literally SAW {name} sneaking around!","{name} was the FIRST one awake—suspicious!","Check the FACTS—{name} has no alibi!","I've been tracking {name}'s movements!","{name} was RUNNING near the house!"],
    introvert: ["I kept notes... {name} was unaccounted for.","Quietly, I observed {name} leaving their house.","{name} contradicted themselves earlier.","I've been watching. {name} doesn't add up.","The pattern points to {name}. I've thought about it carefully."],
    extrovert: ["EVERYONE heard {name} say that weird thing!","Remember when {name} was acting all cagey?!","{name} told ME something suspicious!","I have WITNESSES! Ask around about {name}!","The WHOLE town saw {name} near the house!"]
};

// Lines when talking to someone you distrust/dislike
export const GUARDED_LINES = {
    cheerful:  ["Haha, yeah... anyway!","Oh, that's nice! *forced smile*","Suuure, I believe you!","Ha! Good one! ...right?","Everything's fine! Totally fine!"],
    grumpy:    ["Mmhm.","Whatever you say.","I'm watching you.","Don't try anything.","Yeah, sure."],
    lazy:      ["Uh huh...","Cool. Cool cool cool.","Yeah... okay.","Mhm. Sure.","I guess."],
    energetic: ["HA! Interesting!","Oh REALLY? Tell me MORE.","Hmm! NOTED!","Very interesting! VERY!","I'll remember that!"],
    introvert: ["...okay.","I see.","Noted.","Mmhm.","...interesting."],
    extrovert: ["Oh that's SO fascinating! *eye roll*","Wooow, really?!","Ha! Sure, sure!","Oh I TOTALLY believe you!","That's... great!"]
};

// Lines when lying to incriminate someone to a person you distrust
export const LIE_INCRIMINATE_LINES = {
    cheerful:  ["Hey, just between us... I think {target} stole from {victim}.","I hate gossip, but {target} was acting really suspicious around {victim}.","Don't tell anyone, but I saw {target} near {victim}'s house at night!"],
    grumpy:    ["{target} is a thief. I saw it.","Don't trust {target}. They robbed {victim}.","I'm telling you, {target} is dangerous."],
    lazy:      ["I think {target} took stuff from {victim}... maybe.","Pretty sure {target} did something to {victim}. Or whatever.","Yeah, {target} is shady. Ask {victim}."],
    energetic: ["LISTEN! {target} stole from {victim}!","I SAW {target} breaking into {victim}'s place!","You need to know—{target} is NOT who they say they are!"],
    introvert: ["I noticed {target} near {victim}'s house... at night.","I shouldn't say this, but... {target} took from {victim}.","Quietly... I think {target} is the problem."],
    extrovert: ["Oh my GOD, you won't BELIEVE what {target} did to {victim}!","I have to tell SOMEONE—{target} is a THIEF!","Everyone needs to know about {target} and {victim}!"]
};

export const SHOP_LINES = {
    cheerful:  ["Ooh, catfish! Yum! \u{1F41F}","Fish market is the best!","Just grabbing a few catfish!","These look delicious!","Catfish time! \u{1F41F}"],
    grumpy:    ["Fine. I need catfish.","Catfish. Just catfish.","This better be worth it.","Groceries. Ugh.","Whatever, give me catfish."],
    lazy:      ["Catfish... I guess.","Need food... too lazy to hunt.","Ugh, shopping.","Just grabbing something quick.","Catfish. Easy enough."],
    energetic: ["CATFISH! Let's GO!","Fish market run! \u{1F3A3}","Fueling up! Need those catfish!","Quick stop! Catfish power!","Restocking at top speed!"],
    introvert: ["Just some catfish, please.","Quick errand.","I'll be quick.","Catfish. Thank you.","In and out."],
    extrovert: ["Fish market trip!! Who's coming?!","Catfish for EVERYONE!","Oh they have the BEST catch!","Let me get catfish! And gossip!","Market run! \u{1F3A3}"]
};

export const ORANGE_BUY_LINES = {
    cheerful:  ["Swordfish!! So fresh! \u{1F41F}","I just love swordfish so much!","This swordfish makes me so happy!","Best swordfish in the swamp!","Premium catch today!"],
    grumpy:    ["Give me the swordfish. NOW.","SWORDFISH. Don't judge me.","I need these. Back off.","More swordfish. Don't ask.","This swordfish is MINE."],
    lazy:      ["Swordfish... can't resist...","Worth getting up for... barely.","Mmm... swordfish...","Gotta have 'em. \u{1F41F}","Swordfish is life."],
    energetic: ["SWORDFISH!! YES!! \u{1F41F}\u{1F41F}\u{1F41F}","I LIVE for swordfish!","MAXIMUM SWORDFISH!","Swordfish POWER!","GIVE ME ALL THE SWORDFISH!"],
    introvert: ["I'll take some swordfish, quietly.","Swordfish, please. My secret pleasure.","Just... a few swordfish.","Don't tell anyone how much swordfish I bought.","Swordfish. They understand me."],
    extrovert: ["OH MY GOD SWORDFISH!!","Everyone TRY this swordfish!","SWORDFISH IS THE BEST THING EVER!","I'm buying swordfish for the WHOLE SWAMP!","Has anyone TRIED this?! \u{1F41F}"]
};

export const THEFT_WITNESS_LINES = {
    cheerful:  ["Oh no... I think I saw something bad happen...","Wait, was that a break-in?! Oh dear!","I don't want to alarm anyone, but..."],
    grumpy:    ["I saw a theft. I KNEW something was wrong.","Someone's a thief. I saw it.","Caught red-handed. I saw everything."],
    lazy:      ["I think... someone stole something? Maybe?","Was half-asleep but pretty sure I saw a theft.","Huh... that looked like stealing."],
    energetic: ["I SAW A THEFT! EVERYONE LISTEN!","Someone was STEALING! I saw it!","THIEF! There was a THIEF!"],
    introvert: ["...I witnessed something disturbing.","I saw something I shouldn't have.","Someone was breaking in. I saw it."],
    extrovert: ["Oh my GOD you guys, there was a THIEF!","I SAW EVERYTHING! Someone was robbing!","You won't BELIEVE what I just witnessed!"]
};

export const VICTIM_REACT_LINES = {
    cheerful:  ["Oh no, my money! Who would do this?!","I've been robbed! This is so upsetting!","Someone took my money... I trusted everyone!"],
    grumpy:    ["MY MONEY IS GONE! WHO DID THIS?!","I'll find whoever stole from me!","Someone's going to PAY for this!"],
    lazy:      ["Wait... my money's gone? Seriously?","Ugh, someone robbed me. Great.","Too tired to be this angry..."],
    energetic: ["SOMEONE STOLE FROM ME! WHO?!","I WILL FIND THE THIEF!","MY MONEY! WHERE IS MY MONEY?!"],
    introvert: ["...my money is gone.","Someone took from me. I feel violated.","I was robbed. Quietly processing this."],
    extrovert: ["EVERYONE! I'VE BEEN ROBBED!","Can you BELIEVE someone stole from ME?!","The AUDACITY! Who took my money?!"]
};

export const OPINION_SHARE_LINES_POS = {
    cheerful:  ["I really like {name}, don\u2019t you?","{name} is such a sweetheart!","You should totally hang out with {name}!","I trust {name} completely!","{name} always makes me smile!"],
    grumpy:    ["{name} is... alright, I guess.","{name}'s not terrible.","Hmph. {name}'s okay.","I tolerate {name}. That's saying something.","{name} doesn't annoy me. Much."],
    lazy:      ["{name}'s chill.","I like {name}. They don't make me do stuff.","{name} is pretty cool.","{name} lets me nap. Good person.","Yeah, {name}'s fine."],
    energetic: ["{name} is AWESOME!","I LOVE {name}! So great!","{name} has incredible energy!","Everyone should be more like {name}!","{name} is the BEST!"],
    introvert: ["I... appreciate {name}.","{name} is one of the good ones.","{name} respects my space. I like that.","I trust {name}, quietly.","{name} understands me."],
    extrovert: ["{name} is literally my FAVORITE person!","Oh my god, {name} is SO amazing!","Have you MET {name}?! They're incredible!","I could talk about {name} all day!","{name} is the life of this town!"]
};

export const OPINION_SHARE_LINES_NEG = {
    cheerful:  ["I don't want to be mean, but... {name} worries me.","Between us, {name} makes me uneasy.","I try to see the best in everyone, but {name}...","Something about {name} just... isn't right.","I feel bad saying it, but I don't trust {name}."],
    grumpy:    ["I can't stand {name}.","Stay away from {name}. Trust me.","{name} is bad news.","{name} gets on my last nerve.","Don't get me started on {name}."],
    lazy:      ["{name} is... ugh. Too much.","{name} is annoying. There, I said it.","Not a fan of {name}. Whatever.","Eh, {name}'s sketch.","{name}? Pass."],
    energetic: ["Something is OFF about {name}!","I don't trust {name} AT ALL!","{name} gives me BAD vibes!","Watch out for {name}!","I've been keeping my eye on {name}!"],
    introvert: ["I\u2019ve been observing {name}... not good.","Quietly, I don't trust {name}.","{name} makes me uncomfortable.","I\u2019d be careful around {name}.","There's something hidden about {name}."],
    extrovert: ["OH MY GOD, do NOT get me started on {name}!","Between us? {name} is THE WORST.","{name} is SO sketchy!","I've been telling EVERYONE about {name}!","Honestly? {name} gives me the CREEPS!"]
};

export const DAWN_THOUGHTS_INNOCENT = {
    cheerful:  ["What happened last night?","Oh no... someone was killed...","I'm so scared. Who did this?","I just want everyone to be safe."],
    grumpy:    ["Another murder. Of course.","Who's responsible for this?","I knew something bad would happen.","This ends today."],
    lazy:      ["Woke up to bad news... great.","Did someone really die?","This is too heavy for morning.","I don't feel safe anymore."],
    energetic: ["What?! Who was killed?!","We need to ACT! NOW!","I barely slept thinking about this!","This is UNACCEPTABLE!"],
    introvert: ["...another death.","I've been lying awake thinking.","Someone here is a monster.","I need to be more careful."],
    extrovert: ["Oh my god, is everyone okay?!","Who else couldn't sleep?!","We need to talk about this!","This is SO scary!"]
};

export const DAWN_THOUGHTS_MURDERER = {
    cheerful:  ["Act normal. Stay sunny.","Nobody suspects the happy one.","Just keep smiling...","One less to worry about!"],
    grumpy:    ["Perfect. One less to worry about.","Heh. Too easy.","They'll never figure it out.","Pathetic. All of them."],
    lazy:      ["That was easy enough.","Back to pretending...","They won't catch me. Too lazy to look suspicious.","Smooth."],
    energetic: ["YES! Another one down!","Stay focused! Act shocked!","Nobody suspects me!","Just a few more nights!"],
    introvert: ["Nobody noticed. Good.","Quiet and methodical. That's me.","They'll never suspect the quiet one.","Stay calm. Stay invisible."],
    extrovert: ["Time to put on a SHOW!","Act devastated! Be dramatic!","Everyone will be watching—perform!","They love me too much to suspect me."]
};

// Personality memory strength (0=forgets easily, 1=perfect recall)
export const MEMORY_STRENGTH = {
    energetic:0.9, introvert:0.9, grumpy:0.8,
    cheerful:0.7, extrovert:0.6, lazy:0.2
};
// Suspicion threshold above which a person actively tries to persuade others
export const CONVICTION_THRESHOLD = 55;

// Persuasion lines used during debate
export const PERSUADE_LINES = {
    cheerful:  ["Please, just think about it—{name} doesn't add up.","I really think we should vote {name}. Sorry!","I know it's hard, but {name} is our best lead."],
    grumpy:    ["It's {name}. End of discussion.","Vote {name} or you're a fool.","How is this even a debate? {name}!"],
    lazy:      ["Just... vote {name}. Easiest choice.","{name}. Can we go home now?","Look, it's gotta be {name}. Just vote."],
    energetic: ["EVERYONE VOTE {name}! LET'S GO!","The evidence is CLEAR—{name}!","We can DO this! Vote {name}!"],
    introvert: ["I've thought about it carefully. It's {name}.","The logic points to {name}. Please consider it.","I wouldn't say this if I wasn't sure. {name}."],
    extrovert: ["You GUYS! It's SO obviously {name}!","Can we all AGREE it's {name}?!","I've been telling EVERYONE—vote {name}!"]
};

export const NAMES = ['Chomps','Bubba','Gnarla','Dredge','Murka','Fang','Gully','Hiss','Ivy','Jaw'];

export const HOUSE_COLORS = [
    { wall:'#3a7d44', roof:'#2d5a27', door:'#4a9050', trim:'#5ab860' },
    { wall:'#4a8b5a', roof:'#1e5631', door:'#3a7248', trim:'#6cb870' },
    { wall:'#5a9e60', roof:'#2d6b3a', door:'#488d55', trim:'#7cc880' },
    { wall:'#3e8050', roof:'#1a4d2e', door:'#357542', trim:'#5eb868' },
    { wall:'#4d9058', roof:'#265e35', door:'#3d7d4a', trim:'#6dc078' },
    { wall:'#2d7040', roof:'#1a4a28', door:'#3a6b44', trim:'#4ea860' },
    { wall:'#448a52', roof:'#1e5833', door:'#3a7848', trim:'#64b870' },
    { wall:'#3a8048', roof:'#204e2d', door:'#347040', trim:'#56b060' },
    { wall:'#4e9460', roof:'#2a6238', door:'#408550', trim:'#70c480' },
    { wall:'#388048', roof:'#1c5030', door:'#306a3c', trim:'#50a858' }
];

export const DIALOGUE = {
    cheerful:  ["Nice swamp today! \u2600\uFE0F","Your scales look amazing!","This is so fun!","Did you hear the news?",
                "Let's float more!","I love it here! \u{1F604}","How's your day?","Want a crawdad? \u{1F99E}",
                "That's so exciting!","You're the best!"],
    grumpy:    ["Ugh, not you again.","Can we wrap this up?","Whatever.","I'd rather be alone.",
                "This is pointless.","Are we done yet?","I hate small talk.","Fine. Whatever.",
                "You're blocking my sunning spot.","This swamp is too loud."],
    lazy:      ["I'm so tired... \u{1F634}","Can we just float?","I just woke up.","Can we do this later?",
                "I need a nap.","Swimming is exhausting.","Zzzz... oh, hi.","Too much effort.",
                "Can't we just grunt?","My tail hurts."],
    energetic: ["LET'S GO!! \u26A1","Did you swim laps today?","I did 50 tail whips!","So much to do!",
                "What's the plan?!","Race you to the bank!","Up since dawn!","Try diving!",
                "I love being busy!","KEEP MOVING!!"],
    introvert: ["Oh... hi.","This is a bit much.","I prefer basking alone.","I'll be quick.",
                "Quiet is underrated.","I need alone time.","Is this necessary?",
                "I liked the silence.","OK, leaving soon.","..."],
    extrovert: ["Oh my gosh, HI!! \u{1F389}","Tell me everything!","We should throw a swamp party!",
                "I love meeting gators!","You're my favorite!","Let's get everyone together!",
                "Did you hear about--","This is SO exciting!!","Have you met my friend?",
                "I know every gator here!"]
};

export const INVITE_LINES = [
    "Hop on my pad!","Want to come float?","My lilypad is your lilypad!",
    "I'll catch some bugs!","You have to see my new pad!","Float in for a bit?",
    "Just settled in, join me!","I insist, hop on!","Mi lilypad es su lilypad!","Join me on the pad?"
];

// Inner thoughts
export const THOUGHTS = {
    cheerful:  ["I hope this ends soon.","Did I leave my fish out?","I'm faking it a little.",
                "I could really use a bask.","Am I being too much?","Just snap and nod.","I need a mudslide badly."],
    grumpy:    ["OK fine, this is nice.","They're actually alright.","Don't let them see me smile.",
                "I kind of missed this.","This isn't so bad.","I wish I hissed that nicer.","I like them, actually."],
    lazy:      ["If I float still long enough they'll leave.","So... tired...","Is it nap time yet?",
                "Can someone else deal with this?","I regret leaving my pad.","Five more minutes..."],
    energetic: ["Why is everyone so SLOW?","I could swim a lap right now.","FOCUS. FOCUS. FOCUS.",
                "My brain won't stop.","I've already planned tomorrow.","SO MUCH TO DO!!"],
    introvert: ["Please wrap this up.","I've used up all my hisses.","I need a long bask after this.",
                "I should have stayed on my pad.","Can we do this by grunting?","Almost out of social energy."],
    extrovert: ["I wonder if they like me.","Am I talking too much?","I love this so much!",
                "I hope they tell the other gators about me.","This is my element!","I never want this to end."]
};

// ── Relationship system ───────────────────────────────────────
export const LIAR_CHANCE = {
    cheerful:0.10, grumpy:0.05, lazy:0.12,
    energetic:0.08, introvert:0.06, extrovert:0.25
};

export const COMPAT = {
    cheerful:  { cheerful:+8, grumpy:-6, lazy:+2, energetic:+5, introvert: 0, extrovert:+9 },
    grumpy:    { cheerful:-6, grumpy:+4, lazy: 0, energetic:-8, introvert:+3, extrovert:-7 },
    lazy:      { cheerful:+2, grumpy: 0, lazy:+6, energetic:-5, introvert:+4, extrovert: 0 },
    energetic: { cheerful:+5, grumpy:-8, lazy:-5, energetic:+9, introvert:-3, extrovert:+7 },
    introvert: { cheerful: 0, grumpy:+3, lazy:+4, energetic:-3, introvert:+8, extrovert:-5 },
    extrovert: { cheerful:+9, grumpy:-7, lazy: 0, energetic:+7, introvert:-5, extrovert:+8 }
};

export const RELATION_THOUGHTS = {
    love:    ['They\'re literally my favourite person.','I could talk to them forever.','I\'d do anything for them.','Seeing them made my day.'],
    like:    ['They\'re pretty great, actually.','Always good to see them.','I\'m lucky to know them.','They get me.'],
    neutral: ['Can\'t quite figure them out.','We just don\'t click.','Maybe I should give them a chance.','Neither here nor there.'],
    dislike: ['Ugh, them again.','I\'m smiling but I\'m not happy about it.','They grate on me.','I don\'t trust them.'],
    hate:    ['I absolutely can\'t stand them.','Every word they say annoys me.','Why are they even here?','I\'m only pretending to be civil.']
};

// Appearance randomisation
export const SKIN_TONES   = ['#4a6b3a','#3d5e30','#5a7d48','#2e4a22','#6b8b58','#3a5830','#4e7040','#5e8550'];
export const HAT_STYLES   = ['none','none','hornplate','spines','scarscar','crest'];
export const SHIRT_COLORS = ['#8baa70','#7d9b60','#6e8c52','#5a7d44','#9abb80','#a0c488','#7a9960','#6b8a50','#8bb470','#90b878'];
