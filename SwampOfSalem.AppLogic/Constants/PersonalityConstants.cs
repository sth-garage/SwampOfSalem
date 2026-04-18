namespace SwampOfSalem.AppLogic.Constants;

/// <summary>
/// Personality-driven stats, weights, emoji, and behavior tuning.
/// </summary>
public static class PersonalityConstants
{
    public static readonly string[] Personalities = ["cheerful", "grumpy", "lazy", "energetic", "introvert", "extrovert"];

    public static readonly Dictionary<string, string> PersonalityEmoji = new()
    {
        ["cheerful"] = "\U0001F60A", ["grumpy"] = "\U0001F620", ["lazy"] = "\U0001F634",
        ["energetic"] = "\u26A1", ["introvert"] = "\U0001F92B", ["extrovert"] = "\U0001F389"
    };

    public static readonly Dictionary<string, string> ActivityEmoji = new()
    {
        ["moving"] = "\U0001F40A", ["talking"] = "\U0001F4AC",
        ["hosting"] = "\U0001FAB7", ["visiting"] = "\U0001F40A",
        ["debating"] = "\U0001F5E3\uFE0F"
    };

    public static readonly Dictionary<string, int> ThoughtStatBase = new()
    {
        ["cheerful"] = 4, ["grumpy"] = 7, ["lazy"] = 3,
        ["energetic"] = 5, ["introvert"] = 9, ["extrovert"] = 3
    };

    public static readonly Dictionary<string, int> SocialStatBase = new()
    {
        ["cheerful"] = 7, ["grumpy"] = 3, ["lazy"] = 4,
        ["energetic"] = 6, ["introvert"] = 2, ["extrovert"] = 10
    };

    public static readonly Dictionary<string, Dictionary<string, int>> ActivityWeights = new()
    {
        ["cheerful"] = new() { ["moving"] = 25, ["talking"] = 60, ["hosting"] = 15 },
        ["grumpy"] = new() { ["moving"] = 40, ["talking"] = 45, ["hosting"] = 15 },
        ["lazy"] = new() { ["moving"] = 20, ["talking"] = 60, ["hosting"] = 20 },
        ["energetic"] = new() { ["moving"] = 45, ["talking"] = 45, ["hosting"] = 10 },
        ["introvert"] = new() { ["moving"] = 50, ["talking"] = 35, ["hosting"] = 15 },
        ["extrovert"] = new() { ["moving"] = 15, ["talking"] = 65, ["hosting"] = 20 }
    };

    public static readonly Dictionary<string, int> SocialStart = new()
    {
        ["cheerful"] = 70, ["grumpy"] = 50, ["lazy"] = 60,
        ["energetic"] = 65, ["introvert"] = 85, ["extrovert"] = 55
    };

    public static readonly Dictionary<string, int[]> ActivityTicks = new()
    {
        ["moving"] = [1, 4],
        ["talking"] = [1, 4], ["hosting"] = [8, 20], ["visiting"] = [8, 20]
    };

    public static readonly Dictionary<string, Dictionary<string, int>> MoodMatrix = new()
    {
        ["cheerful"] = new() { ["moving"] = 1, ["talking"] = 2, ["hosting"] = 2, ["visiting"] = 1 },
        ["grumpy"] = new() { ["moving"] = -1, ["talking"] = -1, ["hosting"] = -1, ["visiting"] = -1 },
        ["lazy"] = new() { ["moving"] = -1, ["talking"] = 0, ["hosting"] = 0, ["visiting"] = 0 },
        ["energetic"] = new() { ["moving"] = 2, ["talking"] = 1, ["hosting"] = 1, ["visiting"] = 1 },
        ["introvert"] = new() { ["moving"] = 0, ["talking"] = -1, ["hosting"] = 0, ["visiting"] = -2 },
        ["extrovert"] = new() { ["moving"] = 0, ["talking"] = 2, ["hosting"] = 3, ["visiting"] = 2 }
    };

    public static readonly Dictionary<string, double> WalkSpeed = new()
    {
        ["cheerful"] = 0.35, ["grumpy"] = 0.275, ["lazy"] = 0.165,
        ["energetic"] = 0.60, ["introvert"] = 0.25, ["extrovert"] = 0.425
    };

    public static readonly Dictionary<string, double> OrangeLoverChance = new()
    {
        ["cheerful"] = 0.12, ["grumpy"] = 0.22, ["lazy"] = 0.35,
        ["energetic"] = 0.15, ["introvert"] = 0.45, ["extrovert"] = 0.10
    };

    public static readonly Dictionary<string, double> MemoryStrength = new()
    {
        ["energetic"] = 0.9, ["introvert"] = 0.9, ["grumpy"] = 0.8,
        ["cheerful"] = 0.7, ["extrovert"] = 0.6, ["lazy"] = 0.2
    };
}
