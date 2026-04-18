using GatorGazing.Shared.Models;

namespace GatorGazing.AppLogic.Services;

/// <summary>
/// Handles murder victim selection based on suspicion and relationships.
/// </summary>
public class MurderService
{
    private static readonly Random Rng = new();

    public int? SelectVictim(GameState state)
    {
        if (!state.MurdererId.HasValue) return null;
        var killer = state.Alligators.FirstOrDefault(a => a.Id == state.MurdererId.Value);
        if (killer is null || !killer.IsAlive) return null;

        var candidates = state.Alligators.Where(a => a.IsAlive && a.Id != killer.Id).ToList();
        if (candidates.Count == 0) return null;

        return candidates
            .OrderByDescending(c =>
            {
                var suspicion = c.Suspicion.GetValueOrDefault(killer.Id, 0);
                var dislike = -killer.Relations.GetValueOrDefault(c.Id, 0);
                return suspicion * 0.6 + dislike * 0.3 + Rng.Next(20);
            })
            .First().Id;
    }
}
