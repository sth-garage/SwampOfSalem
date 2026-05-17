namespace SwampOfSalem.Shared.DTOs;

/// <summary>
/// Lightweight DTO used to transfer the initial character roster from the
/// JavaScript frontend to the .NET backend at game start.
/// <para>
/// The JS simulation creates alligators using <c>createGator()</c> in <c>gator.js</c>,
/// assigns roles, and then POSTs an array of these DTOs to
/// <c>POST /api/agent/initialize</c>. <c>GatorAgentService.InitializeFromSpawnData()</c>
/// converts them into <see cref="SwampOfSalem.Shared.Models.Alligator"/> domain
/// objects and creates a Semantic Kernel agent for each.
/// </para>
/// </summary>
public class AlligatorSpawnData
{
    /// <summary>Unique integer ID matching the frontend gator's <c>id</c> field.</summary>
    public int Id { get; set; }

    /// <summary>Display name (e.g. "Chomps", "Fang").</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Personality string — one of: <c>cheerful, grumpy, lazy, energetic,
    /// introvert, extrovert</c>. Parsed to the <c>Personality</c> enum
    /// during initialization; defaults to <c>Cheerful</c> on parse failure.
    /// </summary>
    public string Personality { get; set; } = string.Empty;

    /// <summary>
    /// <c>true</c> for the one secret murderer in the group.
    /// Exactly one alligator in the spawn batch should have this set.
    /// </summary>
    public bool IsMurderer { get; set; }

    /// <summary>
    /// <c>true</c> for alligators who are natural deceivers.
    /// Roughly 20% of non-murderer alligators are liars.
    /// </summary>
    public bool IsLiar { get; set; }

    /// <summary>
    /// AI-generated opinion scores for swamp topics (e.g. "mud wallowing", "fish tacos").
    /// Key = topic key string, Value = opinion score (-100 to +100).
    /// These are injected into the agent's system context so the AI can reference
    /// them naturally when choosing conversation topics.
    /// </summary>
    public Dictionary<string, int> TopicOpinions { get; set; } = [];

    /// <summary>
    /// The alligator's favourite swamp sports team: one of <c>"Rockets"</c>,
    /// <c>"Jets"</c>, or <c>"Chowda"</c>. Used as a social bonding/friction topic.
    /// </summary>
    public string SportsTeam { get; set; } = string.Empty;
}
