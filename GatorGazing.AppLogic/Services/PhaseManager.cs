using GatorGazing.Shared.Enums;
using GatorGazing.Shared.Models;

namespace GatorGazing.AppLogic.Services;

/// <summary>
/// Manages game phase transitions.
/// </summary>
public class PhaseManager
{
    public GamePhase AdvancePhase(GameState state)
    {
        state.Phase = state.Phase switch
        {
            GamePhase.Day => GamePhase.Night,
            GamePhase.Night => GamePhase.Dawn,
            GamePhase.Dawn => GamePhase.Debate,
            GamePhase.Debate => GamePhase.Vote,
            GamePhase.Vote => GamePhase.Execute,
            GamePhase.Execute => CheckGameOver(state) ? GamePhase.GameOver : GamePhase.Day,
            _ => state.Phase
        };
        return state.Phase;
    }

    public bool CheckGameOver(GameState state)
    {
        var alive = state.Alligators.Where(a => a.IsAlive).ToList();
        if (alive.Count <= 2) return true;
        if (state.MurdererId.HasValue && !alive.Any(a => a.Id == state.MurdererId))
            return true;
        return false;
    }
}
