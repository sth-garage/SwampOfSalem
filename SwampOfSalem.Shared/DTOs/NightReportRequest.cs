namespace SwampOfSalem.Shared.DTOs;

/// <summary>
/// Request for a night-time AI reflection from a single alligator.
/// </summary>
public class NightReportRequest
{
    public int AlligatorId { get; set; }
    /// <summary>IDs of all currently alive alligators (for context).</summary>
    public List<int> AliveIds { get; set; } = [];
}
