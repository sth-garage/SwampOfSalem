namespace SwampOfSalem.AppLogic.Constants;

/// <summary>
/// Core game-loop timing, sizing, and phase constants.
/// Single source of truth â€” serialized to JS at startup.
/// </summary>
public static class GameConstants
{
    // ── Sizing ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Pixel size of each alligator's SVG sprite on the simulation canvas.
    /// All collision and proximity checks (e.g. <see cref="TalkDist"/>) are relative to this.
    /// </summary>
    public const int GatorSize = 120;

    /// <summary>
    /// Default number of alligators per game session.
    /// The full game is designed for 6 (1 murderer + 5 towngators);
    /// adjust this to experiment with different group sizes.
    /// </summary>
    public const int GatorCount = 2;

    // ── Conversation limits ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Maximum number of AI conversations that may run concurrently.
    /// Each active conversation occupies one slot; new conversations are blocked until
    /// a slot frees up. Increase to allow livelier multi-pair chatter; reduce to 1
    /// to serialise all conversations (original behaviour).
    /// </summary>
    public const int MaxConcurrentConversations = 2;

    // ── Tick / timing ──────────────────────────────────────────────────────────────────

    /// <summary>
    /// Duration of each simulation tick in milliseconds (2200 ms ≈ 2.2 s per tick).
    /// All phase durations expressed in ticks are multiplied by this for real time.
    /// Reduce during development to speed up testing.
    /// </summary>
    public const int TickMs = 2200;

    /// <summary>
    /// Maximum pixel distance between two gators for them to be considered
    /// close enough to start a conversation.
    /// </summary>
    public const int TalkDist = 300;

    /// <summary>
    /// Distance at which two approaching gators stop moving and lock into
    /// face-to-face conversation position (pixels).
    /// </summary>
    public const int TalkStop = 90;

    /// <summary>
    /// Pixel proximity threshold for a gator to "enter" their home and
    /// trigger the Hosting/Visiting activity state.
    /// </summary>
    public const int HouseEnterD = 48;

    // ── Social need ────────────────────────────────────────────────────────────────────

    /// <summary>Points drained from a gator's social-need meter each tick while idle.</summary>
    public const int SocialDecay = 12;

    /// <summary>Points restored to a gator's social-need meter each tick while talking.</summary>
    public const int SocialGain = 22;

    /// <summary>Maximum value the social-need meter can reach.</summary>
    public const int SocialMax = 100;

    /// <summary>
    /// When the social-need meter exceeds this value the gator is "socially urgent"
    /// and will aggressively seek a nearby neighbour to converse with.
    /// </summary>
    public const int SocialUrgent = 60;

    // ── Day / night cycle (all values in simulation ticks) ─────────────────────────────

    /// <summary>Ticks the Day phase lasts (136 × 2.2 s ≈ 5 min). Nightfall always fires when this expires.</summary>
    public const int DayTicks = 136;

    /// <summary>Ticks the Night phase lasts — near-instant black screen (2 × 2.2 s ≈ 4 s).</summary>
    public const int NightTicks = 2;

    /// <summary>Ticks the Dawn discovery sequence shows (6 × 2.2 s ≈ 13 s).</summary>
    public const int DawnTicks = 6;

    /// <summary>Maximum ticks for the Debate phase (55 × 2.2 s ≈ 2 min). Gives AI debate convs time to play out.</summary>
    public const int DebateTicks = 55;

    /// <summary>Ticks before nightfall when a "go home!" warning overlay is shown.</summary>
    public const int HomeWarnTicks = 5;

    /// <summary>Ticks to display the vote result before advancing to Execute.</summary>
    public const int VoteDisplayTicks = 1;

    // ── Debate ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Maximum number of alligators allowed to speak during a single debate tick.
    /// Keeps the debate readable rather than having everyone speak simultaneously.
    /// </summary>
    public const int MaxDebateSpeakers = 2;

    /// <summary>
    /// [min, max] tick cooldown between a gator's consecutive debate turns.
    /// A random value in this range is drawn so speakers stagger naturally.
    /// </summary>
    public static readonly int[] DebateSpeakCooldown = [2, 4];

    // ── Suspicion ──────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Suspicion score (0–100) above which a gator treats another as their primary
    /// murder suspect — they will accuse in debate and vote against that gator.
    /// The murderer also uses this to prioritise kill targets.
    /// </summary>
    public const int ConvictionThreshold = 55;

    // ── Phase string constants (for JS interop) ────────────────────────────────────────

    /// <summary>
    /// String equivalents of the <c>GamePhase</c> enum, serialised into
    /// <c>window.GameConfig.PHASE</c> so JS can reference named phases without magic strings.
    /// </summary>
    public static class Phase
    {
        public const string Day     = "day";
        public const string Night   = "night";
        public const string Dawn    = "dawn";
        public const string Debate  = "debate";
        public const string Vote    = "vote";
        public const string Execute = "execute";
        public const string Over    = "over";
    }
}
