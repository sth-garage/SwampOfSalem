using SwampOfSalem.Shared.Enums;
using SwampOfSalem.Shared.Models;
using SwampOfSalem.Gators.Phrases;

namespace SwampOfSalem.Gators.Thinking;

/// <summary>
/// Decides which candidate an alligator votes to execute, and generates a spoken
/// reason for their vote. Applies personality-specific biases on top of the
/// base suspicion + relation score.
/// </summary>
public static class VoteDecider
{
    /// <summary>
    /// Returns the ID of the candidate to vote for and a short spoken reason.
    /// </summary>
    public static (int VoteForId, string Reason) Decide(
        Alligator voter,
        List<int> candidateIds,
        GameState gameState,
        List<MemoryEntry> memories,
        Random rng)
    {
        if (candidateIds.Count == 0)
            throw new ArgumentException("No candidates to vote for.");

        var candidates = candidateIds
            .Select(id => gameState.Alligators.FirstOrDefault(a => a.Id == id))
            .Where(a => a is not null)
            .Cast<Alligator>()
            .ToList();

        if (candidates.Count == 1)
            return (candidates[0].Id, BuildReason(voter, candidates[0], gameState, rng));

        // Murderer self-preservation: never vote for themselves, frame the decoy
        if (voter.IsMurderer)
            return MurdererVote(voter, candidates, gameState, rng);

        // Score each candidate
        var scored = candidates
            .Select(c => (Candidate: c, Score: ComputeScore(voter, c, gameState)))
            .OrderByDescending(x => x.Score)
            .ToList();

        // Personality-specific tiebreaker
        var top = scored[0];
        var reason = BuildReason(voter, top.Candidate, gameState, rng);
        return (top.Candidate.Id, reason);
    }

    // ── Scoring ──────────────────────────────────────────────────────────────

    private static double ComputeScore(Alligator voter, Alligator candidate, GameState gameState)
    {
        double score = voter.Suspicion.GetValueOrDefault(candidate.Id, 0);

        // Negative relationship increases willingness to vote them out
        double relation = voter.Relations.GetValueOrDefault(candidate.Id, 0);
        score -= relation * 0.3;

        // Personality modifiers
        switch (voter.Personality)
        {
            case Personality.Grumpy:
                // Grumpy gators are conviction-heavy: suspicion matters more
                score *= 1.2;
                break;
            case Personality.Cheerful:
                // Cheerful gators give benefit of the doubt to friends
                if (relation > 40) score *= 0.6;
                break;
            case Personality.Energetic:
                // Energetic gators follow the crowd — boost score for whoever has highest existing vote count
                // (approximated by having the most memories talking about that candidate as suspect)
                break;
            case Personality.Lazy:
                // Lazy gators add some randomness — they may not have been paying attention
                // (randomness is applied at vote selection time where rng is available)
                break;
            case Personality.Introvert:
                // Introspective: highest analytical weight on suspicion
                score *= 1.3;
                break;
            case Personality.Extrovert:
                // Extroverts use relationship warmth; they rarely vote for friends
                if (relation > 50) score *= 0.5;
                break;
        }

        return score;
    }

    private static (int VoteForId, string Reason) MurdererVote(
        Alligator murderer,
        List<Alligator> candidates,
        GameState gameState,
        Random rng)
    {
        // Vote for whoever suspects the murderer most (to eliminate the threat)
        // But expressed as: "I think [decoy] did it"
        var target = candidates
            .Select(c => (Candidate: c, ThreatenScore: c.Suspicion.GetValueOrDefault(murderer.Id, 0)))
            .OrderByDescending(x => x.ThreatenScore)
            .ThenBy(x => murderer.Relations.GetValueOrDefault(x.Candidate.Id, 0))
            .First()
            .Candidate;

        var bluffPhrases = MurdererPhrases.FalseAccusation[murderer.Personality];
        var raw = ThoughtEngine.Pick(bluffPhrases, rng);
        var reason = ThoughtEngine.Substitute(raw, murderer.Name, target.Name, null, null, target.Name);
        return (target.Id, reason);
    }

    // ── Reason generation ────────────────────────────────────────────────────

    private static readonly Dictionary<Personality, string[]> _voteReasons = new()
    {
        [Personality.Cheerful] =
        [
            "With a heavy heart I vote for {target} — the clues keep pointing back to them. 😞",
            "I'm so sorry {target} but I have to vote for you. I hope I'm wrong!",
            "My gut says {target} and I have to trust it. Please understand!",
        ],
        [Personality.Grumpy] =
        [
            "My vote is {target}. I've done the analysis. The numbers hold.",
            "{target}. Three inconsistencies, two suspicious behaviours, one vote. Easy math.",
            "Voting {target}. I don't do this lightly. But I'm confident.",
        ],
        [Personality.Lazy] =
        [
            "{target}. My vote. Done.",
            "I vote {target}. Not changing it. That's all.",
            "{target}. I've been thinking about it all day. Surprisingly.",
        ],
        [Personality.Energetic] =
        [
            "MY VOTE IS {target}!! I have been SCREAMING this all day!! FINALLY!!",
            "VOTING {target}!! The evidence is RIGHT THERE!! Let's end this!!",
            "I VOTE {target}!! Ask me why!! I will TELL you why for TWENTY MINUTES!!",
        ],
        [Personality.Introvert] =
        [
            "I vote {target}. I've prepared a full reasoning. Three points. Ask me if you want them.",
            "My vote: {target}. The pattern of observed behaviour supports no other conclusion.",
            "{target}. I've been quiet for a reason. I was collecting enough certainty to say this.",
        ],
        [Personality.Extrovert] =
        [
            "DRAMATICALLY and with full conviction — I vote {target}! The energy never lied!",
            "I vote {target}! I've been reading this room all week and this is my read!",
            "With deep feeling and extensive social evidence — {target}! I am staking my reputation!",
        ],
    };

    private static string BuildReason(Alligator voter, Alligator candidate, GameState gameState, Random rng)
    {
        var arr = _voteReasons.GetValueOrDefault(voter.Personality,
            ["{target}. That's my vote."]);
        var raw = ThoughtEngine.Pick(arr, rng);
        return ThoughtEngine.Substitute(raw, voter.Name, candidate.Name, candidate.Name, null, candidate.Name);
    }
}
