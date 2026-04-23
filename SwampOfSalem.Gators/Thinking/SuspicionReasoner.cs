using SwampOfSalem.Shared.Enums;
using SwampOfSalem.Shared.Models;
using SwampOfSalem.Gators.Phrases;

namespace SwampOfSalem.Gators.Thinking;

/// <summary>
/// Determines which alligator a given gator suspects most of being the murderer
/// and generates a human-readable reason grounded in memories and suspicion scores.
/// </summary>
public static class SuspicionReasoner
{
    private static readonly Dictionary<Personality, string[]> _reasonTemplates = new()
    {
        [Personality.Cheerful] =
        [
            "Something about the way {suspect} acted around {victim} just didn't feel right to me.",
            "I hate saying this but {suspect} was really weird during the debate — not in a scared way, in a hiding-something way.",
            "I saw {suspect} near the south bank the night {victim} was killed. I couldn't sleep.",
            "{suspect} barely reacted when we found {victim}. That stuck with me all day.",
            "My gut is usually right about people and my gut says {suspect} is lying about where they were.",
        ],
        [Personality.Grumpy] =
        [
            "{suspect}'s alibi doesn't hold up. I fact-checked it and there are gaps.",
            "I've been cataloguing inconsistencies and {suspect} has the most of anyone here.",
            "{suspect} was near the crime area. I clocked it. Twice.",
            "Every time someone asks {suspect} a direct question, they redirect. I'm done ignoring it.",
            "{suspect} reacted to {victim}'s death with fear. Guilty people are afraid of being caught.",
        ],
        [Personality.Lazy] =
        [
            "I wasn't paying much attention but even I noticed {suspect} acting weird around {victim}.",
            "{suspect} has been too quiet. Even by my standards.",
            "I saw {suspect} out at a weird hour. I went back to sleep but I remembered it.",
            "Just a gut feeling. {suspect}. That's my answer.",
            "{suspect} said something that didn't add up. I wrote it off at the time but now I'm not so sure.",
        ],
        [Personality.Energetic] =
        [
            "I RAN PAST THE SOUTH BANK that night and I SAW {suspect} there!! I didn't think anything of it then!!",
            "{suspect} kept changing their story EVERY TIME I brought it up!! That is NOT OKAY!!",
            "I've been running around all day asking questions and {suspect}'s name keeps coming up!!",
            "{suspect} was NOT where they claimed to be!! I KNOW because I WAS THERE!!",
            "I just have a feeling about {suspect} and my feelings are ALWAYS right!! Ask anyone!!",
        ],
        [Personality.Introvert] =
        [
            "I've logged three behavioural inconsistencies from {suspect} across two days. They form a pattern.",
            "{suspect}'s account of their location on the night of {victim}'s death contradicts two other testimonies.",
            "I've been silently observing. {suspect} checks every box on my mental suspect model.",
            "The micro-expressions and avoidance patterns I observed in {suspect} are consistent with deception.",
            "I noticed {suspect} and {victim} had a tense exchange the day before the murder. Nobody else saw it.",
        ],
        [Personality.Extrovert] =
        [
            "I've spoken to EVERYONE and {suspect} is the only one whose story doesn't fit the social fabric of what happened.",
            "{suspect} came to my gathering and spent the whole time watching instead of socialising. That's not nervousness — that's surveillance.",
            "I read people for a living and {suspect}'s energy has been WRONG since the first night.",
            "{suspect} told me one thing and told {victim} something completely different. I know because I talk to everyone.",
            "Nobody gave me worse vibes at the debate than {suspect}. And I pay attention to vibes professionally.",
        ],
    };

    private static readonly string[] _innocentTemplates =
    [
        "I'm not sure yet. Nobody has stood out as definitively suspicious to me.",
        "I need more information before I'm willing to make an accusation. I don't want to be wrong.",
        "Honestly every gator here seems a little suspicious right now. I'm still watching.",
        "My instincts haven't fully locked on yet. I'll know more after tonight.",
    ];

    /// <summary>
    /// Returns the ID and a human-readable reason for who <paramref name="gator"/> suspects most.
    /// Returns null ID and a placeholder reason if suspicion scores are all very low.
    /// </summary>
    public static (int? SuspectId, string Reason) Reason(
        Alligator gator,
        GameState gameState,
        List<MemoryEntry> memories,
        Random rng)
    {
        // Murderer lies — they suspect/deflect to their chosen decoy
        if (gator.IsMurderer)
            return ReasonAsMurderer(gator, gameState, memories, rng);

        var livingOthers = gameState.Alligators
            .Where(a => a.IsAlive && a.Id != gator.Id)
            .ToList();

        if (livingOthers.Count == 0)
            return (null, Pick(_innocentTemplates, rng));

        // Pick highest suspicion, breaking ties by relation (more negative = more suspicious)
        var bestSuspect = livingOthers
            .Select(a => new
            {
                Alligator = a,
                Suspicion = gator.Suspicion.GetValueOrDefault(a.Id, 0),
                Relation  = gator.Relations.GetValueOrDefault(a.Id, 0),
            })
            .OrderByDescending(x => x.Suspicion)
            .ThenBy(x => x.Relation)
            .First();

        // If suspicion is negligible, return uncertain response
        if (bestSuspect.Suspicion < 10)
            return (null, Pick(_innocentTemplates, rng));

        string victimName = ResolveVictim(memories, gameState);
        var templates = _reasonTemplates.GetValueOrDefault(gator.Personality, _innocentTemplates);
        string reason = Thinking.ThoughtEngine.Substitute(
            Pick(templates, rng),
            gator.Name,
            bestSuspect.Alligator.Name,
            bestSuspect.Alligator.Name,
            victimName,
            bestSuspect.Alligator.Name);

        return (bestSuspect.Alligator.Id, reason);
    }

    private static (int? SuspectId, string Reason) ReasonAsMurderer(
        Alligator murderer,
        GameState gameState,
        List<MemoryEntry> memories,
        Random rng)
    {
        // The murderer frames whoever suspects them most, or the gator they like least
        var livingOthers = gameState.Alligators
            .Where(a => a.IsAlive && a.Id != murderer.Id)
            .ToList();

        if (livingOthers.Count == 0)
            return (null, Pick(_innocentTemplates, rng));

        // Pick the most useful decoy (the one who suspects the murderer most, or lowest relation)
        var decoy = livingOthers
            .Select(a => new
            {
                Alligator    = a,
                TheyTrustMe  = a.Suspicion.GetValueOrDefault(murderer.Id, 0),
                ILikeThem    = murderer.Relations.GetValueOrDefault(a.Id, 0),
            })
            .OrderByDescending(x => x.TheyTrustMe)
            .ThenBy(x => x.ILikeThem)
            .First();

        string victimName = ResolveVictim(memories, gameState);
        var bluffPhrases = MurdererPhrases.FalseAccusation[murderer.Personality];

        string reason = ThoughtEngine.Substitute(
            Pick(bluffPhrases, rng),
            murderer.Name,
            decoy.Alligator.Name,
            decoy.Alligator.Name,
            victimName,
            decoy.Alligator.Name);

        return (decoy.Alligator.Id, reason);
    }

    private static string ResolveVictim(List<MemoryEntry> memories, GameState gameState)
    {
        // Most recent death memory
        var deathMemory = memories
            .Where(m => m.Type == "death" && m.RelatedAlligatorId.HasValue)
            .LastOrDefault();
        if (deathMemory?.RelatedAlligatorId is int vid)
        {
            var dead = gameState.Alligators.FirstOrDefault(a => a.Id == vid);
            if (dead is not null) return dead.Name;
        }
        return gameState.Alligators.FirstOrDefault(a => !a.IsAlive)?.Name ?? "the victim";
    }

    private static string Pick(string[] arr, Random rng) =>
        arr.Length == 0 ? string.Empty : arr[rng.Next(arr.Length)];
}
