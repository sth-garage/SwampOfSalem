namespace SwampOfSalem.Shared.Models;

/// <summary>
/// Represents an informal alliance of alligators who trust each other,
/// coordinate their votes, and may collectively oppose rival cliques.
///
/// <para>
/// Cliques form organically when mutual relation scores exceed a threshold.
/// They dissolve or reshape when members die. A gator belongs to at most one
/// clique at a time (<see cref="Alligator.CliqueId"/>).
/// </para>
/// </summary>
public class Clique
{
    /// <summary>Unique identifier for this clique (1-based, assigned at formation).</summary>
    public int Id { get; set; }

    /// <summary>
    /// Display label shown in debug output and AI prompts.
    /// E.g. "The Inner Circle", "The Shoreline Crew".
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// IDs of all living alligators who belong to this clique.
    /// Dead members are removed by <c>CliqueService.UpdateCliques</c>.
    /// </summary>
    public List<int> MemberIds { get; set; } = [];

    /// <summary>
    /// IDs of cliques that this clique considers rivals.
    /// Rivalry is symmetric — if A rivals B then B rivals A.
    /// Members of rival cliques receive suspicion/relation penalties in
    /// vote scoring and conversation drift.
    /// </summary>
    public HashSet<int> RivalCliqueIds { get; set; } = [];

    /// <summary>
    /// Average mutual relation score among members at the time of last evaluation.
    /// Used to assess clique cohesion; cliques with cohesion below 20 dissolve.
    /// </summary>
    public double Cohesion { get; set; }

    /// <summary>
    /// Day on which this clique was formed or last restructured.
    /// </summary>
    public int FormedOnDay { get; set; }

    /// <summary>Returns true when fewer than two members remain alive.</summary>
    public bool IsDissolvedOrSingleton => MemberIds.Count < 2;
}
