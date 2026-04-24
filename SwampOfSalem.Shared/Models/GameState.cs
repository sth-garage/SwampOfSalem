using SwampOfSalem.Shared.Enums;

namespace SwampOfSalem.Shared.Models;

/// <summary>
/// Central mutable snapshot of a single Swamp of Salem game session.
/// <para>
/// This object is registered as a <b>singleton</b> in the DI container so that
/// both <c>GatorAgentService</c> (SK layer) and the minimal-API endpoints in
/// <c>Program.cs</c> share the same live state without any database or
/// serialization overhead.
/// </para>
/// <para>
/// The game flows through phases in this order:<br/>
/// <c>Day → Night → Dawn → Debate → Vote → Execute → (Day | GameOver)</c>
/// </para>
/// <para>
/// Pattern note: The JavaScript frontend owns the simulation tick loop and
/// calls the .NET API to:
/// <list type="number">
///   <item><description>Initialize gator agents (<c>POST /api/agent/initialize</c>).</description></item>
///   <item><description>Generate AI dialog for each gator.</description></item>
///   <item><description>Record memories so agents stay contextually aware.</description></item>
///   <item><description>Collect votes and report the execution result.</description></item>
/// </list>
/// </para>
/// </summary>
public class GameState
{
    /// <summary>
    /// The full roster of alligators for this game session.
    /// Includes both living and dead alligators; use
    /// <c>.Where(a =&gt; a.IsAlive)</c> to get only living participants.
    /// </summary>
    public List<Alligator> Alligators { get; set; } = [];

    /// <summary>
    /// The current phase of the game loop.
    /// Advanced by <c>PhaseManager.AdvancePhase()</c>.
    /// </summary>
    public GamePhase Phase { get; set; } = GamePhase.Day;

    /// <summary>
    /// Monotonically increasing day counter. Starts at 1 and increments each
    /// time the phase cycle completes a full Day → … → Execute → Day loop.
    /// Stored in every <c>MemoryEntry</c> for temporal context.
    /// </summary>
    public int DayNumber { get; set; } = 1;

    /// <summary>
    /// The <see cref="Alligator.Id"/> of the one secret murderer, or
    /// <c>null</c> if the murderer has already been executed (town wins).
    /// </summary>
    public int? MurdererId { get; set; }

    /// <summary>
    /// Set of IDs for every alligator that has been killed or executed.
    /// Used for quick O(1) alive-checks across the codebase.
    /// </summary>
    public HashSet<int> DeadIds { get; set; } = [];

    /// <summary>
    /// The <see cref="Alligator.Id"/> of the alligator killed during the most
    /// recent Night phase, or <c>null</c> if no kill occurred (e.g. Day 1).
    /// Revealed to all gators at Dawn.
    /// </summary>
    public int? NightVictimId { get; set; }

    /// <summary>
    /// The alligator currently nominated for execution during the Vote phase,
    /// or <c>null</c> if no target has been confirmed yet.
    /// </summary>
    public int? VoteTarget { get; set; }

    /// <summary>
    /// Ordered list of alligator IDs representing the clockwise voting sequence
    /// around the culde-sac, sorted ascending by <see cref="Alligator.HomeIndex"/>.
    /// Populated by <c>VoteService.EstablishVoteOrder()</c>.
    /// </summary>
    public List<int> VoteOrder { get; set; } = [];

    /// <summary>
    /// Index into <see cref="VoteOrder"/> pointing to the alligator whose
    /// vote has not yet been recorded. Incremented by <c>VoteService.RecordVote()</c>.
    /// </summary>
    public int VoteIndex { get; set; }

    /// <summary>
    /// Running tally of votes cast during the current Vote phase.
    /// Key = candidate's alligator ID, Value = number of votes received.
    /// Reset at the start of each new Vote phase by <c>VoteService.EstablishVoteOrder()</c>.
    /// </summary>
    public Dictionary<int, int> VoteResults { get; set; } = [];

    /// <summary>
    /// All active cliques formed during this game session.
    /// Managed by <c>CliqueService</c> — formed at game start and updated after each death.
    /// </summary>
    public List<Clique> Cliques { get; set; } = [];

    /// <summary>
    /// Number of alligators alive at the start of the game.
    /// Used by panic-escalation logic to compute the fraction of the population that has died.
    /// </summary>
    public int StartingPopulation { get; set; }
}
