namespace SwampOfSalem.Shared.DTOs;

/// <summary>
/// Request sent to <c>GatorAgentService.GenerateDialogAsync()</c> asking one
/// alligator agent to produce spoken dialog and/or an inner thought.
/// <para>
/// The <see cref="DialogType"/> field acts as a cue that tells the agent what
/// kind of response is expected:
/// <list type="table">
///   <listheader><term>DialogType</term><description>When it is used</description></listheader>
///   <item><term><c>conversation</c></term><description>Normal day-phase chat between two gators.</description></item>
///   <item><term><c>thought</c></term><description>A private internal monologue (not spoken aloud).</description></item>
///   <item><term><c>accusation</c></term><description>The gator publicly names their murder suspect.</description></item>
///   <item><term><c>defense</c></term><description>The gator defends themselves against an accusation.</description></item>
///   <item><term><c>vote_speech</c></term><description>A brief statement before casting their vote.</description></item>
///   <item><term><c>debate</c></term><description>A turn in the structured public debate phase.</description></item>
/// </list>
/// </para>
/// </summary>
public class AgentDialogRequest
{
    /// <summary>ID of the alligator whose AI agent should generate the response.</summary>
    public int AlligatorId { get; set; }

    /// <summary>
    /// The type of dialog to generate. Valid values:
    /// <c>conversation</c>, <c>thought</c>, <c>accusation</c>,
    /// <c>defense</c>, <c>vote_speech</c>, <c>debate</c>.
    /// </summary>
    public string DialogType { get; set; } = string.Empty;

    /// <summary>
    /// ID of the alligator being spoken to or accused, if applicable.
    /// <c>null</c> for broadcast speech (debate stage, public accusation).
    /// </summary>
    public int? TargetAlligatorId { get; set; }

    /// <summary>
    /// IDs of all alligators who can hear this conversation.
    /// Used to inject overhearing context so agents know who might be listening.
    /// </summary>
    public List<int> ParticipantIds { get; set; } = [];

    /// <summary>
    /// Optional free-text context string injected into the prompt.
    /// May include topic information, recent events, debate history, etc.
    /// </summary>
    public string? Context { get; set; }
}
