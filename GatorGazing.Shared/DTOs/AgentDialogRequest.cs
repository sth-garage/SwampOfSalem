namespace GatorGazing.Shared.DTOs;

/// <summary>
/// Request for an agent to produce dialog, thought, accusation, etc.
/// </summary>
public class AgentDialogRequest
{
    public int AlligatorId { get; set; }
    /// <summary>conversation, thought, accusation, defense, vote_speech, debate</summary>
    public string DialogType { get; set; } = string.Empty;
    public int? TargetAlligatorId { get; set; }
    public List<int> ParticipantIds { get; set; } = [];
    public string? Context { get; set; }
}
