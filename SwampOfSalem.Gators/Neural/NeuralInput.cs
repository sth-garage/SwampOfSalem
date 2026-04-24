using SwampOfSalem.Shared.Enums;
using SwampOfSalem.Shared.Models;

namespace SwampOfSalem.Gators.Neural;

/// <summary>
/// Encodes the current state of an alligator and its environment into a fixed-length
/// float[64] input vector suitable for <see cref="GatorNeuralNet.Infer"/>.
/// <para>
/// <b>Vector layout (64 floats, all normalised to [0, 1]):</b>
/// <code>
///  [0]      Personality one-hot start — index 0 of 6 (Cheerful)
///  [1]      Personality — Grumpy
///  [2]      Personality — Lazy
///  [3]      Personality — Energetic
///  [4]      Personality — Introvert
///  [5]      Personality — Extrovert
///  [6]      IsMurderer flag (0 or 1)
///  [7]      IsLiar flag (0 or 1)
///  [8]      Current Mood normalised (mood index / total moods)
///  [9]      MoodSetDay recency (1 if set today, 0 if stale)
///  [10]     ThoughtStat / 10
///  [11]     SocialStat  / 10
///  [12]     SocialNeed  / 100
///  [13]     Day number normalised (dayNumber / 20)
///  [14]     Alive fraction (alive / total)
///  [15]     Is vote leader (0 or 1)
///  [16–20]  Top-5 suspicion scores (0–100 → 0.0–1.0) sorted descending
///  [21–25]  Relation scores for top-5 others (-100..+100 → 0.0..1.0)
///  [26–30]  Perceived-relation scores for top-5 others
///  [31–35]  Memory type encoding: fraction of recent memories of each major type
///            (conversation, vote, death, debate, other) over last 10 entries
///  [36–43]  Inbound inter-gator signal (8 floats from the signal channel, or zeros)
///  [44]     Economy: money / 200 (clamped)
///  [45]     Economy: apples / 20 (clamped)
///  [46]     Economy: oranges / 20 (clamped)
///  [47]     OrangeLover flag (0 or 1)
///  [48]     Debt / 100 (clamped)
///  [49]     Conviction threshold proximity: max(suspicion) / 100
///  [50]     Murderer's suspicion of this gator (normalised) — how hunted we feel
///  [51]     Phase: 0=Day, 0.5=Debate, 1=Night (Vote = 0.75)
///  [52]     Top suspect alive (1) or dead (0)
///  [53]     Top suspect is a close friend (relation > 50 → 1)
///  [54]     Number of dead / 6
///  [55]     Was voted against this round (0 or 1)
///  [56]     Times been highest-suspicion target this game / 10 (clamped)
///  [57]     Best relation with any living gator (→ 0..1)
///  [58]     Worst relation with any living gator (→ 0..1)
///  [59]     Weighted average suspicion of ALL others (→ 0..1)
///  [60]     Recent memory diversity (unique types / 5)
///  [61]     Ally count (relations > 30) / 5
///  [62]     Enemy count (relations < -30) / 5
///  [63]     Reserved / padding (always 0.5)
/// </code>
/// </para>
/// </summary>
public static class NeuralInput
{
    private static readonly Personality[] _personalities =
        (Personality[])Enum.GetValues(typeof(Personality));

    private static readonly Mood[] _moods =
        (Mood[])Enum.GetValues(typeof(Mood));

    private static readonly GamePhase[] _phases =
        (GamePhase[])Enum.GetValues(typeof(GamePhase));

    /// <summary>
    /// Builds the float[64] input vector for <paramref name="gator"/>.
    /// </summary>
    /// <param name="gator">The alligator being encoded.</param>
    /// <param name="gameState">Current game state snapshot.</param>
    /// <param name="memories">This gator's memory list.</param>
    /// <param name="inboundSignal">
    /// 8-float influence vector received from other gators via the signal channel.
    /// Pass <see langword="null"/> (or empty) if no signal has arrived this tick.
    /// </param>
    public static float[] Encode(
        Alligator gator,
        GameState gameState,
        IReadOnlyList<MemoryEntry> memories,
        float[]? inboundSignal = null)
    {
        var v = new float[GatorNeuralNet.InputDim]; // 64 floats, initialised to 0

        // ── [0–5] Personality one-hot ─────────────────────────────────────
        int pi = Array.IndexOf(_personalities, gator.Personality);
        if (pi >= 0 && pi < 6) v[pi] = 1f;

        // ── [6–7] Role flags ──────────────────────────────────────────────
        v[6] = gator.IsMurderer ? 1f : 0f;
        v[7] = gator.IsLiar     ? 1f : 0f;

        // ── [8–9] Mood ────────────────────────────────────────────────────
        int mi = Array.IndexOf(_moods, gator.Mood);
        v[8] = mi >= 0 ? (float)mi / Math.Max(1, _moods.Length - 1) : 0f;
        v[9] = gator.MoodSetDay == gameState.DayNumber ? 1f : 0f;

        // ── [10–12] Stats ─────────────────────────────────────────────────
        v[10] = Clamp01(gator.ThoughtStat / 10f);
        v[11] = Clamp01(gator.SocialStat  / 10f);
        v[12] = Clamp01(gator.SocialNeed  / 100f);

        // ── [13–15] Game context ──────────────────────────────────────────
        v[13] = Clamp01(gameState.DayNumber / 20f);
        var living = gameState.Alligators.Where(a => a.IsAlive).ToList();
        var dead   = gameState.Alligators.Where(a => !a.IsAlive).ToList();
        v[14] = (float)living.Count / Math.Max(1, gameState.Alligators.Count);

        // Vote leader detection (anyone currently has more votes than us... heuristic)
        int votesAgainst = memories.Count(m =>
            m.Type == "voted_against" && m.Day == gameState.DayNumber);
        bool isVoteLeader = votesAgainst > 0 &&
            living.Max(a => a.Id == gator.Id ? votesAgainst : 0) == votesAgainst;
        v[15] = isVoteLeader ? 1f : 0f;

        // ── [16–20] Top-5 suspicion scores ───────────────────────────────
        var topSuspicions = gator.Suspicion
            .Where(kv => gameState.Alligators.Any(a => a.Id == kv.Key && a.IsAlive))
            .OrderByDescending(kv => kv.Value)
            .Take(5)
            .Select(kv => kv.Value)
            .ToList();
        for (int i = 0; i < 5; i++)
            v[16 + i] = Clamp01(i < topSuspicions.Count ? (float)topSuspicions[i] / 100f : 0f);

        // ── [21–25] Relations for top-5 others ───────────────────────────
        var topRelations = gator.Relations
            .Where(kv => gameState.Alligators.Any(a => a.Id == kv.Key && a.IsAlive))
            .OrderByDescending(kv => Math.Abs(kv.Value))
            .Take(5)
            .Select(kv => (float)kv.Value)
            .ToList();
        for (int i = 0; i < 5; i++)
            v[21 + i] = RelNorm(i < topRelations.Count ? topRelations[i] : 0f);

        // ── [26–30] Perceived relations ───────────────────────────────────
        var topPerceived = gator.PerceivedRelations
            .Where(kv => gameState.Alligators.Any(a => a.Id == kv.Key && a.IsAlive))
            .OrderByDescending(kv => Math.Abs(kv.Value))
            .Take(5)
            .Select(kv => (float)kv.Value)
            .ToList();
        for (int i = 0; i < 5; i++)
            v[26 + i] = RelNorm(i < topPerceived.Count ? topPerceived[i] : 0f);

        // ── [31–35] Memory type fractions (last 10) ───────────────────────
        var recentMem = memories.TakeLast(10).ToList();
        float memTotal = Math.Max(1, recentMem.Count);
        v[31] = recentMem.Count(m => m.Type == "conversation") / memTotal;
        v[32] = recentMem.Count(m => m.Type == "vote")         / memTotal;
        v[33] = recentMem.Count(m => m.Type == "death")        / memTotal;
        v[34] = recentMem.Count(m => m.Type == "debate")       / memTotal;
        v[35] = recentMem.Count(m => m.Type is not ("conversation" or "vote" or "death" or "debate")) / memTotal;

        // ── [36–43] Inbound inter-gator signal ───────────────────────────
        if (inboundSignal is { Length: >= 8 })
            for (int i = 0; i < 8; i++)
                v[36 + i] = Clamp01(inboundSignal[i]);

        // ── [44–48] Economy ───────────────────────────────────────────────
        v[44] = Clamp01(gator.Money   / 200f);
        v[45] = Clamp01(gator.Apples  / 20f);
        v[46] = Clamp01(gator.Oranges / 20f);
        v[47] = gator.OrangeLover ? 1f : 0f;
        v[48] = Clamp01(gator.Debt    / 100f);

        // ── [49–55] Extended game context ─────────────────────────────────
        double maxSusp = gator.Suspicion.Values.DefaultIfEmpty(0).Max();
        v[49] = Clamp01((float)maxSusp / 100f);

        // How much does the murderer suspect this gator?
        var murderer = gameState.MurdererId.HasValue
            ? gameState.Alligators.FirstOrDefault(a => a.Id == gameState.MurdererId.Value)
            : null;
        double murdererSuspOfUs = murderer?.Suspicion.GetValueOrDefault(gator.Id, 0) ?? 0;
        v[50] = Clamp01((float)murdererSuspOfUs / 100f);

        // Phase encoding
        v[51] = gameState.Phase switch
        {
            GamePhase.Day    => 0f,
            GamePhase.Debate => 0.5f,
            GamePhase.Vote   => 0.75f,
            GamePhase.Night  => 1f,
            _                => 0f,
        };

        // Top suspect still alive?
        int? topSuspId = gator.Suspicion
            .Where(kv => gameState.Alligators.Any(a => a.Id == kv.Key && a.IsAlive))
            .OrderByDescending(kv => kv.Value)
            .Select(kv => (int?)kv.Key)
            .FirstOrDefault();
        v[52] = topSuspId.HasValue ? 1f : 0f;

        // Top suspect is a close friend?
        double friendRel = topSuspId.HasValue
            ? gator.Relations.GetValueOrDefault(topSuspId.Value, 0)
            : 0;
        v[53] = friendRel > 50 ? 1f : 0f;

        v[54] = Clamp01((float)dead.Count / 6f);

        // Were we voted against this round?
        v[55] = memories.Any(m => m.Type == "voted_against" && m.Day == gameState.DayNumber)
            ? 1f : 0f;

        // Times been highest-suspicion target across all living gators
        int timesHighest = gameState.Alligators
            .Where(a => a.IsAlive && a.Id != gator.Id)
            .Count(a =>
            {
                var top = a.Suspicion.OrderByDescending(kv => kv.Value).Select(kv => (int?)kv.Key).FirstOrDefault();
                return top == gator.Id;
            });
        v[56] = Clamp01(timesHighest / 10f);

        // ── [57–63] Aggregate social picture ─────────────────────────────
        var livingRelations = gator.Relations
            .Where(kv => gameState.Alligators.Any(a => a.Id == kv.Key && a.IsAlive))
            .Select(kv => (float)kv.Value)
            .ToList();

        v[57] = livingRelations.Any() ? RelNorm(livingRelations.Max()) : 0.5f;
        v[58] = livingRelations.Any() ? RelNorm(livingRelations.Min()) : 0.5f;

        double avgSusp = gator.Suspicion.Values.DefaultIfEmpty(0).Average();
        v[59] = Clamp01((float)avgSusp / 100f);

        int uniqueMemTypes = memories.TakeLast(10).Select(m => m.Type).Distinct().Count();
        v[60] = Clamp01(uniqueMemTypes / 5f);

        v[61] = Clamp01(livingRelations.Count(r => r > 30)   / 5f);
        v[62] = Clamp01(livingRelations.Count(r => r < -30)  / 5f);

        v[63] = 0.5f; // reserved

        return v;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static float Clamp01(float x) => Math.Clamp(x, 0f, 1f);

    /// <summary>Maps a relation value from [-100, +100] to [0, 1].</summary>
    private static float RelNorm(float rel) => (rel + 100f) / 200f;
}
