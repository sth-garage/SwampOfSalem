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

        // Persuasion-immune moods lock in top suspicion target regardless of scoring
        if (MoodPhraseBanks.IsPersuasionImmune(voter.Mood))
        {
            var lockedTarget = candidates
                .OrderByDescending(c => voter.Suspicion.GetValueOrDefault(c.Id, 0))
                .First();
            return (lockedTarget.Id, BuildReason(voter, lockedTarget, gameState, rng));
        }

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

        // Mood modifiers (applied before personality)
        score = ApplyMoodScoreModifier(voter, candidate, score);

        // ── Clique modifiers ──────────────────────────────────────────────────

        // Clique loyalty: strongly resist voting for a clique-mate
        if (CliqueService.SameClique(voter, candidate))
            score *= 0.15;

        // Rival clique penalty: more willing to vote out rival clique members
        if (CliqueService.AreRivals(voter, candidate, gameState))
            score += 20;

        // Clique consensus: if most clique-mates also suspect this candidate, amplify
        double consensus = CliqueService.CliqueCandidateConsensus(voter, candidate.Id, gameState);
        if (consensus >= 0.5)
            score += 15 * consensus;

        // ── Fear multiplier: scales with fraction of population dead ─────────

        int totalStarting = gameState.StartingPopulation > 0
            ? gameState.StartingPopulation
            : Math.Max(gameState.Alligators.Count, 1);
        int deathCount = gameState.DeadIds.Count;
        double deathFrac = (double)deathCount / totalStarting;

        // Each 10 % of population dead adds 5 % to suspicion weight (max +50 %)
        double fearMultiplier = 1.0 + Math.Min(deathFrac * 5.0, 0.5);
        score *= fearMultiplier;

        // Personality modifiers
        switch (voter.Personality)
        {
            case Personality.Grumpy:
                score *= 1.2;
                break;
            case Personality.Cheerful:
                if (relation > 40) score *= 0.6;
                break;
            case Personality.Energetic:
                break;
            case Personality.Lazy:
                break;
            case Personality.Introvert:
                score *= 1.3;
                break;
            case Personality.Extrovert:
                if (relation > 50) score *= 0.5;
                break;
        }

        return score;
    }

    private static double ApplyMoodScoreModifier(Alligator voter, Alligator candidate, double score)
    {
        return voter.Mood switch
        {
            // Obsessed / Convinced / LastStand — massively up-weight top-suspicion target
            Mood.Obsessed or Mood.Convinced or Mood.LastStand
                => voter.Suspicion.GetValueOrDefault(candidate.Id, 0) >= 50 ? score * 2.0 : score * 0.4,

            // Doubting — reduce score across the board (uncertain)
            Mood.Doubting => score * 0.6,

            // Sleuthing — weight all candidates more evenly
            Mood.Sleuthing => score * 0.8,

            // Conflicted — halve score for the candidate they're closest to
            Mood.Conflicted
                => voter.Relations.GetValueOrDefault(candidate.Id, 0) >= 50 ? score * 0.3 : score,

            // Betrayed — boost the candidate who voted against them
            Mood.Betrayed => score * 1.4,

            // Bonded — never effectively vote for a max-relation gator
            Mood.Bonded
                => voter.Relations.GetValueOrDefault(candidate.Id, 0) >= 70 ? score * 0.1 : score,

            // Cornered / Desperate — shift weight toward whoever the murderer wants
            // (for non-murderer: boost any non-self candidate)
            Mood.Cornered or Mood.Desperate => score * 1.1,

            // Panicking — voting is erratic: add noise
            Mood.Panicking => score + (candidate.Id % 3) * 5.0,

            // Resigned / CheckedOut — low commitment; slightly reduce all weights
            Mood.Resigned or Mood.CheckedOut => score * 0.7,

            // Ranting — boost whoever they already have highest suspicion on
            Mood.Ranting
                => voter.Suspicion.GetValueOrDefault(candidate.Id, 0) > 40 ? score * 1.5 : score,

            // Murky — flatten scores significantly
            Mood.Murky => score * 0.5,

            // SurvivorsGuilt — boost suspicion weight strongly
            Mood.SurvivorsGuilt => score * 1.3,

            // Doomed (murderer) — chaos; randomise
            Mood.Doomed => score + (candidate.GetHashCode() % 20),

            _ => score,
        };
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
        // Check for mood-specific vote overlay first
        var moodOverlay = MoodPhraseBanks.GetConversation(voter.Mood);
        if (moodOverlay.Length > 0 && rng.Next(3) < 2) // 66 % chance to use mood phrasing
        {
            var moodRaw = ThoughtEngine.Pick(moodOverlay, rng);
            return ThoughtEngine.Substitute(moodRaw, voter.Name, candidate.Name, candidate.Name, null, candidate.Name);
        }

        var arr = _voteReasons.GetValueOrDefault(voter.Personality,
            ["{target}. That's my vote."]);
        var raw = ThoughtEngine.Pick(arr, rng);
        return ThoughtEngine.Substitute(raw, voter.Name, candidate.Name, candidate.Name, null, candidate.Name);
    }
}
