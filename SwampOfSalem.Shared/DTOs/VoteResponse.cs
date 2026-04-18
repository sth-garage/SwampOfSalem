namespace SwampOfSalem.Shared.DTOs;

public class VoteResponse
{
    public int AlligatorId { get; set; }
    public int VoteForId { get; set; }
    public string Reasoning { get; set; } = string.Empty;
}
