using GatorGazing.Shared.Enums;

namespace GatorGazing.Shared.Models;

/// <summary>
/// Core domain model for an alligator in the swamp.
/// </summary>
public class Alligator
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public Personality Personality { get; set; }
    public int HomeIndex { get; set; }
    public bool IsAlive { get; set; } = true;
    public bool IsMurderer { get; set; }
    public bool IsLiar { get; set; }
    public Activity CurrentActivity { get; set; } = Activity.Moving;

    // Social stats (1-10 scale)
    public int ThoughtStat { get; set; }
    public int SocialStat { get; set; }
    public int SocialNeed { get; set; }

    // Economy
    public int Money { get; set; }
    public int Apples { get; set; }
    public int Oranges { get; set; }
    public int Debt { get; set; }
    public bool OrangeLover { get; set; }

    // Relationships: other alligator ID -> value (-100 to 100)
    public Dictionary<int, double> Relations { get; set; } = [];
    public Dictionary<int, double> PerceivedRelations { get; set; } = [];
    public Dictionary<int, double> Suspicion { get; set; } = [];
}
