namespace SwampOfSalem.Shared.DTOs;

/// <summary>
/// The voting decision returned by <c>GatorAgentService.GetVoteAsync()</c>.
/// </summary>
public class VoteResponse
{
    /// <summary>ID of the alligator who cast this vote.</summary>
    public int AlligatorId { get; set; }

    /// <summary>ID of the alligator this agent chose to vote against for execution.</summary>
    public int VoteForId { get; set; }

    /// <summary>
    /// The agent's spoken reasoning for their vote (1–2 sentences).
    /// Displayed in the UI vote log and injected into other agents' memories.
    /// </summary>
    public string Reasoning { get; set; } = string.Empty;
}
