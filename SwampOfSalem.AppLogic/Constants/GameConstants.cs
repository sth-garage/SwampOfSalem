namespace SwampOfSalem.AppLogic.Constants;

/// <summary>
/// Core game-loop timing, sizing, and phase constants.
/// Single source of truth â€” serialized to JS at startup.
/// </summary>
public static class GameConstants
{
    // Sizing
    public const int GatorSize = 120;
    public const int GatorCount = 7;

    // Conversation limit before nightfall timer
    public const int ConvLimitForNightfall = 7;
    public const int NightfallDelayMs = 180_000; // 3 minutes

    // Tick / timing
    public const int TickMs = 2200;
    public const int TalkDist = 300;
    public const int TalkStop = 90;
    public const int HouseEnterD = 48;

    // Social need
    public const int SocialDecay = 12;
    public const int SocialGain = 22;
    public const int SocialMax = 100;
    public const int SocialUrgent = 60;

    // Day / night cycle
    public const int DayTicks = 818;
    public const int NightTicks = 2;
    public const int DawnTicks = 6;
    public const int DebateTicks = 14;
    public const int HomeWarnTicks = 5;
    public const int VoteDisplayTicks = 1;

    // Debate
    public const int MaxDebateSpeakers = 2;
    public static readonly int[] DebateSpeakCooldown = [2, 4];

    // Suspicion
    public const int ConvictionThreshold = 55;

    // Phases (frozen enum-like values)
    public static class Phase
    {
        public const string Day = "day";
        public const string Night = "night";
        public const string Dawn = "dawn";
        public const string Debate = "debate";
        public const string Vote = "vote";
        public const string Execute = "execute";
        public const string Over = "over";
    }
}
