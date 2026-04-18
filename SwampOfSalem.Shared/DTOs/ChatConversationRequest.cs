namespace SwampOfSalem.Shared.DTOs;

/// <summary>
/// Request to generate a full back-and-forth conversation between two alligators.
/// </summary>
public class ChatConversationRequest
{
    /// <summary>ID of the alligator who initiated the conversation.</summary>
    public int InitiatorId { get; set; }

    /// <summary>ID of the other alligator.</summary>
    public int ResponderId { get; set; }

    /// <summary>The opening line spoken by the initiator.</summary>
    public string OpeningLine { get; set; } = string.Empty;

    /// <summary>Maximum number of turns (1â€“9). Defaults to 9.</summary>
    public int MaxTurns { get; set; } = 9;

    /// <summary>Optional extra context (location, recent events, etc.).</summary>
    public string? Context { get; set; }
}
