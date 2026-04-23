using SwampOfSalem.Shared.Enums;

namespace SwampOfSalem.Gators.Phrases;

/// <summary>
/// Massive static phrase bank covering all six personality archetypes across every dialog type.
/// Phrases use {name} (self), {target} (speaking to / about), {victim} (murder victim),
/// {suspect} (top suspect name) as substitution tokens.
/// Warm/cold/neutral variants are keyed by relationship tier:
///   warm  = relation >= 20
///   cold  = relation &lt;= -20
///   neutral = everything else
/// </summary>
public static class PhraseBanks
{
    // ─── Dialog type key constants ───────────────────────────────────────────
    public const string Introduction    = "introduction";
    public const string Conversation    = "conversation";
    public const string Thought         = "thought";
    public const string Accusation      = "accusation";
    public const string Defense         = "defense";
    public const string Debate          = "debate";
    public const string Mourn           = "mourn";
    public const string DawnThought     = "dawn_thought";
    public const string Bluff           = "bluff";
    public const string Opinion         = "opinion";
    public const string Guarded         = "guarded";
    public const string ExecutePlea     = "execute_plea";
    public const string ExecuteReact    = "execute_react";
    public const string VoteAnnounce    = "vote_announce";
    public const string Persuade        = "persuade";

    // ─── Bank structure ──────────────────────────────────────────────────────
    // [personality][dialogType][tier] = string[]
    private static readonly Dictionary<Personality, Dictionary<string, Dictionary<string, string[]>>> _banks = new()
    {
        [Personality.Cheerful] = BuildCheerful(),
        [Personality.Grumpy]   = BuildGrumpy(),
        [Personality.Lazy]     = BuildLazy(),
        [Personality.Energetic]= BuildEnergetic(),
        [Personality.Introvert]= BuildIntrovert(),
        [Personality.Extrovert]= BuildExtrovert(),
    };

    /// <summary>
    /// Returns a phrase for the given personality, dialog type, and relationship tier.
    /// Tier is "warm", "cold", or "neutral". Falls back to neutral if tier is missing.
    /// </summary>
    public static string[] Get(Personality personality, string dialogType, string tier = "neutral")
    {
        if (!_banks.TryGetValue(personality, out var byType)) return Fallback(dialogType);
        if (!byType.TryGetValue(dialogType, out var byTier))  return Fallback(dialogType);
        if (!byTier.TryGetValue(tier, out var phrases))
            byTier.TryGetValue("neutral", out phrases);
        return phrases ?? Fallback(dialogType);
    }

    public static string RelationTier(double relation) =>
        relation >= 20 ? "warm" : relation <= -20 ? "cold" : "neutral";

    private static string[] Fallback(string dialogType) =>
        [$"[{dialogType}]"];

    // ═══════════════════════════════════════════════════════════════════════════
    //  CHEERFUL
    // ═══════════════════════════════════════════════════════════════════════════
    private static Dictionary<string, Dictionary<string, string[]>> BuildCheerful() => new()
    {
        [Introduction] = new()
        {
            ["warm"]    = ["Hey {target}! 😊 I'm {name} and I absolutely love living in this swamp! What's your favourite thing about our neighbourhood?",
                           "Oh hi {target}! I'm {name}! I've heard such lovely things about you — do you like oranges? I have a whole basket! 🍊"],
            ["cold"]    = ["Uh, hi there. I'm {name}. Nice to meet you, I guess.",
                           "Hello! I'm {name}. I try to say hi to everyone, so... hi! 😅"],
            ["neutral"] = ["Hi there! I'm {name} — always happy to meet new neighbours! 😄 What brings you this way?",
                           "Oh hello! I'm {name}! Isn't this swamp just the best? I hope we can be great friends! 🌿"],
        },
        [Conversation] = new()
        {
            ["warm"]    = ["You always know how to brighten my day, {target}! 😊 How are you feeling today?",
                           "I was just thinking about you! Did you see the pretty lilies blooming by the pond this morning?",
                           "You're honestly one of my favourite gators around here, {target}. Thanks for always being so kind!"],
            ["cold"]    = ["So... nice weather today, right? 🌤️",
                           "I'm trying to stay positive! Hopefully things are going well for you too, {target}."],
            ["neutral"] = ["Isn't it a beautiful day in the swamp? 🌿 What have you been up to?",
                           "I heard there might be fireflies out tonight — have you ever tried to catch one?",
                           "Do you prefer apples or oranges? I'm asking everyone today just for fun! 🍎🍊"],
        },
        [Thought] = new()
        {
            ["warm"]    = ["I really do trust {target} — they've never given me a reason not to. 😊",
                           "I feel safe around {target}. If something bad happened I'd want them by my side."],
            ["cold"]    = ["Something about {target} rubs me the wrong way... I can't quite put my claw on it. 😟",
                           "I keep trying to give {target} the benefit of the doubt, but it's getting harder."],
            ["neutral"] = ["I wonder if everyone around me is as happy as they look... probably not. 😔",
                           "I hope this whole murder thing gets sorted out. I just want everyone to be safe!"],
        },
        [Accusation] = new()
        {
            ["warm"]    = ["I'm SO sorry {target} but I really think {suspect} might be the one — something just feels off! 😟",
                           "This breaks my heart to say but... I think {suspect} did it. Please don't be upset with me!"],
            ["cold"]    = ["I've had a bad feeling about {suspect} for a while now. I think they did it!",
                           "{suspect} has been acting really strange and I don't think it's a coincidence!"],
            ["neutral"] = ["Okay everyone, I hate to say it but I really suspect {suspect}! Something seems very off! 😬",
                           "I'm usually an optimist but my gut says {suspect} is the murderer. Let's talk about it!"],
        },
        [Defense] = new()
        {
            ["warm"]    = ["Oh no no no, I would NEVER! You know me {target}, I'm the most non-violent gator here! 🥺",
                           "Please believe me {target} — I care about everyone in this swamp way too much to ever hurt anyone!"],
            ["cold"]    = ["I... I didn't do anything! Why would I?! I've been nothing but nice to everyone!",
                           "This is so unfair! I have been friendly to EVERYONE and this is what I get?!"],
            ["neutral"] = ["I promise on all the lilypads in this swamp I am innocent! 🌺 Please believe me!",
                           "Me?! The murderer?! I can't even step on a bug without feeling guilty! You've got the wrong gator!"],
        },
        [Debate] = new()
        {
            ["warm"]    = ["I hear you {target}, but I honestly think {suspect} is more suspicious — remember when they were near the victim last night?",
                           "I don't want to point claws but {suspect} has been unusually quiet about all of this, which worries me."],
            ["cold"]    = ["{suspect} keeps deflecting every time someone asks a direct question. That's not nothing!",
                           "I noticed {suspect} didn't seem upset at all when we found the body. That stuck with me!"],
            ["neutral"] = ["Can we talk about {suspect} for a second? Because something they said earlier didn't add up!",
                           "I've been thinking about this all morning and {suspect}'s alibi just doesn't hold together!"],
        },
        [Mourn] = new()
        {
            ["warm"]    = ["Oh no... not {victim}! They were so kind! I can't believe this is happening! 😭",
                           "{victim} didn't deserve this at all. We're going to find who did this, I promise! 🌿"],
            ["cold"]    = ["This is awful... I didn't know {victim} that well but nobody deserves this.",
                           "I feel sick. We need to figure out who is doing this before someone else gets hurt!"],
            ["neutral"] = ["Poor {victim}... this swamp is getting really scary. We need to stick together everyone! 😢",
                           "I keep hoping I'll wake up from this nightmare. We have to find the murderer!"],
        },
        [DawnThought] = new()
        {
            ["neutral"] = ["Someone I care about is gone... I need to stay strong and find whoever did this. 💔",
                           "Every morning I wake up hoping it was just a bad dream. Today it wasn't."],
        },
        [Bluff] = new()
        {
            ["neutral"] = ["I've been so scared lately — I barely slept last night! Do you think we're close to figuring this out?",
                           "I hope the murderer knows that we're all watching very carefully. Together we'll catch them! 👀"],
        },
        [Opinion] = new()
        {
            ["warm"]    = ["{target} is genuinely one of the sweetest gators here — I'm glad they're my neighbour! 😊",
                           "I have nothing but nice things to say about {target}! They always make me smile!"],
            ["cold"]    = ["Honestly {target} and I just don't click very well... I don't know why.",
                           "I try to be positive about everyone but {target} has been a little cold with me lately."],
            ["neutral"] = ["{target} seems fine to me! A bit hard to read sometimes, but generally okay.",
                           "I think {target} just needs a friend. They seem a bit lonely honestly."],
        },
        [Guarded] = new()
        {
            ["cold"]  = ["Sure. Whatever you say.",
                         "Mm-hmm. I have to go check something."],
            ["neutral"] = ["That's... interesting. I guess.",
                           "Okay then. Thanks."],
        },
        [ExecutePlea] = new()
        {
            ["neutral"] = ["Please! I am INNOCENT! You're making a huge mistake and I will haunt you all from the lily pond! 😭",
                           "I beg you — don't do this! I have done nothing wrong! Someone else is the real killer! Please listen!"],
        },
        [ExecuteReact] = new()
        {
            ["neutral"] = ["I really hope we got the right one... my tummy is in knots. 😰",
                           "This is so hard to watch. I hope justice was done today."],
        },
        [VoteAnnounce] = new()
        {
            ["neutral"] = ["With a heavy heart I vote for {suspect}. I'm so sorry but I think it's them.",
                           "I vote {suspect}. I really hope I'm wrong, but everything points to them. 😞"],
        },
        [Persuade] = new()
        {
            ["neutral"] = ["Please think about {suspect}'s behaviour during the debate — doesn't it seem suspicious to you?",
                           "I really need everyone to consider {suspect}. The clues all lead back to them — let's not ignore that!"],
        },
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  GRUMPY
    // ═══════════════════════════════════════════════════════════════════════════
    private static Dictionary<string, Dictionary<string, string[]>> BuildGrumpy() => new()
    {
        [Introduction] = new()
        {
            ["warm"]    = ["Yeah yeah, I'm {name}. At least you're not as annoying as the other neighbours.",
                           "I'm {name}. You seem alright. Don't push it."],
            ["cold"]    = ["Name's {name}. I don't do small talk. You got something useful to say?",
                           "I'm {name}. Don't expect me to be your friend."],
            ["neutral"] = ["I'm {name}. This swamp was quieter before everyone moved in.",
                           "{name}. That's all you need to know."],
        },
        [Conversation] = new()
        {
            ["warm"]    = ["You're one of the few gators around here that actually makes sense, {target}.",
                           "Alright, I'll admit — talking to you isn't completely terrible.",
                           "You want the truth? I actually don't mind having you as a neighbour."],
            ["cold"]    = ["What do you want, {target}. I'm busy.",
                           "I'd rather be alone than have this conversation."],
            ["neutral"] = ["The apples near the south bank are rotting again. Someone should deal with it.",
                           "This whole situation is making me even more irritable than usual.",
                           "I haven't slept well in days. Something's not right in this swamp."],
        },
        [Thought] = new()
        {
            ["warm"]    = ["I don't trust easily, but {target} has earned it. That means something coming from me.",
                           "{target} is solid. I'd vouch for them if I had to."],
            ["cold"]    = ["{target} gets under my scales every time they open their mouth.",
                           "There's something off about {target}. I've thought so since day one."],
            ["neutral"] = ["This whole swamp is full of idiots and I'm somehow supposed to figure out which one is a killer.",
                           "I need to think. Everyone is acting suspicious and that makes everyone a suspect."],
        },
        [Accusation] = new()
        {
            ["warm"]    = ["I hate to say it but I've been watching {suspect} and they don't add up. Look at the facts.",
                           "Even I can admit when I'm wrong but on {suspect} — I'm not wrong."],
            ["cold"]    = ["{suspect}. It's {suspect}. I've been saying something's off about them for days.",
                           "Stop dancing around it — {suspect} did it. I'd bet my oranges on it."],
            ["neutral"] = ["I've done the math and {suspect} keeps coming up. They're the most likely culprit.",
                           "Don't take my word for it — look at what {suspect} has been doing. It's obvious."],
        },
        [Defense] = new()
        {
            ["warm"]    = ["You think I did it? I don't even like leaving my house. Use your head, {target}.",
                           "I'm the one who's been suspicious of everyone — murderers don't DO that."],
            ["cold"]    = ["Oh that's rich. You really think I did it? Look elsewhere.",
                           "Wrong gator. I have no motive and I have been watching everyone too carefully to slip up."],
            ["neutral"] = ["I didn't do it. I never said I was nice, but I'm not a murderer.",
                           "If I were the killer I would have done a much better job of hiding it, believe me."],
        },
        [Debate] = new()
        {
            ["warm"]    = ["I'll point out the same thing I've been pointing out — {suspect}'s story keeps changing.",
                           "You want evidence? {suspect} was seen near the south bank that night. Ask around."],
            ["cold"]    = ["{suspect} is deflecting. Every time someone gets close they change the subject. Classic.",
                           "The way {suspect} reacted when we found the body told me everything I needed to know."],
            ["neutral"] = ["Let me be direct: {suspect} has the most to gain and the worst alibi. That's my vote.",
                           "I don't do speculation. I do facts. And the facts point to {suspect}."],
        },
        [Mourn] = new()
        {
            ["warm"]    = ["Damn it. {victim} was one of the decent ones. Whoever did this is going to regret it.",
                           "I'm angry. {victim} didn't deserve this. I'm going to find who's responsible."],
            ["cold"]    = ["Another one gone. This is getting out of hand.",
                           "We need to stop moping and start thinking. Someone here did this."],
            ["neutral"] = ["I'm not going to pretend I'm not furious. Someone here is a murderer.",
                           "{victim} is dead. That's on all of us for not figuring this out sooner."],
        },
        [DawnThought] = new()
        {
            ["neutral"] = ["Another body. Another day of watching idiots point fingers at each other instead of the real killer.",
                           "I knew the swamp was dangerous, but I underestimated just how dangerous."],
        },
        [Bluff] = new()
        {
            ["neutral"] = ["I've been watching everyone very carefully. Nobody escapes my attention.",
                           "I'm building a mental list of suspicious behaviours. Several names are on it already."],
        },
        [Opinion] = new()
        {
            ["warm"]    = ["{target} is one of the few gators I actually respect around here. Don't tell them I said that.",
                           "Fine, {target} is decent. I said it. Move on."],
            ["cold"]    = ["{target} has been getting on my last nerve. There's something I don't trust about them.",
                           "I'd rather not talk about {target}. Let's just say we don't see eye to eye."],
            ["neutral"] = ["{target}? Mediocre. Neither useful nor a complete waste of swamp space.",
                           "Haven't formed a strong opinion on {target} yet. Still watching."],
        },
        [Guarded] = new()
        {
            ["cold"]    = ["I don't have anything to say to you.",
                           "I'd rather be quiet than talk to you right now."],
            ["neutral"] = ["Mm.",
                           "Sure. Is that all?"],
        },
        [ExecutePlea] = new()
        {
            ["neutral"] = ["I'm not going to beg. But you've got the wrong gator, and you'll figure that out when someone else dies.",
                           "Fine. Execute me. See how that works out for you when the murders keep happening."],
        },
        [ExecuteReact] = new()
        {
            ["neutral"] = ["Let's hope that was the right call. I have my doubts.",
                           "Justice or a mistake. We'll find out tonight."],
        },
        [VoteAnnounce] = new()
        {
            ["neutral"] = ["My vote is {suspect}. I don't change my mind once I've done the analysis.",
                           "{suspect}. Straightforward decision. Moving on."],
        },
        [Persuade] = new()
        {
            ["neutral"] = ["Look at {suspect}'s behaviour objectively. Every suspicious act traces back to them.",
                           "I don't ask for things twice. Vote {suspect}. The evidence is right there if you actually look."],
        },
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  LAZY
    // ═══════════════════════════════════════════════════════════════════════════
    private static Dictionary<string, Dictionary<string, string[]>> BuildLazy() => new()
    {
        [Introduction] = new()
        {
            ["warm"]    = ["Hey. I'm {name}. You seem alright. Wanna just sit here for a while?",
                           "{name}. That's me. You seem like the kind of gator who doesn't talk too much. I like that."],
            ["cold"]    = ["Oh. Hi. {name}.",
                           "Yeah, I'm {name}. Can we make this quick?"],
            ["neutral"] = ["{name}. Don't need much else to know.",
                           "Name's {name}. I was napping. What's up?"],
        },
        [Conversation] = new()
        {
            ["warm"]    = ["Hey {target}, wanna just do nothing together? That's honestly my favourite thing.",
                           "You're easy to be around, {target}. Most gators exhaust me.",
                           "I was gonna nap but talking to you is almost as good."],
            ["cold"]    = ["What do you want.",
                           "Sure. Whatever."],
            ["neutral"] = ["I had a great nap earlier. Just thought you should know.",
                           "Do you ever just... not do anything? It's underrated.",
                           "I'd move but that sounds like a lot of effort."],
        },
        [Thought] = new()
        {
            ["warm"]    = ["I like {target}. Low drama, easy to be around. That's all I ask for.",
                           "{target} is fine by me. I'd make effort for them if I absolutely had to."],
            ["cold"]    = ["{target} is too much. I can't deal with that energy.",
                           "I avoid {target} when I can. Too draining."],
            ["neutral"] = ["This whole murder thing is really messing with my sleep schedule.",
                           "I should pay more attention to what's going on... maybe tomorrow."],
        },
        [Accusation] = new()
        {
            ["warm"]    = ["Ugh, I hate saying this but... it might be {suspect}. Sorry.",
                           "I've been trying to ignore it but {suspect} has been acting weird."],
            ["cold"]    = ["{suspect}. Done. That's my answer.",
                           "It's probably {suspect}. Can we wrap this up."],
            ["neutral"] = ["I think it's {suspect}. I'll explain if I have to.",
                           "My gut says {suspect}. I don't have energy to elaborate right now."],
        },
        [Defense] = new()
        {
            ["warm"]    = ["I didn't do anything. I was napping, ask literally anyone.",
                           "Come on {target}, you know me. I don't have the energy to be a murderer."],
            ["cold"]    = ["Not me. Look elsewhere.",
                           "I was asleep. That's my alibi and it's airtight."],
            ["neutral"] = ["I didn't do it. Too much effort.",
                           "Murder requires planning and follow-through. That's not really my thing."],
        },
        [Debate] = new()
        {
            ["warm"]    = ["I don't usually speak up but... {suspect} has been off and I trust my instincts.",
                           "{suspect} said something weird earlier. I wrote it off but now I'm not so sure."],
            ["cold"]    = ["{suspect}. Moving on.",
                           "Vote {suspect}. I'm tired."],
            ["neutral"] = ["{suspect} keeps popping up near the suspicious stuff. That's all I've got.",
                           "Look, I haven't been paying close attention, but even I noticed {suspect} acting strange."],
        },
        [Mourn] = new()
        {
            ["warm"]    = ["Ugh... {victim}. This is terrible. I actually liked them.",
                           "{victim} gone. That's awful. I don't want to think about it but I have to."],
            ["cold"]    = ["This is bad. Someone here is killing us.",
                           "Another one. We need to do something. Soon."],
            ["neutral"] = ["Wow. Okay. This is real. {victim} is gone.",
                           "I didn't expect to feel this bad. {victim} was... decent."],
        },
        [DawnThought] = new()
        {
            ["neutral"] = ["Can't sleep now. Every time I close my eyes I think about {victim}.",
                           "I've been putting off thinking about this. Can't do that anymore."],
        },
        [Bluff] = new()
        {
            ["neutral"] = ["I've been in my house mostly. Just staying out of trouble.",
                           "Not sure what everyone's been doing. I stay in my lane."],
        },
        [Opinion] = new()
        {
            ["warm"]    = ["{target} is chill. Good neighbour. No complaints.",
                           "I don't say this often but {target} is genuinely okay."],
            ["cold"]    = ["{target} is a lot. Not my favourite.",
                           "I'd rather not talk about {target}."],
            ["neutral"] = ["{target}? Seems fine I guess.",
                           "Haven't formed a strong opinion. I don't really pay attention."],
        },
        [Guarded] = new()
        {
            ["cold"]    = ["...", "Not now."],
            ["neutral"] = ["Mmk.", "Sure, I guess."],
        },
        [ExecutePlea] = new()
        {
            ["neutral"] = ["This is honestly the most effort I've ever put into anything and I'm spending it telling you I'm innocent.",
                           "I didn't do it. I know I'm lazy but I'm not a killer. Please."],
        },
        [ExecuteReact] = new()
        {
            ["neutral"] = ["Ugh. I hope that was right.",
                           "That was intense. I need to lie down."],
        },
        [VoteAnnounce] = new()
        {
            ["neutral"] = ["Voting {suspect}. That's it.",
                           "{suspect}. Can we be done now."],
        },
        [Persuade] = new()
        {
            ["neutral"] = ["Just think about it — {suspect} makes the most sense.",
                           "I wouldn't say this if I didn't think it was true. {suspect}. Trust me."],
        },
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  ENERGETIC
    // ═══════════════════════════════════════════════════════════════════════════
    private static Dictionary<string, Dictionary<string, string[]>> BuildEnergetic() => new()
    {
        [Introduction] = new()
        {
            ["warm"]    = ["HEY! I'm {name}! I've literally been wanting to meet you! THIS IS SO EXCITING! 🐊",
                           "YO {target}!! I'm {name}! Can you BELIEVE how great this swamp is?! I love it here!"],
            ["cold"]    = ["HI! I'm {name}! I try to meet EVERYONE! Nice to meet you!",
                           "I'm {name}! You'll remember me because I'M ALWAYS AROUND! Let's go!"],
            ["neutral"] = ["HELLO!!! I'm {name}!! I've been running around the whole swamp today! Have you seen the new lily patch?!",
                           "NAME'S {name}! I talk fast and walk faster — keeping up is optional but encouraged!"],
        },
        [Conversation] = new()
        {
            ["warm"]    = ["OH MAN I was hoping to run into you {target}! You always make things more fun!",
                           "YOU ARE THE BEST, {target}! I mean it! Can we go for a jog later?!",
                           "I just saw something WILD by the east pond and you are literally the first person I thought to tell!"],
            ["cold"]    = ["HEY! I know we don't always get along but I hope you're doing okay!",
                           "Let's be real with each other {target}! No hard feelings, okay?!"],
            ["neutral"] = ["OKAY SO — have you ever tried running through the tall reeds at full speed?! LIFE CHANGING!",
                           "I have SO much energy today and nowhere to put it. What have you been up to?!",
                           "The swamp is beautiful today! I've already lapped it TWICE this morning!"],
        },
        [Thought] = new()
        {
            ["warm"]    = ["I would run into danger for {target} without hesitating. That's just the truth.",
                           "{target} is solid. I'd trust them with my back turned."],
            ["cold"]    = ["Something is OFF about {target} and I can FEEL it in my scales.",
                           "I've been watching {target} and I don't like what I see."],
            ["neutral"] = ["I CAN'T JUST STAND AROUND. There's a killer here and I want to FIND them!",
                           "Every instinct in me is screaming that something is wrong. I need to ACT."],
        },
        [Accusation] = new()
        {
            ["warm"]    = ["OKAY I hate this but it HAS to be {suspect}! I don't want it to be true but LOOK AT THE SIGNS!",
                           "I've been running the clues through my head all DAY and they all point to {suspect}!!"],
            ["cold"]    = ["IT'S {suspect}!! I've KNOWN it and I'm DONE holding back! IT'S THEM!",
                           "{suspect}!! COME ON!! Everyone SEES it!"],
            ["neutral"] = ["ALRIGHT I'M CALLING IT — {suspect} is the murderer! I have REASONS! Listen to me!",
                           "I've been chasing this clue all morning and it leads straight to {suspect}! WE NEED TO TALK ABOUT THIS!"],
        },
        [Defense] = new()
        {
            ["warm"]    = ["NO WAY!! {target} I can't believe you'd even think that!! I'VE BEEN TRYING TO HELP!!",
                           "You KNOW me!! I run around helping EVERYONE!! Why would I do this?!"],
            ["cold"]    = ["WRONG!! Try harder!! I didn't do ANYTHING!!",
                           "I WAS RUNNING AROUND ALL DAY!! You can ask ANYONE!! NOT ME!!"],
            ["neutral"] = ["NO!! I have way too much energy to be secretly evil!! I'd be TERRIBLE at hiding it!!",
                           "I literally cannot stop talking!! You think I could keep a murder secret?! IMPOSSIBLE!!"],
        },
        [Debate] = new()
        {
            ["warm"]    = ["HEAR ME OUT — {suspect} was NOT where they said they were! I was running past that area and THEY WEREN'T THERE!",
                           "I've been up since dawn piecing this together and {suspect}'s story has MORE HOLES THAN A LILY PAD!"],
            ["cold"]    = ["{suspect} keeps DODGING and I am DONE with it!! ANSWER THE QUESTION!!",
                           "I SAW {suspect} near the victim's house!! SAY SOMETHING!!"],
            ["neutral"] = ["I'VE RUN THE ROUTE!! {suspect} could NOT have been where they claimed!! IT DOESN'T ADD UP!!",
                           "Every gator I've talked to today mentioned {suspect} doing something weird!! THAT'S NOT NOTHING!!"],
        },
        [Mourn] = new()
        {
            ["warm"]    = ["NO!! NOT {victim}!!! I can't— we have to DO something!! I'm going to find out WHO DID THIS!!",
                           "{victim}!! This is AWFUL!! I am so MAD!! We are FINDING this killer TODAY!!"],
            ["cold"]    = ["We have to MOVE. This can't keep happening. SOMEBODY HERE IS A KILLER!!",
                           "I am NOT standing around while a murderer walks free!! LET'S GO!!"],
            ["neutral"] = ["THIS ENDS NOW!! {victim} didn't deserve this and WE ARE GOING TO FIND THE KILLER!!",
                           "I feel like running until I figure this out. EVERYONE NEEDS TO TALK. NOW."],
        },
        [DawnThought] = new()
        {
            ["neutral"] = ["I couldn't sleep anyway. Time to move. Time to THINK. Time to CATCH A MURDERER.",
                           "Every time someone dies I get MORE determined. I will NOT let this stand."],
        },
        [Bluff] = new()
        {
            ["neutral"] = ["I've been running patrols! If the killer tried anything I would have SEEN them!",
                           "I haven't been anywhere near the crime area — I was on the EAST side of the swamp all night!"],
        },
        [Opinion] = new()
        {
            ["warm"]    = ["{target} is AMAZING! 10/10 swamp neighbour! Absolute legend!",
                           "I would sprint into battle for {target}! They're GREAT!"],
            ["cold"]    = ["{target} has been sketchy lately and I'm not gonna pretend otherwise!",
                           "I love everyone but {target} has been testing me lately, not gonna lie!"],
            ["neutral"] = ["{target} seems okay! Hard to keep up with me but who isn't honestly!",
                           "I don't know {target} that well yet but I wanna find out! RUNNING INTO THEM TODAY!"],
        },
        [Guarded] = new()
        {
            ["cold"]    = ["I'm not in the mood for this right now.", "Talk later."],
            ["neutral"] = ["Sure whatever, I've got places to be.", "Okay. Yeah. Moving on."],
        },
        [ExecutePlea] = new()
        {
            ["neutral"] = ["PLEASE!! I AM INNOCENT!! I'VE BEEN RUNNING AROUND TRYING TO HELP THIS WHOLE TIME!! DON'T DO THIS!!",
                           "YOU'RE MAKING A MISTAKE!! THE REAL KILLER IS STILL OUT THERE!! STOP!!"],
        },
        [ExecuteReact] = new()
        {
            ["neutral"] = ["I hope we got it right. I really do. For {victim}'s sake.",
                           "That was intense. I need to run a lap. Or ten."],
        },
        [VoteAnnounce] = new()
        {
            ["neutral"] = ["MY VOTE IS {suspect}!! I have been saying this ALL DAY and I stand by it!!",
                           "VOTING {suspect}!! The clues are RIGHT THERE!! Let's end this!!"],
        },
        [Persuade] = new()
        {
            ["neutral"] = ["LISTEN TO ME!! {suspect} is suspicious and EVERYONE has noticed!! VOTE WITH ME!!",
                           "I am begging you — look at everything {suspect} has done!! IT ALL ADDS UP!!"],
        },
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  INTROVERT
    // ═══════════════════════════════════════════════════════════════════════════
    private static Dictionary<string, Dictionary<string, string[]>> BuildIntrovert() => new()
    {
        [Introduction] = new()
        {
            ["warm"]    = ["I'm {name}. I don't usually approach first — you seem worth making an exception for.",
                           "{name}. I observed you for a while before deciding to say hello. You seem thoughtful."],
            ["cold"]    = ["{name}. I'll be brief.",
                           "I'm {name}. I'd rather be reading, but here we are."],
            ["neutral"] = ["{name}. I prefer listening over talking, just so you know.",
                           "I'm {name}. I'll admit I'm not great at introductions. Sorry about that."],
        },
        [Conversation] = new()
        {
            ["warm"]    = ["I've been thinking about something you said last time... it was more interesting than I let on.",
                           "You're one of the few I actually look forward to talking to, {target}.",
                           "I notice things others don't. And I've noticed you're more careful than most."],
            ["cold"]    = ["I'll keep this brief.",
                           "I don't have much to say right now."],
            ["neutral"] = ["I've been watching the water patterns by the north bank. Something feels wrong.",
                           "I notice things when others aren't looking. It's become a habit lately.",
                           "Most gators talk too much. I prefer to think. But sometimes thinking out loud helps."],
        },
        [Thought] = new()
        {
            ["warm"]    = ["{target} thinks before speaking. I trust that. It's rare here.",
                           "If I had to confide in anyone it would be {target}. They'd actually listen."],
            ["cold"]    = ["There's something I've been carefully observing about {target}. I need more data.",
                           "{target} performs calm better than they feel it. I've noticed the inconsistency."],
            ["neutral"] = ["I've been cataloguing every small inconsistency. The list is getting long.",
                           "Most gators react. I observe. I'll have an answer when I'm certain."],
        },
        [Accusation] = new()
        {
            ["warm"]    = ["I've spent a long time thinking about this before saying it: {suspect} is the one I suspect most.",
                           "I don't accuse lightly. My analysis leads to {suspect}. Here's why."],
            ["cold"]    = ["I've been watching {suspect} for days. Their behaviour is inconsistent in specific ways that matter.",
                           "{suspect}. I've been building this conclusion quietly for a while. It holds."],
            ["neutral"] = ["I don't say this without evidence. Every pattern I've observed points toward {suspect}.",
                           "I've noticed things others have missed. {suspect} is my primary suspect and here is why."],
        },
        [Defense] = new()
        {
            ["warm"]    = ["I understand the suspicion {target}, but I have been observing — not acting. Think about it.",
                           "If you look at the evidence carefully you'll see it doesn't hold together against me."],
            ["cold"]    = ["I expected this. I don't have the energy to prove myself to you.",
                           "I was watching everyone else. That includes watching for exactly what you're accusing me of."],
            ["neutral"] = ["I have been a passive observer this entire time. That's demonstrably true if you think it through.",
                           "My pattern of behaviour throughout this game doesn't match a murderer. Please reconsider."],
        },
        [Debate] = new()
        {
            ["warm"]    = ["I'll share what I've observed about {suspect} — specifically, three inconsistencies I logged over the past two days.",
                           "The fact that {suspect} changed their account of where they were on the second night is significant."],
            ["cold"]    = ["{suspect} said two things that directly contradict each other. I wrote them down.",
                           "I've counted four moments where {suspect} changed the subject when asked directly. That's a pattern."],
            ["neutral"] = ["I've been quietly observing. {suspect} is the name that keeps appearing in my notes.",
                           "Let me present the specific observations that led me to suspect {suspect}."],
        },
        [Mourn] = new()
        {
            ["warm"]    = ["I'm... genuinely affected by this. {victim} mattered. I don't say that about many.",
                           "I need a moment. {victim} was one of the good ones. Whoever did this will face consequences."],
            ["cold"]    = ["The pattern has escalated. I had hoped it wouldn't come to this again.",
                           "Each loss tightens the circle of trust. And narrows my list of suspects."],
            ["neutral"] = ["I'm adding this to my mental record. {victim}'s death will be part of how we find the killer.",
                           "I don't express it loudly but I'm grieving. And I'm angry. And I'm watching."],
        },
        [DawnThought] = new()
        {
            ["neutral"] = ["I've already begun forming a new hypothesis based on the murder location and method.",
                           "I didn't sleep. I was thinking. I have conclusions. I'll share them carefully."],
        },
        [Bluff] = new()
        {
            ["neutral"] = ["I was inside. I observe but I don't wander at night. It's safer.",
                           "I can account for my whereabouts in detail, should anyone ask."],
        },
        [Opinion] = new()
        {
            ["warm"]    = ["{target} is perceptive. I don't say that often. It means something.",
                           "I trust {target}'s judgment more than most. They pay attention."],
            ["cold"]    = ["My read on {target} is incomplete. I'm reserving judgment but I'm wary.",
                           "Something about {target} doesn't quite fit together. I'm watching."],
            ["neutral"] = ["{target} is... interesting. I haven't decided yet.",
                           "I don't have enough data on {target} to form a strong opinion."],
        },
        [Guarded] = new()
        {
            ["cold"]    = ["I'd rather not.", "I don't think this conversation is useful right now."],
            ["neutral"] = ["Mm.", "Noted."],
        },
        [ExecutePlea] = new()
        {
            ["neutral"] = ["I have spent this entire game watching and thinking. Execute me and the real murderer benefits. Think about it.",
                           "I won't beg. But I will say this: my notes are consistent with innocence. Look at them before you decide."],
        },
        [ExecuteReact] = new()
        {
            ["neutral"] = ["I'll know if we were right by tonight. I'll be watching.",
                           "It had to be done. Whether it was right... I'll know soon enough."],
        },
        [VoteAnnounce] = new()
        {
            ["neutral"] = ["My vote is {suspect}. I've observed more than I've said and this is my conclusion.",
                           "I vote {suspect}. I don't expect everyone to understand my reasoning immediately. It will become clear."],
        },
        [Persuade] = new()
        {
            ["neutral"] = ["I rarely ask for things. I am asking now: look at {suspect}'s pattern of behaviour. Then vote accordingly.",
                           "I've laid out the evidence about {suspect} carefully. I trust you to reach the same conclusion I did."],
        },
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  EXTROVERT
    // ═══════════════════════════════════════════════════════════════════════════
    private static Dictionary<string, Dictionary<string, string[]>> BuildExtrovert() => new()
    {
        [Introduction] = new()
        {
            ["warm"]    = ["OH DARLING, I am so glad we finally OFFICIALLY met! I'm {name} and I am DELIGHTFUL! 🎉",
                           "I've been watching you from across the swamp and thinking — THAT is someone I need to know! I'm {name}!"],
            ["cold"]    = ["Well hello! I'm {name}! I make it my business to know everyone, even if they don't make it their business to know me!",
                           "I'm {name} and I have a policy of charming even my least favourite neighbours! So here we are!"],
            ["neutral"] = ["HELLO GORGEOUS NEIGHBOUR! I'm {name} and this is the beginning of a beautiful friendship, I can feel it! 🌟",
                           "I don't know you yet but that is a PROBLEM I intend to fix! I'm {name}! Tell me EVERYTHING about yourself!"],
        },
        [Conversation] = new()
        {
            ["warm"]    = ["I was JUST talking about you! To like, three different gators! All wonderful things, obviously!",
                           "{target} you absolutely made my day brighter just by showing up! You always do!",
                           "I feel like we need to have a proper gathering at my place — you, me, good food, good gossip!"],
            ["cold"]    = ["You know I hold no grudges, right? Life's too short and the swamp's too small!",
                           "I'm going to charm you whether you want me to or not, {target}! That's just who I am!"],
            ["neutral"] = ["I've been hosting little get-togethers to keep morale up! You should absolutely come!",
                           "Everyone is so tense! I'm trying to bring a little joy back to this neighbourhood!",
                           "I heard the most FASCINATING piece of gossip earlier — want to hear it?"],
        },
        [Thought] = new()
        {
            ["warm"]    = ["I adore {target} and I would be devastated if they turned out to be the killer. Please don't be the killer.",
                           "{target} makes me feel safe and I don't want to second-guess that. But I'm aware I trust easily."],
            ["cold"]    = ["I put on a smile for {target} but between us — I don't fully trust them.",
                           "I'm charming on the outside but I'm watching {target} very carefully."],
            ["neutral"] = ["I wonder if my social reading of people is helping or hurting me in this situation.",
                           "Everyone reveals themselves eventually. I just have to keep them talking."],
        },
        [Accusation] = new()
        {
            ["warm"]    = ["This is genuinely tearing me apart to say but... I think {suspect} might be responsible. I had such high hopes for them!",
                           "I've been performing positivity all week but privately I've suspected {suspect} for days. I can't stay quiet anymore."],
            ["cold"]    = ["Darlings, I have BEEN saying {suspect} was fishy and now here we are! I have receipts!",
                           "I hosted a gathering and watched how {suspect} interacted with everyone. Something is very wrong there."],
            ["neutral"] = ["Okay everyone GATHER AROUND because I have THOUGHTS about {suspect} and I will not be silenced! 🌟",
                           "I've made it my mission to read every gator in this swamp and {suspect} is giving me BAD vibes. Here's why!"],
        },
        [Defense] = new()
        {
            ["warm"]    = ["Oh sweetheart, you don't REALLY think it's me, do you? I've been building connections here, not destroying them!",
                           "{target} please! I have been trying to unite this community not tear it apart! Think about who that benefits!"],
            ["cold"]    = ["Honey, if I were a murderer I would be SO much better at hiding it! I am far too visible!",
                           "Me?! The murderer?! I can't even keep a secret for five minutes! I told everyone your business!"],
            ["neutral"] = ["Darlings I have been HOSTING, SOCIALISING, and BRINGING JOY! Does that sound like a killer?! I THINK NOT!",
                           "If I were the murderer I'd have already accused someone else dramatically and made it stick! I'm a PERFORMER!"],
        },
        [Debate] = new()
        {
            ["warm"]    = ["I've been reading the room this whole time and {suspect} keeps registering as OFF — and I know what OFF looks like!",
                           "I pulled {suspect} aside to chat and they avoided every direct question! A social butterfly I am not... a detector of deception I am!"],
            ["cold"]    = ["{suspect} has been performing innocence in a way I recognise because I do the SAME THING when I want to deflect!",
                           "I host parties. I read people. {suspect} is hiding something. Take it from the extrovert."],
            ["neutral"] = ["I've spoken to every gator here this week and the ONLY one who gave me a bad feeling was {suspect}! That MEANS something!",
                           "I make it my job to know everyone's energy — and {suspect}'s energy has been wrong since day one! LISTEN TO ME!"],
        },
        [Mourn] = new()
        {
            ["warm"]    = ["Oh {victim}... I'm going to throw the most beautiful remembrance gathering for them. And then I'm going to find their killer.",
                           "This community just lost one of its brightest lights. {victim} deserved better. WE deserve better."],
            ["cold"]    = ["I am putting on a brave face for everyone right now but inside I am terrified and furious.",
                           "I will not let this swamp fall apart. {victim} would not want that. Someone here will answer for this."],
            ["neutral"] = ["I refuse to let this place become defined by grief and fear! But first... let me mourn {victim} for a moment. 💔",
                           "{victim} came to one of my gatherings once. I remember exactly what they said. I'm going to miss that."],
        },
        [DawnThought] = new()
        {
            ["neutral"] = ["I was up all night talking to neighbours, collecting impressions. I have a very strong feeling about who did this.",
                           "I perform happiness but inside I am devastated and determined. Someone chose to destroy this community."],
        },
        [Bluff] = new()
        {
            ["neutral"] = ["I was at my own gathering last night! There are like SEVEN witnesses! You can ask any of them!",
                           "I've been visiting and hosting — my whole night is accounted for by half the neighbourhood!"],
        },
        [Opinion] = new()
        {
            ["warm"]    = ["{target}! Oh I ADORE them! They came to every gathering and brought the BEST snacks!",
                           "I could talk about {target} all day — genuinely one of the loveliest gators in this whole swamp!"],
            ["cold"]    = ["Okay between us? {target} and I have had our... moments. I'm professional about it but I notice things.",
                           "I keep reaching out to {target} and they keep being... chilly. I'm performing warmth but I'm cataloguing it."],
            ["neutral"] = ["{target} is lovely! Comes to gatherings, laughs at jokes. Very swamp-appropriate behaviour!",
                           "I like {target}! I get the sense they like me too, but they're a little hard to read. Which I find fascinating!"],
        },
        [Guarded] = new()
        {
            ["cold"]    = ["I'm choosing grace over this conversation right now.", "Mmm. Fascinating. Goodbye."],
            ["neutral"] = ["Sure, absolutely, talk later!", "Yes yes of course, carry on!"],
        },
        [ExecutePlea] = new()
        {
            ["neutral"] = ["DARLINGS! You're about to execute the MOST socially active gator in this whole swamp! I BUILT this community! PLEASE!",
                           "I have given this neighbourhood parties, gatherings, gossip, and JOY! Would a MURDERER do that?! THINK ABOUT IT!"],
        },
        [ExecuteReact] = new()
        {
            ["neutral"] = ["I'll host a vigil tonight regardless. This community needs to come together.",
                           "I hope they forgive us if we were wrong. I'll carry that either way."],
        },
        [VoteAnnounce] = new()
        {
            ["neutral"] = ["Dramatically, with great sorrow, and based on EXTENSIVE socialising — I vote {suspect}!",
                           "I vote for {suspect}! I've thought about nothing else and I won't pretend otherwise!"],
        },
        [Persuade] = new()
        {
            ["neutral"] = ["Honey I have TALKED to everyone and the consensus is moving toward {suspect}! Join us!",
                           "I'm asking as someone who has read this room all week — {suspect} is the one! Trust the extrovert on this!"],
        },
    };
}
