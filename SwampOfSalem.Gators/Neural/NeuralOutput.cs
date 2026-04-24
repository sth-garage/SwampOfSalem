using SwampOfSalem.Shared.Enums;
using SwampOfSalem.Shared.Models;

namespace SwampOfSalem.Gators.Neural;

/// <summary>
/// Decodes the raw float[48] output vector from <see cref="GatorNeuralNet"/>
/// into a typed <see cref="NeuralOutputData"/> struct, and applies it to the
/// live <see cref="Alligator"/> model as soft, bounded nudges.
/// <para>
/// <b>Output vector layout (48 floats, all in [0, 1] from sigmoid):</b>
/// <code>
///  [0–4]   Suspicion adjustments for top-5 suspects.
///           0.5 = no change, &gt;0.5 = raise suspicion, &lt;0.5 = lower it.
///           Delta = (value - 0.5) * MAX_SUSP_DELTA (±8 per tick)
///  [5–39]  Mood tendency weights (35 values, one per Mood enum value in order).
///           The index with the highest weight &gt; MOOD_THRESHOLD (0.60) wins.
///           Values below threshold are ignored; Normal mood is applied on tie.
///  [40]    Social desire nudge.
///           0.5 = no change, &gt;0.5 = raise SocialNeed, &lt;0.5 = lower it.
///           Delta = (value - 0.5) * MAX_SOCIAL_DELTA (±5 per tick)
///  [41–45] Trust adjustment for top-5 relation partners.
///           Same delta logic as suspicion.
///  [46]    Outbound signal strength — how strongly to broadcast to other gators (0–1).
///  [47]    Outbound signal focus — which gator to target (value * N → gator index).
/// </code>
/// </para>
/// </summary>
public static class NeuralOutput
{
    // ── Constants ─────────────────────────────────────────────────────────────

    /// <summary>Maximum suspicion change per inference tick (±).</summary>
    public const float MaxSuspDelta = 8f;

    /// <summary>Maximum relation (trust) change per inference tick (±).</summary>
    public const float MaxRelDelta = 4f;

    /// <summary>Maximum social need change per inference tick (±).</summary>
    public const float MaxSocialDelta = 5f;

    /// <summary>Minimum output weight for a mood to be applied.</summary>
    public const float MoodThreshold = 0.60f;

    private static readonly Mood[] _moods = (Mood[])Enum.GetValues(typeof(Mood));

    // ── Decode ────────────────────────────────────────────────────────────────

    /// <summary>
    /// Converts the raw sigmoid output vector into a <see cref="NeuralOutputData"/> struct.
    /// Does NOT mutate any game state — call <see cref="Apply"/> for that.
    /// </summary>
    public static NeuralOutputData Decode(
        float[] raw,
        Alligator gator,
        GameState gameState)
    {
        if (raw.Length != GatorNeuralNet.OutputDim)
            throw new ArgumentException($"Expected {GatorNeuralNet.OutputDim} outputs, got {raw.Length}.");

        var living = gameState.Alligators
            .Where(a => a.IsAlive && a.Id != gator.Id)
            .ToList();

        // ── Suspicion adjustments [0–4] ───────────────────────────────────
        var topSuspects = gator.Suspicion
            .Where(kv => gameState.Alligators.Any(a => a.Id == kv.Key && a.IsAlive))
            .OrderByDescending(kv => kv.Value)
            .Take(5)
            .Select(kv => kv.Key)
            .ToList();

        var suspicionDeltas = new Dictionary<int, float>();
        for (int i = 0; i < 5 && i < topSuspects.Count; i++)
            suspicionDeltas[topSuspects[i]] = (raw[i] - 0.5f) * 2f * MaxSuspDelta;

        // ── Mood tendency [5–39] ──────────────────────────────────────────
        int moodCount = Math.Min(35, _moods.Length);
        Mood suggestedMood = Mood.Normal;
        float bestWeight   = MoodThreshold;
        for (int i = 0; i < moodCount; i++)
        {
            if (raw[5 + i] > bestWeight)
            {
                bestWeight   = raw[5 + i];
                suggestedMood = _moods[i];
            }
        }

        // ── Social need nudge [40] ────────────────────────────────────────
        float socialDelta = (raw[40] - 0.5f) * 2f * MaxSocialDelta;

        // ── Relation (trust) adjustments [41–45] ─────────────────────────
        var topRelationPartners = gator.Relations
            .Where(kv => gameState.Alligators.Any(a => a.Id == kv.Key && a.IsAlive))
            .OrderByDescending(kv => Math.Abs(kv.Value))
            .Take(5)
            .Select(kv => kv.Key)
            .ToList();

        var relationDeltas = new Dictionary<int, float>();
        for (int i = 0; i < 5 && i < topRelationPartners.Count; i++)
            relationDeltas[topRelationPartners[i]] = (raw[41 + i] - 0.5f) * 2f * MaxRelDelta;

        // ── Outbound signal [46–47] ───────────────────────────────────────
        float signalStrength = raw[46];
        int   targetIndex    = living.Count > 0
            ? (int)(raw[47] * living.Count) % living.Count
            : -1;
        int   signalTargetId = targetIndex >= 0 ? living[targetIndex].Id : -1;

        return new NeuralOutputData
        {
            SuspicionDeltas  = suspicionDeltas,
            SuggestedMood    = suggestedMood,
            MoodWeight       = bestWeight,
            SocialNeedDelta  = socialDelta,
            RelationDeltas   = relationDeltas,
            OutboundStrength = signalStrength,
            OutboundTargetId = signalTargetId,
        };
    }

    // ── Apply ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// Applies a decoded output to the live <paramref name="gator"/> model.
    /// All mutations are soft bounded nudges — they cannot override hard rule-based
    /// decisions, they simply shift the continuous scores that drive those decisions.
    /// </summary>
    /// <param name="output">The decoded output from <see cref="Decode"/>.</param>
    /// <param name="gator">The alligator to mutate.</param>
    /// <param name="gameState">Current game state (used for bounds checking).</param>
    public static void Apply(NeuralOutputData output, Alligator gator, GameState gameState)
    {
        // ── Suspicion nudges ──────────────────────────────────────────────
        foreach (var (id, delta) in output.SuspicionDeltas)
        {
            if (!gator.Suspicion.ContainsKey(id))
                gator.Suspicion[id] = 0;
            gator.Suspicion[id] = Math.Clamp(gator.Suspicion[id] + delta, 0, 100);
        }

        // ── Mood suggestion ───────────────────────────────────────────────
        // Only apply if the NN strongly suggests a new mood AND the gator currently
        // has no active mood (or has a weaker one from an earlier day).
        if (output.SuggestedMood != Mood.Normal &&
            (gator.Mood == Mood.Normal || gator.MoodSetDay < gameState.DayNumber))
        {
            gator.Mood       = output.SuggestedMood;
            gator.MoodSetDay = gameState.DayNumber;
        }

        // ── Social need nudge ─────────────────────────────────────────────
        gator.SocialNeed = (int)Math.Clamp(
            gator.SocialNeed + output.SocialNeedDelta, 0, 100);

        // ── Relation nudges ───────────────────────────────────────────────
        foreach (var (id, delta) in output.RelationDeltas)
        {
            if (!gator.Relations.ContainsKey(id))
                gator.Relations[id] = 0;
            gator.Relations[id] = Math.Clamp(gator.Relations[id] + delta, -100, 100);
        }
    }
}

/// <summary>
/// Typed output from <see cref="NeuralOutput.Decode"/>.
/// Carries all values the neural net wants to influence this tick.
/// </summary>
public sealed class NeuralOutputData
{
    /// <summary>Suspicion delta per suspect ID (bounded ±<see cref="NeuralOutput.MaxSuspDelta"/>).</summary>
    public Dictionary<int, float> SuspicionDeltas { get; init; } = [];

    /// <summary>The mood the NN most strongly suggests for this gator, or <see cref="Mood.Normal"/> if no strong signal.</summary>
    public Mood SuggestedMood { get; init; } = Mood.Normal;

    /// <summary>Weight of the winning mood suggestion (0–1). Below <see cref="NeuralOutput.MoodThreshold"/> means no suggestion.</summary>
    public float MoodWeight { get; init; }

    /// <summary>Social-need delta (bounded ±<see cref="NeuralOutput.MaxSocialDelta"/>).</summary>
    public float SocialNeedDelta { get; init; }

    /// <summary>Relation delta per partner ID (bounded ±<see cref="NeuralOutput.MaxRelDelta"/>).</summary>
    public Dictionary<int, float> RelationDeltas { get; init; } = [];

    /// <summary>How strongly this gator wants to broadcast a signal to others (0–1).</summary>
    public float OutboundStrength { get; init; }

    /// <summary>ID of the gator this gator's signal is most directed at, or -1 for broadcast.</summary>
    public int OutboundTargetId { get; init; }
}
