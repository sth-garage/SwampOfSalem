namespace GatorGazing.Shared.DTOs;

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
}
