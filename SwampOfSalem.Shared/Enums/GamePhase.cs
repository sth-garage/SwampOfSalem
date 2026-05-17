namespace SwampOfSalem.Shared.Enums;

/// <summary>
/// Represents each distinct phase of a Swamp of Salem game turn.
/// <para>
/// The full cycle per round is:<br/>
/// <c>Day → Night → Dawn → Debate → Vote → Execute → Day (or GameOver)</c>
/// </para>
/// <para>
/// The C# <see cref="SwampOfSalem.AppLogic.Services.PhaseManager"/> advances the
/// server-side state, while the JavaScript <c>phases.js</c> module drives the
/// matching frontend transitions.
/// </para>
/// </summary>
public enum GamePhase
{
    /// <summary>
    /// Alligators roam the culde-sac, chat freely, and update their relationships.
    /// This is the longest phase — the simulation runs for ~818 ticks.
    /// </summary>
    Day,

    /// <summary>
    /// Alligators return home and go to sleep. The murderer secretly selects a
    /// victim via <see cref="SwampOfSalem.AppLogic.Services.MurderService"/>.
    /// Lasts only 2 ticks (near-instant transition).
    /// </summary>
    Night,

    /// <summary>
    /// The murdered body is discovered. All agents receive a memory injection
    /// about the victim and update their suspicion scores.
    /// Lasts ~6 ticks.
    /// </summary>
    Dawn,

    /// <summary>
    /// All living alligators argue publicly about who the murderer is.
    /// AI agents take turns speaking accusations and defences.
    /// Lasts ~14 ticks.
    /// </summary>
    Debate,

    /// <summary>
    /// Each living alligator casts one vote (clockwise by home index)
    /// for the alligator they believe is the murderer.
    /// Managed by <see cref="SwampOfSalem.AppLogic.Services.VoteService"/>.
    /// </summary>
    Vote,

    /// <summary>
    /// The alligator with the most votes is executed (eliminated from the game).
    /// Ties result in no execution. After this phase the game checks win conditions.
    /// </summary>
    Execute,

    /// <summary>
    /// Terminal state reached when either:<br/>
    /// • The murderer is executed (town wins), or<br/>
    /// • Only 2 or fewer alligators remain alive (murderer wins by outnumbering the town).
    /// </summary>
    GameOver
}
