namespace SwampOfSalem.Shared.Models;

/// <summary>
/// A single memory entry an alligator agent retains about past events.
/// </summary>
public class MemoryEntry
{
    public int Day { get; set; }
    public string Type { get; set; } = string.Empty;
    public string Detail { get; set; } = string.Empty;
    public int? RelatedAlligatorId { get; set; }
    public DateTimeOffset Timestamp { get; set; } = DateTimeOffset.UtcNow;
}
