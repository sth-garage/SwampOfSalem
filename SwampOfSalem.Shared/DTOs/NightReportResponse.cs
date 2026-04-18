namespace SwampOfSalem.Shared.DTOs;

/// <summary>
/// One alligator's night-time AI reflection: their primary suspect and reasoning.
/// </summary>
public class NightReportEntry
{
    public int AlligatorId { get; set; }
    public string AlligatorName { get; set; } = string.Empty;
    public int? TopSuspectId { get; set; }
    public string? TopSuspectName { get; set; }
    /// <summary>One or two sentences explaining who they suspect and why.</summary>
    public string SuspicionReason { get; set; } = string.Empty;
    /// <summary>Private inner thought for the night.</summary>
    public string? InnerThought { get; set; }
}

/// <summary>
/// All gators' night-time AI reflections bundled into a single response.
/// </summary>
public class NightReportResponse
{
    public List<NightReportEntry> Entries { get; set; } = [];
}
