namespace SwampOfSalem.Shared.DTOs;

/// <summary>
/// A single turn in a full gator conversation.
/// </summary>
public class ConversationTurn
{
    /// <summary>ID of the alligator speaking this turn.</summary>
    public int SpeakerId { get; set; }

    /// <summary>What the alligator says out loud.</summary>
    public string Spoken { get; set; } = string.Empty;

    /// <summary>The alligator's private inner thought (may be null).</summary>
    public string? Thought { get; set; }
}

/// <summary>
/// The full generated conversation returned to the front end.
/// </summary>
public class ChatConversationResponse
{
    public int InitiatorId { get; set; }
    public int ResponderId { get; set; }
    public List<ConversationTurn> Turns { get; set; } = [];
}
