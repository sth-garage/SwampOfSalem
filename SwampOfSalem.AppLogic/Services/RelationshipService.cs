using SwampOfSalem.Shared.Enums;
using SwampOfSalem.Shared.Models;

namespace SwampOfSalem.AppLogic.Services;

/// <summary>
/// Manages relationship drift between alligators based on personality compatibility.
/// <para>
/// After each conversation the simulation calls <see cref="DriftRelations"/> to update
/// both alligators' <c>Relations</c> scores. The final delta per call is:
/// <code>
/// delta = GetCompatibility(a.Personality, b.Personality) * 0.5
///       + Random(-6 .. +10)
/// </code>
/// The result is clamped to [-100, +100].
/// </para>
/// <para>
/// Example: Cheerful + Extrovert have a base compat of +9. Scaled to 4.5, plus
/// average random noise of ~+2, means most conversations push these two toward a
/// strong friendship fairly quickly.
/// </para>
/// </summary>
public class RelationshipService
{
    private static readonly Random Rng = new();

    /// <summary>
    /// In-memory compatibility lookup using the strongly-typed <see cref="Personality"/> enum.
    /// Mirrors <c>RelationshipConstants.Compat</c> but avoids string-key lookups server-side.
    /// Asymmetric pairs (A,B) are listed in one direction only; <see cref="GetCompatibility"/>
    /// tries both orderings automatically.
    /// </summary>
    private static readonly Dictionary<(Personality, Personality), double> Compat = new()
    {
        [(Personality.Cheerful,  Personality.Cheerful)]  =  8,
        [(Personality.Cheerful,  Personality.Grumpy)]    = -6,
        [(Personality.Cheerful,  Personality.Lazy)]      =  2,
        [(Personality.Cheerful,  Personality.Energetic)] =  5,
        [(Personality.Cheerful,  Personality.Extrovert)] =  9,
        [(Personality.Grumpy,    Personality.Grumpy)]    =  4,
        [(Personality.Grumpy,    Personality.Energetic)] = -8,
        [(Personality.Grumpy,    Personality.Introvert)] =  3,
        [(Personality.Grumpy,    Personality.Extrovert)] = -7,
        [(Personality.Lazy,      Personality.Lazy)]      =  6,
        [(Personality.Lazy,      Personality.Energetic)] = -5,
        [(Personality.Lazy,      Personality.Introvert)] =  4,
        [(Personality.Energetic, Personality.Energetic)] =  9,
        [(Personality.Energetic, Personality.Introvert)] = -3,
        [(Personality.Energetic, Personality.Extrovert)] =  7,
        [(Personality.Introvert, Personality.Introvert)] =  8,
        [(Personality.Introvert, Personality.Extrovert)] = -5,
        [(Personality.Extrovert, Personality.Extrovert)] =  8,
    };

    /// <summary>
    /// Returns the compatibility score for two personalities.
    /// Tries both (a,b) and (b,a) orderings so callers don't need to sort.
    /// Returns 0 (neutral) if the pair is not in the table.
    /// </summary>
    public double GetCompatibility(Personality a, Personality b)
    {
        if (Compat.TryGetValue((a, b), out var val)) return val;
        if (Compat.TryGetValue((b, a), out val))     return val;
        return 0;
    }

    /// <summary>
    /// Applies a post-conversation relationship drift to both alligators in-place.
    /// The drift is symmetric in its compatibility component but asymmetric in its
    /// random noise, so two gators may feel slightly differently after the same chat.
    /// </summary>
    /// <param name="a">First alligator.</param>
    /// <param name="b">Second alligator.</param>
    public void DriftRelations(Alligator a, Alligator b)
    {
        // Scale compat by 0.5 for a gentle nudge per conversation.
        // Random range: NextDouble() * 16 - 6  =>  [-6, +10]  (mean ≈ +2).
        var compat = GetCompatibility(a.Personality, b.Personality) * 0.5;
        a.Relations[b.Id] = Math.Clamp(
            a.Relations.GetValueOrDefault(b.Id) + compat + (Rng.NextDouble() * 16 - 6), -100, 100);
        b.Relations[a.Id] = Math.Clamp(
            b.Relations.GetValueOrDefault(a.Id) + compat + (Rng.NextDouble() * 16 - 6), -100, 100);
    }
}
