namespace SwampOfSalem.Shared.DTOs;

/// <summary>
/// The response returned by <c>GatorAgentService.GenerateDialogAsync()</c>.
/// Contains both the public spoken message and the agent's private inner thought.
/// </summary>
public class AgentDialogResponse
{
    /// <summary>ID of the alligator who generated this response.</summary>
    public int AlligatorId { get; set; }

    /// <summary>
    /// The text the alligator says out loud. Other nearby gators can hear this.
    /// May be an empty string if the agent decides to stay silent.
    /// </summary>
    public string Message { get; set; } = string.Empty;

    /// <summary>
    /// The alligator's private inner monologue — honest strategic reasoning
    /// that is never surfaced to other game participants.
    /// Shown to the human observer in the UI's thought-bubble overlay.
    /// </summary>
    public string? Thought { get; set; }

    /// <summary>
    /// Optional relationship delta values the agent wishes to apply after
    /// this interaction. Key = other alligator ID, Value = delta (-100 to +100).
    /// Currently reserved for future use.
    /// </summary>
    public Dictionary<int, double>? RelationshipChanges { get; set; }

    /// <summary>
    /// Optional suspicion delta values. Key = suspect alligator ID,
    /// Value = change in suspicion score. Currently reserved for future use.
    /// </summary>
    public Dictionary<int, double>? SuspicionChanges { get; set; }
}
