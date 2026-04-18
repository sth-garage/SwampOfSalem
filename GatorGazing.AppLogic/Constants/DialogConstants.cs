namespace GatorGazing.AppLogic.Constants;

/// <summary>
/// All personality-bucketed phrase banks for dialog, thoughts, debate, and reactions.
/// </summary>
public static class DialogConstants
{
    public static readonly Dictionary<string, string[]> Dialogue = new()
    {
        ["cheerful"] = ["Nice swamp today! \u2600\uFE0F", "Your scales look amazing!", "This is so fun!", "Did you hear the news?", "Let's float more!", "I love it here! \U0001F604", "How's your day?", "Want a crawdad? \U0001F99E", "That's so exciting!", "You're the best!"],
        ["grumpy"] = ["Ugh, not you again.", "Can we wrap this up?", "Whatever.", "I'd rather be alone.", "This is pointless.", "Are we done yet?", "I hate small talk.", "Fine. Whatever.", "You're blocking my sunning spot.", "This swamp is too loud."],
        ["lazy"] = ["I'm so tired... \U0001F634", "Can we just float?", "I just woke up.", "Can we do this later?", "I need a nap.", "Swimming is exhausting.", "Zzzz... oh, hi.", "Too much effort.", "Can't we just grunt?", "My tail hurts."],
        ["energetic"] = ["LET'S GO!! \u26A1", "Did you swim laps today?", "I did 50 tail whips!", "So much to do!", "What's the plan?!", "Race you to the bank!", "Up since dawn!", "Try diving!", "I love being busy!", "KEEP MOVING!!"],
        ["introvert"] = ["Oh... hi.", "This is a bit much.", "I prefer basking alone.", "I'll be quick.", "Quiet is underrated.", "I need alone time.", "Is this necessary?", "I liked the silence.", "OK, leaving soon.", "..."],
        ["extrovert"] = ["Oh my gosh, HI!! \U0001F389", "Tell me everything!", "We should throw a swamp party!", "I love meeting gators!", "You're my favorite!", "Let's get everyone together!", "Did you hear about--", "This is SO exciting!!", "Have you met my friend?", "I know every gator here!"]
    };

    public static readonly string[] InviteLines =
    [
        "Hop on my pad!", "Want to come float?", "My lilypad is your lilypad!",
        "I'll catch some bugs!", "You have to see my new pad!", "Float in for a bit?",
        "Just settled in, join me!", "I insist, hop on!", "Mi lilypad es su lilypad!", "Join me on the pad?"
    ];

    public static readonly Dictionary<string, string[]> Thoughts = new()
    {
        ["cheerful"] = ["I hope this ends soon.", "Did I leave my fish out?", "I'm faking it a little.", "I could really use a bask.", "Am I being too much?", "Just snap and nod.", "I need a mudslide badly."],
        ["grumpy"] = ["OK fine, this is nice.", "They're actually alright.", "Don't let them see me smile.", "I kind of missed this.", "This isn't so bad.", "I wish I hissed that nicer.", "I like them, actually."],
        ["lazy"] = ["If I float still long enough they'll leave.", "So... tired...", "Is it nap time yet?", "Can someone else deal with this?", "I regret leaving my pad.", "Five more minutes..."],
        ["energetic"] = ["Why is everyone so SLOW?", "I could swim a lap right now.", "FOCUS. FOCUS. FOCUS.", "My brain won't stop.", "I've already planned tomorrow.", "SO MUCH TO DO!!"],
        ["introvert"] = ["Please wrap this up.", "I've used up all my hisses.", "I need a long bask after this.", "I should have stayed on my pad.", "Can we do this by grunting?", "Almost out of social energy."],
        ["extrovert"] = ["I wonder if they like me.", "Am I talking too much?", "I love this so much!", "I hope they tell the other gators about me.", "This is my element!", "I never want this to end."]
    };

    public static readonly Dictionary<string, string[]> MurdererBluff = new()
    {
        ["cheerful"] = ["Anyone else feeling a little nervous? Just me?", "We should really stick together, right?", "I'd never hurt a soul! Honest!", "I just want everyone to be safe \u263A", "Has anyone noticed anything weird?"],
        ["grumpy"] = ["Something stinks around here.", "I don't trust any of you.", "Keep your eyes open. That's all I'm saying.", "Don't look at me like that.", "One of you did this. Not me."],
        ["lazy"] = ["I dunno... something feels off...", "I was sleeping the whole time, so...", "Can we just... figure this out later?", "I didn't see anything. Too tired.", "Wasn't me. I was napping."],
        ["energetic"] = ["WE NEED TO FIND THIS KILLER!", "Stay alert, people! STAY ALERT!", "I'm watching everything! Trust me!", "Nobody's getting past ME!", "Let's GO! We can solve this!"],
        ["introvert"] = ["I... noticed something odd.", "I don't want to point fingers, but...", "Just be careful out there.", "I've been thinking about what happened...", "Someone here isn't who they seem."],
        ["extrovert"] = ["Oh my god you guys, I'm SO scared!", "Trust me, I'm on EVERYONE'S side!", "Has ANYONE seen ANYTHING?!", "We need to talk about this, like, NOW!", "I would NEVER! You all know me!"]
    };

    public static readonly Dictionary<string, string[]> AccuseLines = new()
    {
        ["cheerful"] = ["I hate to say it, but... I think it's {name}.", "Sorry {name}, but something doesn't add up.", "I really don't want to believe it, but {name}...", "Gosh, I think {name} might be the one.", "It breaks my heart, but I'm pointing at {name}."],
        ["grumpy"] = ["It's {name}. Obviously.", "Open your eyes. {name} did it.", "I KNEW {name} was trouble.", "Don't waste my time\u2014it's {name}.", "Who else could it be? {name}!"],
        ["lazy"] = ["{name}... probably.", "I mean... {name}, right?", "Eh, my money's on {name}.", "I guess {name}? I dunno.", "Yeah... {name}. Can I sit down now?"],
        ["energetic"] = ["{name}!! IT'S {name}!!", "LOOK AT {name}! It's SO obvious!", "I'm 100% SURE it's {name}!", "EVERYONE VOTE {name}! RIGHT NOW!", "There's NO DOUBT\u2014it's {name}!"],
        ["introvert"] = ["I've been watching {name} closely...", "Quietly, I think {name} is the one.", "I don't say this lightly... {name}.", "The evidence points to {name}.", "I've noticed {name} acting differently."],
        ["extrovert"] = ["OH MY GOD it's TOTALLY {name}!", "I've been saying it all along\u2014{name}!", "Can we PLEASE talk about {name}?!", "Everyone listen! {name} is the killer!", "{name}, {name}, {name}! It's SO obvious!"]
    };

    public static readonly Dictionary<string, string[]> DefendLines = new()
    {
        ["cheerful"] = ["I promise, it wasn't me!", "Please believe me, I'm innocent!", "I would never hurt anyone!", "You guys know me, right? Right?!", "I swear on my life!"],
        ["grumpy"] = ["It wasn't me. Period.", "You have zero proof.", "Back off.", "This is ridiculous.", "Accuse me again and see what happens."],
        ["lazy"] = ["Wasn't me... too much effort.", "I was sleeping, dude.", "Nah.", "Can't be me, I don't do anything.", "Ugh, leave me alone."],
        ["energetic"] = ["NO WAY! NOT ME!", "I was doing pushups ALL NIGHT!", "You've got the WRONG person!", "CHECK MY ALIBI!", "I'm INNOCENT and I'll PROVE it!"],
        ["introvert"] = ["...it wasn't me.", "I was home. Alone. Reading.", "Please, just... think about this rationally.", "I don't have the energy to hurt anyone.", "That's not who I am."],
        ["extrovert"] = ["ARE YOU KIDDING ME?! ME?!", "I would NEVER! Everyone loves me!", "This is SO unfair!", "Ask ANYONE! I'm innocent!", "How DARE you! I'm the friendliest person here!"]
    };

    public static readonly Dictionary<string, string[]> MournLines = new()
    {
        ["cheerful"] = ["Oh no... this is awful...", "I can't believe they're gone...", "We have to find who did this!", "My heart is broken.", "Who would do such a thing?"],
        ["grumpy"] = ["Tch. Another one gone.", "This is bad.", "Whoever did this will pay.", "I told you all something was wrong.", "Great. Just great."],
        ["lazy"] = ["Whoa... that's... bad.", "Oh man...", "I don't feel so good about this.", "This is really heavy...", "Can we just... be safe?"],
        ["energetic"] = ["NO! This can't be happening!", "We HAVE to act NOW!", "This is TERRIBLE!", "I'm SO angry right now!", "Justice! We need JUSTICE!"],
        ["introvert"] = ["...oh no.", "I feel sick.", "This is terrible.", "I need a moment.", "Who could have done this?"],
        ["extrovert"] = ["OH MY GOD NO!", "I can't believe this! I CAN'T!", "This is the WORST thing ever!", "We need to stick together, gators!", "I'm devastated! DEVASTATED!"]
    };

    public static readonly Dictionary<string, string[]> DebateArgumentLines = new()
    {
        ["cheerful"] = ["I saw {name} wandering around at night!", "Didn't {name} say something really weird yesterday?", "{name} was avoiding everyone, and that's not normal.", "I noticed {name} near the victim's house!", "Call me crazy, but {name} looked nervous."],
        ["grumpy"] = ["{name} was skulking around in the dark.", "Nobody acts that suspicious without a reason.", "{name}'s been lying to all of us.", "I saw {name} with my own eyes near the scene.", "Wake up\u2014{name} has motive and opportunity."],
        ["lazy"] = ["{name} was up when everyone else was asleep... just saying.", "I half-saw {name} doing something sketchy.", "Even I noticed {name} acting weird, and I notice nothing.", "{name} was the only one outside... I think.", "I was dozing but I'm pretty sure I saw {name}."],
        ["energetic"] = ["I literally SAW {name} sneaking around!", "{name} was the FIRST one awake\u2014suspicious!", "Check the FACTS\u2014{name} has no alibi!", "I've been tracking {name}'s movements!", "{name} was RUNNING near the house!"],
        ["introvert"] = ["I kept notes... {name} was unaccounted for.", "Quietly, I observed {name} leaving their house.", "{name} contradicted themselves earlier.", "I've been watching. {name} doesn't add up.", "The pattern points to {name}. I've thought about it carefully."],
        ["extrovert"] = ["EVERYONE heard {name} say that weird thing!", "Remember when {name} was acting all cagey?!", "{name} told ME something suspicious!", "I have WITNESSES! Ask around about {name}!", "The WHOLE town saw {name} near the house!"]
    };

    public static readonly Dictionary<string, string[]> GuardedLines = new()
    {
        ["cheerful"] = ["Haha, yeah... anyway!", "Oh, that's nice! *forced smile*", "Suuure, I believe you!", "Ha! Good one! ...right?", "Everything's fine! Totally fine!"],
        ["grumpy"] = ["Mmhm.", "Whatever you say.", "I'm watching you.", "Don't try anything.", "Yeah, sure."],
        ["lazy"] = ["Uh huh...", "Cool. Cool cool cool.", "Yeah... okay.", "Mhm. Sure.", "I guess."],
        ["energetic"] = ["HA! Interesting!", "Oh REALLY? Tell me MORE.", "Hmm! NOTED!", "Very interesting! VERY!", "I'll remember that!"],
        ["introvert"] = ["...okay.", "I see.", "Noted.", "Mmhm.", "...interesting."],
        ["extrovert"] = ["Oh that's SO fascinating! *eye roll*", "Wooow, really?!", "Ha! Sure, sure!", "Oh I TOTALLY believe you!", "That's... great!"]
    };

    public static readonly Dictionary<string, string[]> LieIncriminateLines = new()
    {
        ["cheerful"] = ["Hey, just between us... I think {target} stole from {victim}.", "I hate gossip, but {target} was acting really suspicious around {victim}.", "Don't tell anyone, but I saw {target} near {victim}'s house at night!"],
        ["grumpy"] = ["{target} is a thief. I saw it.", "Don't trust {target}. They robbed {victim}.", "I'm telling you, {target} is dangerous."],
        ["lazy"] = ["I think {target} took stuff from {victim}... maybe.", "Pretty sure {target} did something to {victim}. Or whatever.", "Yeah, {target} is shady. Ask {victim}."],
        ["energetic"] = ["LISTEN! {target} stole from {victim}!", "I SAW {target} breaking into {victim}'s place!", "You need to know\u2014{target} is NOT who they say they are!"],
        ["introvert"] = ["I noticed {target} near {victim}'s house... at night.", "I shouldn't say this, but... {target} took from {victim}.", "Quietly... I think {target} is the problem."],
        ["extrovert"] = ["Oh my GOD, you won't BELIEVE what {target} did to {victim}!", "I have to tell SOMEONE\u2014{target} is a THIEF!", "Everyone needs to know about {target} and {victim}!"]
    };

    public static readonly Dictionary<string, string[]> ShopLines = new()
    {
        ["cheerful"] = ["Ooh, catfish! Yum! \U0001F41F", "Fish market is the best!", "Just grabbing a few catfish!", "These look delicious!", "Catfish time! \U0001F41F"],
        ["grumpy"] = ["Fine. I need catfish.", "Catfish. Just catfish.", "This better be worth it.", "Groceries. Ugh.", "Whatever, give me catfish."],
        ["lazy"] = ["Catfish... I guess.", "Need food... too lazy to hunt.", "Ugh, shopping.", "Just grabbing something quick.", "Catfish. Easy enough."],
        ["energetic"] = ["CATFISH! Let's GO!", "Fish market run! \U0001F3A3", "Fueling up! Need those catfish!", "Quick stop! Catfish power!", "Restocking at top speed!"],
        ["introvert"] = ["Just some catfish, please.", "Quick errand.", "I'll be quick.", "Catfish. Thank you.", "In and out."],
        ["extrovert"] = ["Fish market trip!! Who's coming?!", "Catfish for EVERYONE!", "Oh they have the BEST catch!", "Let me get catfish! And gossip!", "Market run! \U0001F3A3"]
    };

    public static readonly Dictionary<string, string[]> OrangeBuyLines = new()
    {
        ["cheerful"] = ["Swordfish!! So fresh! \U0001F41F", "I just love swordfish so much!", "This swordfish makes me so happy!", "Best swordfish in the swamp!", "Premium catch today!"],
        ["grumpy"] = ["Give me the swordfish. NOW.", "SWORDFISH. Don't judge me.", "I need these. Back off.", "More swordfish. Don't ask.", "This swordfish is MINE."],
        ["lazy"] = ["Swordfish... can't resist...", "Worth getting up for... barely.", "Mmm... swordfish...", "Gotta have 'em. \U0001F41F", "Swordfish is life."],
        ["energetic"] = ["SWORDFISH!! YES!! \U0001F41F\U0001F41F\U0001F41F", "I LIVE for swordfish!", "MAXIMUM SWORDFISH!", "Swordfish POWER!", "GIVE ME ALL THE SWORDFISH!"],
        ["introvert"] = ["I'll take some swordfish, quietly.", "Swordfish, please. My secret pleasure.", "Just... a few swordfish.", "Don't tell anyone how much swordfish I bought.", "Swordfish. They understand me."],
        ["extrovert"] = ["OH MY GOD SWORDFISH!!", "Everyone TRY this swordfish!", "SWORDFISH IS THE BEST THING EVER!", "I'm buying swordfish for the WHOLE SWAMP!", "Has anyone TRIED this?! \U0001F41F"]
    };

    public static readonly Dictionary<string, string[]> TheftWitnessLines = new()
    {
        ["cheerful"] = ["Oh no... I think I saw something bad happen...", "Wait, was that a break-in?! Oh dear!", "I don't want to alarm anyone, but..."],
        ["grumpy"] = ["I saw a theft. I KNEW something was wrong.", "Someone's a thief. I saw it.", "Caught red-handed. I saw everything."],
        ["lazy"] = ["I think... someone stole something? Maybe?", "Was half-asleep but pretty sure I saw a theft.", "Huh... that looked like stealing."],
        ["energetic"] = ["I SAW A THEFT! EVERYONE LISTEN!", "Someone was STEALING! I saw it!", "THIEF! There was a THIEF!"],
        ["introvert"] = ["...I witnessed something disturbing.", "I saw something I shouldn't have.", "Someone was breaking in. I saw it."],
        ["extrovert"] = ["Oh my GOD you guys, there was a THIEF!", "I SAW EVERYTHING! Someone was robbing!", "You won't BELIEVE what I just witnessed!"]
    };

    public static readonly Dictionary<string, string[]> VictimReactLines = new()
    {
        ["cheerful"] = ["Oh no, my money! Who would do this?!", "I've been robbed! This is so upsetting!", "Someone took my money... I trusted everyone!"],
        ["grumpy"] = ["MY MONEY IS GONE! WHO DID THIS?!", "I'll find whoever stole from me!", "Someone's going to PAY for this!"],
        ["lazy"] = ["Wait... my money's gone? Seriously?", "Ugh, someone robbed me. Great.", "Too tired to be this angry..."],
        ["energetic"] = ["SOMEONE STOLE FROM ME! WHO?!", "I WILL FIND THE THIEF!", "MY MONEY! WHERE IS MY MONEY?!"],
        ["introvert"] = ["...my money is gone.", "Someone took from me. I feel violated.", "I was robbed. Quietly processing this."],
        ["extrovert"] = ["EVERYONE! I'VE BEEN ROBBED!", "Can you BELIEVE someone stole from ME?!", "The AUDACITY! Who took my money?!"]
    };

    public static readonly Dictionary<string, string[]> OpinionShareLinesPos = new()
    {
        ["cheerful"] = ["I really like {name}, don\u2019t you?", "{name} is such a sweetheart!", "You should totally hang out with {name}!", "I trust {name} completely!", "{name} always makes me smile!"],
        ["grumpy"] = ["{name} is... alright, I guess.", "{name}'s not terrible.", "Hmph. {name}'s okay.", "I tolerate {name}. That's saying something.", "{name} doesn't annoy me. Much."],
        ["lazy"] = ["{name}'s chill.", "I like {name}. They don't make me do stuff.", "{name} is pretty cool.", "{name} lets me nap. Good person.", "Yeah, {name}'s fine."],
        ["energetic"] = ["{name} is AWESOME!", "I LOVE {name}! So great!", "{name} has incredible energy!", "Everyone should be more like {name}!", "{name} is the BEST!"],
        ["introvert"] = ["I... appreciate {name}.", "{name} is one of the good ones.", "{name} respects my space. I like that.", "I trust {name}, quietly.", "{name} understands me."],
        ["extrovert"] = ["{name} is literally my FAVORITE person!", "Oh my god, {name} is SO amazing!", "Have you MET {name}?! They're incredible!", "I could talk about {name} all day!", "{name} is the life of this town!"]
    };

    public static readonly Dictionary<string, string[]> OpinionShareLinesNeg = new()
    {
        ["cheerful"] = ["I don't want to be mean, but... {name} worries me.", "Between us, {name} makes me uneasy.", "I try to see the best in everyone, but {name}...", "Something about {name} just... isn't right.", "I feel bad saying it, but I don't trust {name}."],
        ["grumpy"] = ["I can't stand {name}.", "Stay away from {name}. Trust me.", "{name} is bad news.", "{name} gets on my last nerve.", "Don't get me started on {name}."],
        ["lazy"] = ["{name} is... ugh. Too much.", "{name} is annoying. There, I said it.", "Not a fan of {name}. Whatever.", "Eh, {name}'s sketch.", "{name}? Pass."],
        ["energetic"] = ["Something is OFF about {name}!", "I don't trust {name} AT ALL!", "{name} gives me BAD vibes!", "Watch out for {name}!", "I've been keeping my eye on {name}!"],
        ["introvert"] = ["I\u2019ve been observing {name}... not good.", "Quietly, I don't trust {name}.", "{name} makes me uncomfortable.", "I\u2019d be careful around {name}.", "There's something hidden about {name}."],
        ["extrovert"] = ["OH MY GOD, do NOT get me started on {name}!", "Between us? {name} is THE WORST.", "{name} is SO sketchy!", "I've been telling EVERYONE about {name}!", "Honestly? {name} gives me the CREEPS!"]
    };

    public static readonly Dictionary<string, string[]> DawnThoughtsInnocent = new()
    {
        ["cheerful"] = ["What happened last night?", "Oh no... someone was killed...", "I'm so scared. Who did this?", "I just want everyone to be safe."],
        ["grumpy"] = ["Another murder. Of course.", "Who's responsible for this?", "I knew something bad would happen.", "This ends today."],
        ["lazy"] = ["Woke up to bad news... great.", "Did someone really die?", "This is too heavy for morning.", "I don't feel safe anymore."],
        ["energetic"] = ["What?! Who was killed?!", "We need to ACT! NOW!", "I barely slept thinking about this!", "This is UNACCEPTABLE!"],
        ["introvert"] = ["...another death.", "I've been lying awake thinking.", "Someone here is a monster.", "I need to be more careful."],
        ["extrovert"] = ["Oh my god, is everyone okay?!", "Who else couldn't sleep?!", "We need to talk about this!", "This is SO scary!"]
    };

    public static readonly Dictionary<string, string[]> DawnThoughtsMurderer = new()
    {
        ["cheerful"] = ["Act normal. Stay sunny.", "Nobody suspects the happy one.", "Just keep smiling...", "One less to worry about!"],
        ["grumpy"] = ["Perfect. One less to worry about.", "Heh. Too easy.", "They'll never figure it out.", "Pathetic. All of them."],
        ["lazy"] = ["That was easy enough.", "Back to pretending...", "They won't catch me. Too lazy to look suspicious.", "Smooth."],
        ["energetic"] = ["YES! Another one down!", "Stay focused! Act shocked!", "Nobody suspects me!", "Just a few more nights!"],
        ["introvert"] = ["Nobody noticed. Good.", "Quiet and methodical. That's me.", "They'll never suspect the quiet one.", "Stay calm. Stay invisible."],
        ["extrovert"] = ["Time to put on a SHOW!", "Act devastated! Be dramatic!", "Everyone will be watching\u2014perform!", "They love me too much to suspect me."]
    };

    public static readonly Dictionary<string, string[]> PersuadeLines = new()
    {
        ["cheerful"] = ["Please, just think about it\u2014{name} doesn't add up.", "I really think we should vote {name}. Sorry!", "I know it's hard, but {name} is our best lead."],
        ["grumpy"] = ["It's {name}. End of discussion.", "Vote {name} or you're a fool.", "How is this even a debate? {name}!"],
        ["lazy"] = ["Just... vote {name}. Easiest choice.", "{name}. Can we go home now?", "Look, it's gotta be {name}. Just vote."],
        ["energetic"] = ["EVERYONE VOTE {name}! LET'S GO!", "The evidence is CLEAR\u2014{name}!", "We can DO this! Vote {name}!"],
        ["introvert"] = ["I've thought about it carefully. It's {name}.", "The logic points to {name}. Please consider it.", "I wouldn't say this if I wasn't sure. {name}."],
        ["extrovert"] = ["You GUYS! It's SO obviously {name}!", "Can we all AGREE it's {name}?!", "I've been telling EVERYONE\u2014vote {name}!"]
    };

    public static readonly Dictionary<string, string[]> RelationThoughts = new()
    {
        ["love"] = ["They're literally my favourite person.", "I could talk to them forever.", "I'd do anything for them.", "Seeing them made my day."],
        ["like"] = ["They're pretty great, actually.", "Always good to see them.", "I'm lucky to know them.", "They get me."],
        ["neutral"] = ["Can't quite figure them out.", "We just don't click.", "Maybe I should give them a chance.", "Neither here nor there."],
        ["dislike"] = ["Ugh, them again.", "I'm smiling but I'm not happy about it.", "They grate on me.", "I don't trust them."],
        ["hate"] = ["I absolutely can't stand them.", "Every word they say annoys me.", "Why are they even here?", "I'm only pretending to be civil."]
    };
}
