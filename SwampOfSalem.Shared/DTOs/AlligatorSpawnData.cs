namespace SwampOfSalem.Shared.DTOs;

/// <summary>
/// Lightweight DTO for passing alligator spawn data from JS to .NET.
/// </summary>
public class AlligatorSpawnData
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Personality { get; set; } = string.Empty;
    public bool IsMurderer { get; set; }
    public bool IsLiar { get; set; }
    /// <summary>Numeric topic opinions: topic label -> value (-100 to 100).</summary>
    public Dictionary<string, int> TopicOpinions { get; set; } = [];
    /// <summary>Sports team affiliation: "Rockets", "Jets", or "Chowda".</summary>
    public string SportsTeam { get; set; } = string.Empty;
}
