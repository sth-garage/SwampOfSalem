namespace SwampOfSalem.Shared.DTOs;

public class AgentDialogResponse
{
    public int AlligatorId { get; set; }
    public string Message { get; set; } = string.Empty;
    public string? Thought { get; set; }
    public Dictionary<int, double>? RelationshipChanges { get; set; }
    public Dictionary<int, double>? SuspicionChanges { get; set; }
}
