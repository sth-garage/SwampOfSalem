using SwampOfSalem.Shared.Models;

namespace SwampOfSalem.AppLogic.Services;

/// <summary>
/// Handles the murderer's nightly victim selection during the Night phase.
/// <para>
/// The selection algorithm is <b>intentionally weighted</b> so the murderer acts
/// like a rational agent rather than picking randomly:
/// <list type="number">
///   <item>
///     <description>
///       <b>Suspicion (60% weight)</b> — the killer preferentially eliminates whoever
///       suspects them the most (stored in <c>candidate.Suspicion[killerId]</c>).
///       This mirrors the strategy injected into the murderer's AI system prompt.
///     </description>
///   </item>
///   <item>
///     <description>
///       <b>Dislike (30% weight)</b> — the killer is more likely to target gators they
///       personally dislike (negative Relations score toward that candidate).
///     </description>
///   </item>
///   <item>
///     <description>
///       <b>Random noise (up to +20 pts)</b> — prevents perfectly deterministic behaviour
///       and keeps the game unpredictable for observers.
///     </description>
///   </item>
/// </list>
/// </para>
/// </summary>
public class MurderService
{
    // Shared random instance — the game loop is single-threaded per session so this is safe.
    private static readonly Random Rng = new();

    /// <summary>
    /// Selects the murderer's victim for tonight and returns their alligator ID.
    /// Returns <c>null</c> if no valid selection can be made
    /// (e.g. killer is already dead, no living candidates remain).
    /// </summary>
    /// <param name="state">The current game state containing all alligators.</param>
    /// <returns>The <c>Id</c> of the chosen victim, or <c>null</c> if the murder cannot proceed.</returns>
    public int? SelectVictim(GameState state)
    {
        // Guard: can't murder if no killer is defined for this session.
        if (!state.MurdererId.HasValue) return null;

        var killer = state.Alligators.FirstOrDefault(a => a.Id == state.MurdererId.Value);

        // Guard: the killer must still be alive to act tonight.
        if (killer is null || !killer.IsAlive) return null;

        // Collect all living alligators except the murderer themselves.
        var candidates = state.Alligators.Where(a => a.IsAlive && a.Id != killer.Id).ToList();
        if (candidates.Count == 0) return null;

        // Score each candidate; highest scorer dies tonight.
        // Formula: suspicion * 0.6  +  dislike * 0.3  +  Rng.Next(0,20)
        //   suspicion = how much the candidate suspects the killer (from the candidate's dictionary)
        //   dislike   = negated relationship score — the killer prefers to kill those they hate
        //   noise     = random jitter to prevent perfectly predictable behaviour
        return candidates
            .OrderByDescending(c =>
            {
                var suspicion = c.Suspicion.GetValueOrDefault(killer.Id, 0);
                var dislike   = -killer.Relations.GetValueOrDefault(c.Id, 0);
                return suspicion * 0.6 + dislike * 0.3 + Rng.Next(20);
            })
            .First().Id;
    }
}
