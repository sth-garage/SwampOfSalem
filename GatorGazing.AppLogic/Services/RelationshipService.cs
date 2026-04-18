using GatorGazing.Shared.Enums;
using GatorGazing.Shared.Models;

namespace GatorGazing.AppLogic.Services;

/// <summary>
/// Manages relationship drift based on personality compatibility.
/// </summary>
public class RelationshipService
{
    private static readonly Random Rng = new();

    private static readonly Dictionary<(Personality, Personality), double> Compat = new()
    {
        [(Personality.Cheerful, Personality.Cheerful)] = 8,
        [(Personality.Cheerful, Personality.Grumpy)] = -6,
        [(Personality.Cheerful, Personality.Lazy)] = 2,
        [(Personality.Cheerful, Personality.Energetic)] = 5,
        [(Personality.Cheerful, Personality.Extrovert)] = 9,
        [(Personality.Grumpy, Personality.Grumpy)] = 4,
        [(Personality.Grumpy, Personality.Energetic)] = -8,
        [(Personality.Grumpy, Personality.Introvert)] = 3,
        [(Personality.Grumpy, Personality.Extrovert)] = -7,
        [(Personality.Lazy, Personality.Lazy)] = 6,
        [(Personality.Lazy, Personality.Energetic)] = -5,
        [(Personality.Lazy, Personality.Introvert)] = 4,
        [(Personality.Energetic, Personality.Energetic)] = 9,
        [(Personality.Energetic, Personality.Introvert)] = -3,
        [(Personality.Energetic, Personality.Extrovert)] = 7,
        [(Personality.Introvert, Personality.Introvert)] = 8,
        [(Personality.Introvert, Personality.Extrovert)] = -5,
        [(Personality.Extrovert, Personality.Extrovert)] = 8,
    };

    public double GetCompatibility(Personality a, Personality b)
    {
        if (Compat.TryGetValue((a, b), out var val)) return val;
        if (Compat.TryGetValue((b, a), out val)) return val;
        return 0;
    }

    public void DriftRelations(Alligator a, Alligator b)
    {
        var compat = GetCompatibility(a.Personality, b.Personality) * 0.5;
        a.Relations[b.Id] = Math.Clamp(a.Relations.GetValueOrDefault(b.Id) + compat + (Rng.NextDouble() * 16 - 6), -100, 100);
        b.Relations[a.Id] = Math.Clamp(b.Relations.GetValueOrDefault(a.Id) + compat + (Rng.NextDouble() * 16 - 6), -100, 100);
    }
}
