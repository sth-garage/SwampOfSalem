namespace SwampOfSalem.Shared.Enums;

/// <summary>
/// Dynamic emotional state for an alligator. Unlike <see cref="Personality"/> (fixed at spawn),
/// Mood shifts in response to game events and influences dialogue tone, vote scoring,
/// conversation topic selection, and inner-thought generation.
///
/// <para><b>Categories:</b></para>
/// <list type="bullet">
///   <item><description><b>Normal</b> — default baseline; no modifier.</description></item>
///   <item><description><b>Suspicion / Investigation</b> — driven by evidence and accusation patterns.</description></item>
///   <item><description><b>Fear / Threat</b> — triggered by personal danger or loss.</description></item>
///   <item><description><b>Social / Relationship</b> — driven by relation score events.</description></item>
///   <item><description><b>Personality Escalations</b> — existing personality pushed to an extreme.</description></item>
///   <item><description><b>Swamp Flavour</b> — thematic / atmospheric states.</description></item>
///   <item><description><b>Late-Game / Death-Adjacent</b> — triggered near endgame conditions.</description></item>
/// </list>
/// </summary>
public enum Mood
{
    // ── Baseline ──────────────────────────────────────────────────────────────

    /// <summary>Default state — no emotional modifier active.</summary>
    Normal,

    // ── Suspicion / Investigation ─────────────────────────────────────────────

    /// <summary>Same suspect targeted 3+ days — locked on; ignores other leads. Vote score multiplied.</summary>
    Obsessed,

    /// <summary>Top suspect is also a high-relation gator — avoids accusing them; vote is erratic.</summary>
    Conflicted,

    /// <summary>Witnessed an inconsistency — suspicion locked, immune to persuasion drift.</summary>
    Convinced,

    /// <summary>Voted for someone who turned out innocent — loses confidence; may flip next vote.</summary>
    Doubting,

    /// <summary>Low suspicion on all living gators — actively seeks conversations to gather intel.</summary>
    Sleuthing,

    /// <summary>(Murderer only) Loudly accuses an innocent with theatrical certainty.</summary>
    RedHerring,

    // ── Fear / Threat ─────────────────────────────────────────────────────────

    /// <summary>Currently the vote leader — desperate to talk to anyone who will listen.</summary>
    Cornered,

    /// <summary>Two votes from majority against them — lies, deflects, makes wild accusations.</summary>
    Desperate,

    /// <summary>Overheard their own name as a suspect — avoids open areas; hosts more.</summary>
    Hunted,

    /// <summary>Voted against 2+ times without execution — stops initiating; fatalistic speech.</summary>
    Resigned,

    /// <summary>Best ally just murdered — erratic movement; short urgent messages.</summary>
    Panicking,

    // ── Social / Relationship ─────────────────────────────────────────────────

    /// <summary>Relation with someone hit maximum — refuses to vote for that gator under any circumstance.</summary>
    Bonded,

    /// <summary>A high-relation gator voted against them — relation hard-floors; switches to hostile tone.</summary>
    Betrayed,

    /// <summary>Just ended a long positive conversation — temporary warmth boost to next 2 interactions.</summary>
    Charming,

    /// <summary>Below-average relation with everyone — wanders alone; hostile to conversation openers.</summary>
    Isolated,

    /// <summary>Relation > 70 with a nearby gator — follows them; keeps re-initiating conversation.</summary>
    Clingy,

    /// <summary>(Extrovert only) Voted with the majority last round — speech mirrors recent conversation partners.</summary>
    Sycophantic,

    // ── Personality Escalations ───────────────────────────────────────────────

    /// <summary>(Energetic) Disagreed with a vote outcome — won't stop talking about it.</summary>
    Ranting,

    /// <summary>(Grumpy) Post-betrayal — refuses all conversation attempts.</summary>
    Stonewalling,

    /// <summary>(Introvert) Contradicts their own previous statement mid-debate.</summary>
    Overthinking,

    /// <summary>(Cheerful) Missing obvious clues; cheerful despite mounting deaths.</summary>
    BlissfullyUnaware,

    /// <summary>(Lazy) Missed key events; has almost no relevant memories from last night.</summary>
    CheckedOut,

    /// <summary>(Extrovert) Announces their vote publicly before the vote phase even starts.</summary>
    Showboating,

    // ── Swamp Flavour ─────────────────────────────────────────────────────────

    /// <summary>Confused by conflicting information — gives vague non-answers.</summary>
    Murky,

    /// <summary>Won't leave their house zone — hostile to visitors.</summary>
    Territorial,

    /// <summary>Blissfully idle — unusually slow to respond to events around them.</summary>
    Sunning,

    /// <summary>A nearby murder location makes them restless and aggressive.</summary>
    StirredUp,

    /// <summary>Withdrawn after a traumatic event — barely speaks for a full day.</summary>
    Submerged,

    /// <summary>(Murderer only, late game) Calm and calculated — no emotional tells.</summary>
    ColdBlooded,

    // ── Late-Game / Death-Adjacent ────────────────────────────────────────────

    /// <summary>Saw the death marker of a friend — speech repeatedly references the dead gator.</summary>
    Haunted,

    /// <summary>All allies are dead but they survived — votes erratically; may vote irrationally.</summary>
    SurvivorsGuilt,

    /// <summary>Only non-murderer remaining — maximum suspicion on murderer; urgent debate speech.</summary>
    LastStand,

    /// <summary>(Murderer only) 1 vote from majority — switches to pure chaos strategy.</summary>
    Doomed,
}
