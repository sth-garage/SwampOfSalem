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
    /// The JS frontend enforces this via <c>state.activeConversation</c> — only one
    /// conversation can be in flight at a time so the simulation stays readable.
    /// </summary>
    public const int MaxConcurrentConversations = 1;

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

    // ── Bite / fight-or-flight ──────────────────────────────────────────────────────────

    /// <summary>
    /// Number of bites a gator can absorb before dying.
    /// When a gator's <c>biteCount</c> reaches this threshold the engine calls
    /// <c>_killFromBites(...)</c> and the gator is removed from the simulation.
    /// </summary>
    public const int BiteDeathThreshold = 5;

    /// <summary>
    /// Minimum duration in milliseconds that a bitten gator spends in the
    /// panic-flee state before they are allowed to counter-attack or calm down.
    /// Actual flee window = <see cref="BiteFleeMinMs"/> + random(0, <see cref="BiteFleeExtraMs"/>).
    /// </summary>
    public const int BiteFleeMinMs = 4000;

    /// <summary>
    /// Maximum additional milliseconds added randomly on top of <see cref="BiteFleeMinMs"/>
    /// for the flee window duration (so each flee is slightly different).
    /// </summary>
    public const int BiteFleeExtraMs = 3000;

    /// <summary>
    /// Probability (0–1) that a bitten gator immediately counter-attacks once
    /// the flee window expires.  The remaining (1 − probability) simply runs away.
    /// </summary>
    public const double BiteCounterChance = 0.45;

    /// <summary>
    /// Probability (0–1) that a gator who witnesses an action with no strong
    /// opinion will side with the attacker.  Used for neutral witnesses in
    /// the social fallout calculation when <c>listenerFeelsBiter</c> and
    /// <c>listenerFeelsVictim</c> are both near zero.
    /// </summary>
    public const double NeutralWitnessSideWithAttackerChance = 0.5;

    /// <summary>
    /// Probability (0–1) that a gator who is a liar will flip a shared opinion
    /// before passing it on to a listener.
    /// </summary>
    public const double LiarFlipChance = 0.4;

    /// <summary>
    /// Maximum additional turns added randomly to the base conversation turn count
    /// (base is always 5; actual = 5 + random(0, ConversationExtraTurns)).
    /// </summary>
    public const int ConversationExtraTurns = 4;

    // ── Movement bounds ──────────────────────────────────────────────────────────────────

    /// <summary>
    /// Maximum distance in simulation pixels that a gator may travel from the
    /// centre of the canvas.  Gators wandering outside this radius are pushed
    /// back toward the centre each tick, keeping them within the visible swamp.
    /// 350 simulation pixels ≈ 350 ft at the default canvas scale.
    /// </summary>
    public const int TownRadiusGuard = 800;

    /// <summary>
    /// Radius of the circular ring on which houses are placed (simulation pixels).
    /// Increase to spread houses further from the centre and give gators more
    /// walking room between the house ring and the town boundary.
    /// Capped at runtime by the canvas size so houses never go off-screen.
    /// </summary>
    public const int HouseRingRadius = 380;

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
