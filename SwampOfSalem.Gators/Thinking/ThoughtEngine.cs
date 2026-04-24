using SwampOfSalem.Gators.Phrases;
using SwampOfSalem.Shared.Enums;
using SwampOfSalem.Shared.Models;

namespace SwampOfSalem.Gators.Thinking;

/// <summary>
/// Generates private inner-monologue text for alligators.
/// The thought engine selects from personality-appropriate phrase pools and
/// injects live game state values (relationship scores, suspicion levels,
/// current day, role) to produce contextual inner thoughts.
/// </summary>
public static class ThoughtEngine
{
    /// <summary>
    /// Generates a private inner thought for <paramref name="gator"/>.
    /// Considers their role (murderer / liar / towngator), their strongest
    /// suspicion, and their most significant relationship.
    /// </summary>
    public static string Generate(
        Alligator gator,
        GameState gameState,
        Random rng,
        int? targetId = null)
    {
        // Murderer gets strategic thoughts
        if (gator.IsMurderer)
            return GenerateMurdererThought(gator, gameState, rng, targetId);

        // Mood overlay: use mood-specific thought when available (~50 % chance)
        if (gator.Mood != Mood.Normal)
        {
            var moodPhrases = MoodPhraseBanks.GetThought(gator.Mood);
            if (moodPhrases.Length > 0 && rng.Next(2) == 0)
            {
                string target = ResolveTarget(gator, gameState, targetId);
                string suspect = ResolveSuspect(gator, gameState);
                string victimName = ResolveVictimName(gameState);
                var raw = Pick(moodPhrases, rng);
                return Substitute(raw, gator.Name, target, suspect, victimName, null);
            }
        }

        string targetFinal = ResolveTarget(gator, gameState, targetId);
        string suspectFinal = ResolveSuspect(gator, gameState);
        string tier = ResolveTier(gator, targetId, gameState);

        var phrases = PhraseBanks.Get(gator.Personality, PhraseBanks.Thought, tier);
        var rawLine = Pick(phrases, rng);
        return Substitute(rawLine, gator.Name, targetFinal, suspectFinal, null, null);
    }

    /// <summary>
    /// Generates a dawn-phase inner thought (right after a body is discovered).
    /// </summary>
    public static string GenerateDawn(Alligator gator, GameState gameState, Random rng, string? victimName)
    {
        if (gator.IsMurderer)
        {
            var killPhrases = MurdererPhrases.DawnAfterKill[gator.Personality];
            return Substitute(Pick(killPhrases, rng), gator.Name, null, null, victimName, null);
        }

        // Mood overlay for dawn thoughts
        if (gator.Mood != Mood.Normal)
        {
            var moodPhrases = MoodPhraseBanks.GetThought(gator.Mood);
            if (moodPhrases.Length > 0 && rng.Next(2) == 0)
            {
                var raw = Pick(moodPhrases, rng);
                return Substitute(raw, gator.Name, null, ResolveSuspect(gator, gameState), victimName, null);
            }
        }

        var phrases = PhraseBanks.Get(gator.Personality, PhraseBanks.DawnThought, "neutral");
        return Substitute(Pick(phrases, rng), gator.Name, null, ResolveSuspect(gator, gameState), victimName, null);
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    private static string GenerateMurdererThought(Alligator gator, GameState gameState, Random rng, int? targetId)
    {
        // Build a decoy name (gator the murderer plans to frame)
        string decoy = ResolveDecoy(gator, gameState);
        string target = ResolveTarget(gator, gameState, targetId);
        var raw = Pick(MurdererPhrases.TargetSelectionThought, rng);
        return Substitute(raw, gator.Name, target, null, null, decoy);
    }

    private static string ResolveTarget(Alligator gator, GameState gameState, int? targetId)
    {
        if (targetId.HasValue)
        {
            var t = gameState.Alligators.FirstOrDefault(a => a.Id == targetId.Value);
            if (t is not null) return t.Name;
        }
        // Fall back to the gator's worst-relation living neighbour
        var worst = gator.Relations
            .Where(kv => gameState.Alligators.Any(a => a.Id == kv.Key && a.IsAlive && a.Id != gator.Id))
            .OrderBy(kv => kv.Value)
            .Select(kv => gameState.Alligators.FirstOrDefault(a => a.Id == kv.Key)?.Name)
            .FirstOrDefault();
        return worst ?? "someone";
    }

    private static string ResolveSuspect(Alligator gator, GameState gameState)
    {
        var topSuspect = gator.Suspicion
            .Where(kv => gameState.Alligators.Any(a => a.Id == kv.Key && a.IsAlive))
            .OrderByDescending(kv => kv.Value)
            .Select(kv => gameState.Alligators.FirstOrDefault(a => a.Id == kv.Key)?.Name)
            .FirstOrDefault();
        return topSuspect ?? "someone";
    }

    private static string ResolveDecoy(Alligator murderer, GameState gameState)
    {
        // The murderer frames the gator who suspects them most
        var mostSuspicious = murderer.Suspicion
            .Where(kv => gameState.Alligators.Any(a => a.Id == kv.Key && a.IsAlive))
            .OrderByDescending(kv => kv.Value)
            .Select(kv => gameState.Alligators.FirstOrDefault(a => a.Id == kv.Key)?.Name)
            .FirstOrDefault();
        if (mostSuspicious is not null) return mostSuspicious;

        // Fall back to least-liked living gator
        var leastLiked = murderer.Relations
            .Where(kv => gameState.Alligators.Any(a => a.Id == kv.Key && a.IsAlive && a.Id != murderer.Id))
            .OrderBy(kv => kv.Value)
            .Select(kv => gameState.Alligators.FirstOrDefault(a => a.Id == kv.Key)?.Name)
            .FirstOrDefault();
        return leastLiked ?? "someone";
    }

    private static string ResolveTier(Alligator gator, int? targetId, GameState gameState)
    {
        if (targetId is null) return "neutral";
        double rel = gator.Relations.GetValueOrDefault(targetId.Value, 0);
        return PhraseBanks.RelationTier(rel);
    }

    private static string ResolveVictimName(GameState gameState)
    {
        return gameState.Alligators.FirstOrDefault(a => !a.IsAlive)?.Name ?? "them";
    }

    internal static string Pick(string[] arr, Random rng) =>
        arr.Length == 0 ? string.Empty : arr[rng.Next(arr.Length)];

    internal static string Substitute(
        string template,
        string? name,
        string? target,
        string? suspect,
        string? victim,
        string? decoy)
    {
        return template
            .Replace("{name}",    name    ?? "I")
            .Replace("{target}",  target  ?? "them")
            .Replace("{suspect}", suspect ?? "someone")
            .Replace("{victim}",  victim  ?? "them")
            .Replace("{decoy}",   decoy   ?? "someone");
    }
}
