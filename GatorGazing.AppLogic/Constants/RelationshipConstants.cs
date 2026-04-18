namespace GatorGazing.AppLogic.Constants;

/// <summary>
/// Relationship system constants — compatibility, liar chance.
/// </summary>
public static class RelationshipConstants
{
    public static readonly Dictionary<string, double> LiarChance = new()
    {
        ["cheerful"] = 0.10, ["grumpy"] = 0.05, ["lazy"] = 0.12,
        ["energetic"] = 0.08, ["introvert"] = 0.06, ["extrovert"] = 0.25
    };

    public static readonly Dictionary<string, Dictionary<string, int>> Compat = new()
    {
        ["cheerful"] = new() { ["cheerful"] = 8, ["grumpy"] = -6, ["lazy"] = 2, ["energetic"] = 5, ["introvert"] = 0, ["extrovert"] = 9 },
        ["grumpy"] = new() { ["cheerful"] = -6, ["grumpy"] = 4, ["lazy"] = 0, ["energetic"] = -8, ["introvert"] = 3, ["extrovert"] = -7 },
        ["lazy"] = new() { ["cheerful"] = 2, ["grumpy"] = 0, ["lazy"] = 6, ["energetic"] = -5, ["introvert"] = 4, ["extrovert"] = 0 },
        ["energetic"] = new() { ["cheerful"] = 5, ["grumpy"] = -8, ["lazy"] = -5, ["energetic"] = 9, ["introvert"] = -3, ["extrovert"] = 7 },
        ["introvert"] = new() { ["cheerful"] = 0, ["grumpy"] = 3, ["lazy"] = 4, ["energetic"] = -3, ["introvert"] = 8, ["extrovert"] = -5 },
        ["extrovert"] = new() { ["cheerful"] = 9, ["grumpy"] = -7, ["lazy"] = 0, ["energetic"] = 7, ["introvert"] = -5, ["extrovert"] = 8 }
    };
}
