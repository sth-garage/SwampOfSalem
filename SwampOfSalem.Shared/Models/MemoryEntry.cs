namespace SwampOfSalem.Shared.Models;

/// <summary>
/// A single memory entry persisted in an alligator agent's in-process memory list.
/// <para>
/// Memory entries are injected into the agent's <c>ChatHistory</c> as
/// <c>[Memory - Day N]</c> system messages so the Semantic Kernel agent
/// can reference them naturally during conversation, debate, and voting.
/// The last 20 entries are surfaced via <c>SwampPlugin.GetRecentMemories()</c>.
/// </para>
/// <para>
/// Common <see cref="Type"/> values:
/// <list type="bullet">
///   <item><description><c>"observed"</c> — saw or overheard something happen.</description></item>
///   <item><description><c>"spoke"</c> — said something to another gator.</description></item>
///   <item><description><c>"killed"</c> — (murderer only) chose a victim.</description></item>
///   <item><description><c>"voted"</c> — cast a vote during the Vote phase.</description></item>
///   <item><description><c>"executed"</c> — witnessed the day's execution.</description></item>
/// </list>
/// </para>
/// </summary>
public class MemoryEntry
{
    /// <summary>Game day on which this memory was formed.</summary>
    public int Day { get; set; }

    /// <summary>Category of the memory event (e.g. "observed", "spoke", "voted").</summary>
    public string Type { get; set; } = string.Empty;

    /// <summary>
    /// Human-readable description of the event, written in first-person so it
    /// reads naturally when injected into the agent's chat history.
    /// Example: <c>"Saw Chomps sneaking near Bubba's house at night."</c>
    /// </summary>
    public string Detail { get; set; } = string.Empty;

    /// <summary>
    /// Optional ID of the alligator most relevant to this memory (victim,
    /// conversation partner, etc.). May be <c>null</c> for generic events.
    /// </summary>
    public int? RelatedAlligatorId { get; set; }

    /// <summary>Wall-clock time the memory was created (UTC). Useful for ordering.</summary>
    public DateTimeOffset Timestamp { get; set; } = DateTimeOffset.UtcNow;
}
