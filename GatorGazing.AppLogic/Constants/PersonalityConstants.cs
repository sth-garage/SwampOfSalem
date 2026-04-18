namespace GatorGazing.AppLogic.Constants;

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
        ["eating"] = "\U0001F356", ["sleeping"] = "\U0001F4A4",
        ["moving"] = "\U0001F40A", ["talking"] = "\U0001F4AC",
        ["hosting"] = "\U0001FAB7", ["visiting"] = "\U0001F40A",
        ["debating"] = "\U0001F5E3\uFE0F", ["shopping"] = "\U0001F3A3"
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
        ["cheerful"] = new() { ["eating"] = 10, ["sleeping"] = 5, ["moving"] = 20, ["talking"] = 55, ["hosting"] = 10, ["shopping"] = 8 },
        ["grumpy"] = new() { ["eating"] = 18, ["sleeping"] = 15, ["moving"] = 27, ["talking"] = 32, ["hosting"] = 8, ["shopping"] = 6 },
        ["lazy"] = new() { ["eating"] = 14, ["sleeping"] = 32, ["moving"] = 6, ["talking"] = 40, ["hosting"] = 8, ["shopping"] = 5 },
        ["energetic"] = new() { ["eating"] = 8, ["sleeping"] = 3, ["moving"] = 35, ["talking"] = 44, ["hosting"] = 10, ["shopping"] = 12 },
        ["introvert"] = new() { ["eating"] = 20, ["sleeping"] = 18, ["moving"] = 22, ["talking"] = 28, ["hosting"] = 12, ["shopping"] = 15 },
        ["extrovert"] = new() { ["eating"] = 8, ["sleeping"] = 5, ["moving"] = 12, ["talking"] = 55, ["hosting"] = 20, ["shopping"] = 10 }
    };

    public static readonly Dictionary<string, int> SocialStart = new()
    {
        ["cheerful"] = 70, ["grumpy"] = 50, ["lazy"] = 60,
        ["energetic"] = 65, ["introvert"] = 85, ["extrovert"] = 55
    };

    public static readonly Dictionary<string, int[]> ActivityTicks = new()
    {
        ["eating"] = [3, 7], ["sleeping"] = [5, 14], ["moving"] = [1, 4],
        ["talking"] = [1, 4], ["hosting"] = [8, 20], ["visiting"] = [8, 20], ["shopping"] = [2, 5]
    };

    public static readonly Dictionary<string, Dictionary<string, int>> MoodMatrix = new()
    {
        ["cheerful"] = new() { ["eating"] = 1, ["sleeping"] = 0, ["moving"] = 1, ["talking"] = 2, ["hosting"] = 2, ["visiting"] = 1, ["shopping"] = 1 },
        ["grumpy"] = new() { ["eating"] = 0, ["sleeping"] = 1, ["moving"] = -1, ["talking"] = -1, ["hosting"] = -1, ["visiting"] = -1, ["shopping"] = -1 },
        ["lazy"] = new() { ["eating"] = 1, ["sleeping"] = 2, ["moving"] = -1, ["talking"] = 0, ["hosting"] = 0, ["visiting"] = 0, ["shopping"] = -1 },
        ["energetic"] = new() { ["eating"] = 0, ["sleeping"] = -2, ["moving"] = 2, ["talking"] = 1, ["hosting"] = 1, ["visiting"] = 1, ["shopping"] = 1 },
        ["introvert"] = new() { ["eating"] = 1, ["sleeping"] = 1, ["moving"] = 0, ["talking"] = -1, ["hosting"] = 0, ["visiting"] = -2, ["shopping"] = 2 },
        ["extrovert"] = new() { ["eating"] = 0, ["sleeping"] = -1, ["moving"] = 0, ["talking"] = 2, ["hosting"] = 3, ["visiting"] = 2, ["shopping"] = 1 }
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
