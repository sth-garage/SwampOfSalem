namespace SwampOfSalem.Shared.DTOs;

public class VoteRequest
{
    public int AlligatorId { get; set; }
    public List<int> CandidateIds { get; set; } = [];
    public string DebateSummary { get; set; } = string.Empty;
}
