using SwampOfSalem.Shared.Enums;

namespace SwampOfSalem.Shared.Models;

/// <summary>
/// Core domain model representing a single alligator character in the Swamp of Salem simulation.
/// <para>
/// Each alligator is a fully autonomous agent with:
/// <list type="bullet">
///   <item><description>A <see cref="Personality"/> that drives AI prompt generation and stat baselines.</description></item>
///   <item><description>Social stats that govern how often they seek out conversation.</description></item>
///   <item><description>Economy values (money, apples, oranges) for swamp bartering.</description></item>
///   <item><description>Relationship dictionaries that track how they feel about every other gator.</description></item>
///   <item><description>Suspicion scores used by the murderer-detection and voting logic.</description></item>
/// </list>
/// </para>
/// <para>
/// One alligator per game is secretly the <c>IsMurderer</c>; their goal is to eliminate
/// all others before being voted out. The remaining alligators are towngators whose goal
/// is to identify and execute the killer via community debate and vote.
/// </para>
/// </summary>
public class Alligator
{
    // ── Identity ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Unique integer identifier for this alligator. Used as the key in all
    /// relationship, suspicion, and vote dictionaries.
    /// </summary>
    public int Id { get; set; }

    /// <summary>
    /// Display name of the alligator (e.g. "Chomps", "Bubba", "Gnarla").
    /// Names are drawn from <see cref="SwampOfSalem.AppLogic.Constants.AppearanceConstants.Names"/>.
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// The alligator's personality archetype. Controls:
    /// <list type="bullet">
    ///   <item><description>The AI system-prompt tone injected by <c>PersonalityPrompts</c>.</description></item>
    ///   <item><description>Baseline <see cref="ThoughtStat"/> and <see cref="SocialStat"/> values.</description></item>
    ///   <item><description>Activity weight distribution (how often they move vs. talk vs. host).</description></item>
    ///   <item><description>Walk speed and memory retention strength.</description></item>
    /// </list>
    /// </summary>
    public Personality Personality { get; set; }

    /// <summary>
    /// Zero-based index of the alligator's home house on the culde-sac layout.
    /// Doubles as the clockwise vote order during the <c>Vote</c> phase.
    /// </summary>
    public int HomeIndex { get; set; }

    /// <summary>
    /// Whether this alligator is still alive. When <c>false</c> the agent is
    /// excluded from all conversations, voting, and night-phase logic.
    /// </summary>
    public bool IsAlive { get; set; } = true;

    /// <summary>
    /// <c>true</c> for exactly ONE alligator per game — the secret murderer.
    /// The murderer receives a hidden addition to their AI system prompt that
    /// instructs them to deflect suspicion and choose kill targets strategically.
    /// </summary>
    public bool IsMurderer { get; set; }

    /// <summary>
    /// <c>true</c> for alligators who naturally deceive others.
    /// Liars may flip their stated opinion versus their true internal opinion,
    /// spread false rumours, and present false friendliness to alligators they hate.
    /// Mutually exclusive with <see cref="IsMurderer"/> — a murderer already has
    /// full deception instructions.
    /// </summary>
    public bool IsLiar { get; set; }

    /// <summary>
    /// What the alligator is doing right now on the simulation canvas.
    /// Drives animation state in the frontend renderer.
    /// </summary>
    public Activity CurrentActivity { get; set; } = Activity.Moving;

    // ── Social stats (1–10 scale) ─────────────────────────────────────────────

    /// <summary>
    /// How perceptive and introspective this alligator is (1–10).
    /// Higher values mean the agent notices more clues, trusts their gut more,
    /// and generates more analytical inner thoughts. Introverts and Grumpy
    /// personalities trend toward 7–10; Extroverts and Cheerful trend 2–5.
    /// </summary>
    public int ThoughtStat { get; set; }

    /// <summary>
    /// How socially driven this alligator is (1–10). A higher value means
    /// they seek out conversation more aggressively and become unhappy faster
    /// when their <see cref="SocialNeed"/> is unmet.
    /// </summary>
    public int SocialStat { get; set; }

    /// <summary>
    /// Current social-need meter (0–100). Decays each tick by
    /// <c>SOCIAL_DECAY</c> and refills by <c>SOCIAL_GAIN</c> during conversation.
    /// When it exceeds <c>SOCIAL_URGENT</c> the alligator will aggressively
    /// seek the nearest living neighbour to talk to.
    /// </summary>
    public int SocialNeed { get; set; }

    // ── Economy ───────────────────────────────────────────────────────────────

    /// <summary>Amount of swamp currency held by this alligator.</summary>
    public int Money { get; set; }

    /// <summary>Number of apples in inventory — a common swamp trade good.</summary>
    public int Apples { get; set; }

    /// <summary>Number of oranges in inventory.</summary>
    public int Oranges { get; set; }

    /// <summary>Outstanding debt owed to other alligators.</summary>
    public int Debt { get; set; }

    /// <summary>
    /// <c>true</c> if this alligator has a strong preference for oranges over apples.
    /// Used as a personality quirk for AI dialogue flavour and topic opinion scoring.
    /// </summary>
    public bool OrangeLover { get; set; }

    // ── Relationships ─────────────────────────────────────────────────────────

    /// <summary>
    /// How this alligator actually feels about each other alligator.
    /// Key = other alligator's <see cref="Id"/>, Value = relationship score (-100 to +100).
    /// <list type="bullet">
    ///   <item><description>-100 = deep hatred</description></item>
    ///   <item><description>0   = neutral</description></item>
    ///   <item><description>+100 = strong bond</description></item>
    /// </list>
    /// Updated each time two alligators finish a conversation via <c>RelationshipService.DriftRelations</c>.
    /// </summary>
    public Dictionary<int, double> Relations { get; set; } = [];

    /// <summary>
    /// How this alligator THINKS others feel about them — their perception of
    /// the relationship, which may differ from <see cref="Relations"/>.
    /// Liars can skew this intentionally. Used for AI prompt context.
    /// </summary>
    public Dictionary<int, double> PerceivedRelations { get; set; } = [];

    /// <summary>
    /// How much this alligator suspects each other alligator of being the murderer.
    /// Key = suspect's <see cref="Id"/>, Value = suspicion score (0–100).
    /// <para>
    /// Once suspicion exceeds <c>CONVICTION_THRESHOLD</c> (55) the alligator will
    /// openly accuse that suspect during the Debate phase and vote for them.
    /// </para>
    /// Also used by the murderer's <c>MurderService.SelectVictim</c> — they
    /// preferentially kill whoever suspects them the most.
    /// </summary>
    public Dictionary<int, double> Suspicion { get; set; } = [];
}
