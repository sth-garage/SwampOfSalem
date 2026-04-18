namespace SwampOfSalem.Shared.DTOs;

/// <summary>
/// Request for a roundtable debate where all agents speak simultaneously.
/// </summary>
public class DebateRoundRequest
{
    public List<int> ParticipantIds { get; set; } = [];
    public int? VictimId { get; set; }
    public int DayNumber { get; set; }
    public int RoundNumber { get; set; }
    public List<DebateMessage> PreviousMessages { get; set; } = [];
}

public class DebateMessage
{
    public int SpeakerId { get; set; }
    public string SpeakerName { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
}
