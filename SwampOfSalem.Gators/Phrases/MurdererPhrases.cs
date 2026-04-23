using SwampOfSalem.Shared.Enums;

namespace SwampOfSalem.Gators.Phrases;

/// <summary>
/// Phrase banks exclusively for the murderer role.
/// The murderer uses these for bluffing, debate deflection, strategic accusation,
/// and night-kill target selection reasoning.
/// Tokens: {name}, {target}, {victim}, {suspect}, {decoy} (false scapegoat name).
/// </summary>
public static class MurdererPhrases
{
    // ── Casual bluff during day conversations ────────────────────────────────
    public static readonly Dictionary<Personality, string[]> DayBluff = new()
    {
        [Personality.Cheerful] =
        [
            "I've been so anxious about all this — I barely slept! I just want everyone to be safe! 😟",
            "I keep asking myself who could do something like this... it makes me so sad.",
            "I'm going to try even harder to be there for everyone while we get through this together! 💕",
            "I gave {target} some oranges earlier to cheer them up. We have to look out for each other!",
        ],
        [Personality.Grumpy] =
        [
            "I've been watching everyone. More than usual. Someone here is making very suspicious moves.",
            "I'm keeping my head down and my eyes open. That's how you survive in this swamp.",
            "I'm not pointing claws yet, but I have a list. And {decoy} is at the top of it.",
            "The killer is smart. I respect that, actually. But not smart enough.",
        ],
        [Personality.Lazy] =
        [
            "I've just been staying inside mostly. Watching. Not doing much.",
            "Hard to suspect me of anything when I barely leave the house, right?",
            "I think {decoy} has been acting strange. Just saying. I noticed.",
        ],
        [Personality.Energetic] =
        [
            "I'VE BEEN ALL OVER THE SWAMP today and I haven't seen anything suspicious — except maybe {decoy}!",
            "I'm doing my part!! Running patrols, checking on neighbours! Innocent gators do THIS!!",
            "I want to CATCH THIS KILLER as much as anyone!! Maybe more!!",
        ],
        [Personality.Introvert] =
        [
            "I've been watching. I have notes. Several things about {decoy} concern me.",
            "I prefer not to speculate aloud, but I've been constructing a timeline in my head.",
            "I'll share my observations when I'm ready. Not before.",
        ],
        [Personality.Extrovert] =
        [
            "I've been socialising ALL day — I have the best alibi possible! Ask literally everyone!",
            "If I were the killer I'd be SO much better at acting calm! I'm visibly distraught!",
            "I keep steering conversation toward {decoy} because honestly? The vibes are BAD there.",
        ],
    };

    // ── Debate deflection ────────────────────────────────────────────────────
    public static readonly Dictionary<Personality, string[]> DebateDeflect = new()
    {
        [Personality.Cheerful] =
        [
            "I really think we're overlooking {decoy} here — they've been very quiet and that worries me! 😟",
            "I don't want to make things worse but {decoy} said something really strange to me earlier...",
            "Can we please talk about {decoy}? I know everyone is focused elsewhere but my gut is telling me something!",
        ],
        [Personality.Grumpy] =
        [
            "{decoy}. That's my answer. While everyone has been looking at me, {decoy} has been coasting.",
            "I'm not defending myself. I'm redirecting to the actual suspect: {decoy}.",
            "I've been calling out {decoy} all along. The evidence is right there if anyone would look.",
        ],
        [Personality.Lazy] =
        [
            "I don't know, I feel like {decoy} is the obvious pick and everyone's overthinking it.",
            "{decoy}. Can we move on.",
            "I'm not saying much but I will say: look at {decoy}.",
        ],
        [Personality.Energetic] =
        [
            "STOP LOOKING AT ME AND LOOK AT {decoy}!! I'VE BEEN SAYING THIS!!",
            "We're going in circles!! {decoy} is RIGHT THERE and nobody is talking about them!!",
            "{decoy}!! The answer is {decoy}!! Why is nobody listening to me!!",
        ],
        [Personality.Introvert] =
        [
            "I have three specific observations about {decoy} that I haven't shared yet. Now seems like the time.",
            "While this focus on me is understandable, it is misdirected. {decoy} is the more consistent suspect.",
            "The pattern of behaviour that matches the crime traces back to {decoy}, not me.",
        ],
        [Personality.Extrovert] =
        [
            "DARLINGS I have been watching {decoy} ALL WEEK and the energy is WRONG!! Look at THEM!!",
            "I'm the most transparent gator here! Meanwhile {decoy} has been suspiciously quiet! Suspicious!!",
            "I host parties. I read people. {decoy} is off. Take it from the extrovert who knows EVERYONE!",
        ],
    };

    // ── After a kill — dawn reaction (secretly satisfied / calculating) ───────
    public static readonly Dictionary<Personality, string[]> DawnAfterKill = new()
    {
        [Personality.Cheerful] =
        [
            "I feel terrible about {victim}. I really do. I'm going to focus all my energy on making sure we find the killer. 😢",
            "This is so awful. I keep telling myself that every day we get closer to figuring this out.",
        ],
        [Personality.Grumpy] =
        [
            "{victim} was getting too close to the truth. Not that I'll say that out loud.",
            "One less voice pointing in my direction. The game continues.",
        ],
        [Personality.Lazy] =
        [
            "Well. That worked. Now I just have to keep not doing anything suspicious.",
            "Phase two. Stay calm. Stay lazy. Nobody suspects lazy.",
        ],
        [Personality.Energetic] =
        [
            "ALRIGHT let's channel this energy into MOURNING and also NOT GETTING CAUGHT!",
            "I've been up all night!! For totally legitimate reasons!! Moving on!!",
        ],
        [Personality.Introvert] =
        [
            "The field narrows. I need to adjust my observed-behaviour projections accordingly.",
            "One less variable. The remaining suspects will now recalibrate. I need to anticipate that.",
        ],
        [Personality.Extrovert] =
        [
            "I put on the best grief performance of my life this morning. I should be very proud.",
            "I hosted a late-night gathering as cover. It went beautifully. Nobody suspects the host.",
        ],
    };

    // ── Strategic false accusation ────────────────────────────────────────────
    public static readonly Dictionary<Personality, string[]> FalseAccusation = new()
    {
        [Personality.Cheerful] =
        [
            "I hate being the one to say this but I've been keeping track and... I think it's {decoy}. I'm so sorry {decoy}! 😭",
            "I've given this so much thought and my heart says {decoy}. The inconsistencies in their story... I just can't ignore them anymore.",
        ],
        [Personality.Grumpy] =
        [
            "{decoy}. I've known it for a while. Every suspicious data point traces back to them. Vote accordingly.",
            "I'm done being subtle. It's {decoy}. I have reasons. You want them, ask.",
        ],
        [Personality.Lazy] =
        [
            "I think it's {decoy}. That's my vote. I'll explain if pressed.",
            "{decoy}. Something's off. Just a feeling.",
        ],
        [Personality.Energetic] =
        [
            "{decoy}!! I have BEEN SAYING THIS!! Everything leads back to {decoy}!! LISTEN!!",
            "My vote is {decoy} and I will NOT be moved!! The CLUES are RIGHT THERE!!",
        ],
        [Personality.Introvert] =
        [
            "I've prepared my case. The suspect is {decoy}. Three specific behavioural inconsistencies over two days.",
            "I don't present conclusions without evidence. {decoy} is my conclusion.",
        ],
        [Personality.Extrovert] =
        [
            "GATHERING EVERYONE!! My social read, my conversation records, my intuition — {decoy}! IT'S {decoy}!",
            "I've spoken to literally everyone and {decoy} keeps coming up as OFF! Trust the extrovert!",
        ],
    };

    // ── Target selection reasoning (internal thought — not spoken) ────────────
    public static readonly string[] TargetSelectionThought =
    [
        "{target} suspects me too strongly. They need to go before the vote.",
        "{target} has been watching me carefully. I need to remove that variable.",
        "{target} is too smart and too observant. I can't afford to let them reach the vote.",
        "{target} openly accused me today. That cannot stand.",
        "{target} is a trusted voice here. Removing them will cause maximum confusion.",
        "If I take out {target} the others will panic and turn on each other. Classic distraction.",
    ];
}
