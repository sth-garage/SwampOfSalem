namespace SwampOfSalem.Shared.DTOs;

/// <summary>
/// Sent to <c>POST /api/agent/vote</c> to ask one alligator agent who they
/// vote to execute this round.
/// </summary>
public class VoteRequest
{
    /// <summary>ID of the alligator casting the vote.</summary>
    public int AlligatorId { get; set; }

    /// <summary>
    /// IDs of all alligators eligible to receive a vote this round
    /// (i.e. all living alligators except the voter themselves).
    /// </summary>
    public List<int> CandidateIds { get; set; } = [];

    /// <summary>
    /// A plain-text summary of what was said during the Debate phase,
    /// injected into the agent's prompt so their vote reflects the debate.
    /// </summary>
    public string DebateSummary { get; set; } = string.Empty;
}
