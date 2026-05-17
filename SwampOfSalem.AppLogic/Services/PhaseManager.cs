using SwampOfSalem.Shared.Enums;
using SwampOfSalem.Shared.Models;

namespace SwampOfSalem.AppLogic.Services;

/// <summary>
/// Manages phase transitions for the Swamp of Salem game loop.
/// <para>
/// The canonical phase order per round is:<br/>
/// <c>Day → Night → Dawn → Debate → Vote → Execute → Day (repeat)</c>
/// </para>
/// <para>
/// The JavaScript simulation in <c>phases.js</c> drives all visual transitions and
/// calls the .NET API at each boundary. This service handles only the
/// <b>server-side state mutation</b> — it updates <c>GameState.Phase</c> and
/// checks win conditions — keeping the game consistent even if the client refreshes.
/// </para>
/// </summary>
public class PhaseManager
{
    /// <summary>
    /// Advances <see cref="GameState.Phase"/> to the next phase in the cycle
    /// and returns the newly set value.
    /// <para>
    /// When the current phase is <c>Execute</c> the method first checks win conditions
    /// via <see cref="CheckGameOver"/>; if the game is over it sets <c>GameOver</c>
    /// instead of cycling back to <c>Day</c>.
    /// </para>
    /// </summary>
    /// <param name="state">Mutable game state to advance.</param>
    /// <returns>The new <see cref="GamePhase"/> after the transition.</returns>
    public GamePhase AdvancePhase(GameState state)
    {
        state.Phase = state.Phase switch
        {
            GamePhase.Day     => GamePhase.Night,
            GamePhase.Night   => GamePhase.Dawn,
            GamePhase.Dawn    => GamePhase.Debate,
            GamePhase.Debate  => GamePhase.Vote,
            GamePhase.Vote    => GamePhase.Execute,
            // After Execute: check win conditions before deciding whether to loop or end.
            GamePhase.Execute => CheckGameOver(state) ? GamePhase.GameOver : GamePhase.Day,
            _                 => state.Phase  // Unknown or terminal phase — stay put.
        };
        return state.Phase;
    }

    /// <summary>
    /// Evaluates whether the game has reached a terminal win condition.
    /// <para>
    /// Win conditions:
    /// <list type="bullet">
    ///   <item><description>≤ 2 living alligators remain — the murderer wins by outnumbering the town.</description></item>
    ///   <item><description>The murderer is no longer alive — the town successfully executed the killer.</description></item>
    /// </list>
    /// </para>
    /// </summary>
    /// <param name="state">Current game state to evaluate.</param>
    /// <returns><c>true</c> if the game should end; <c>false</c> to continue.</returns>
    public bool CheckGameOver(GameState state)
    {
        var alive = state.Alligators.Where(a => a.IsAlive).ToList();

        // Murderer wins: too few towngators remain to form a majority vote.
        if (alive.Count <= 2) return true;

        // Town wins: the murderer has been executed and is no longer alive.
        if (state.MurdererId.HasValue && !alive.Any(a => a.Id == state.MurdererId))
            return true;

        return false;
    }
}
