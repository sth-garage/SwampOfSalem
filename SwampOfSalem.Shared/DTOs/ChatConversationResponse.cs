namespace SwampOfSalem.Shared.DTOs;

/// <summary>
/// A single message in a full gator conversation.
/// </summary>
public class ConversationMessage
{
    /// <summary>Conversation number (always 1 for now).</summary>
    public int Conversation { get; set; } = 1;

    /// <summary>Sequential message ID within the conversation.</summary>
    public int MessageId { get; set; }

    /// <summary>Display order (same as MessageId).</summary>
    public int Order { get; set; }

    /// <summary>ID of the alligator speaking this message.</summary>
    public int SpeakerGatorId { get; set; }

    /// <summary>ID of the alligator being spoken to.</summary>
    public int SpeakingToGatorId { get; set; }

    /// <summary>The alligator's private inner thought (may be null).</summary>
    public string? Thought { get; set; }

    /// <summary>What the alligator says out loud.</summary>
    public string Speech { get; set; } = string.Empty;
}

/// <summary>
/// The full generated conversation returned to the front end.
/// </summary>
public class ChatConversationResponse
{
    public int InitiatorId { get; set; }
    public int ResponderId { get; set; }
    public List<ConversationMessage> Messages { get; set; } = [];
}
