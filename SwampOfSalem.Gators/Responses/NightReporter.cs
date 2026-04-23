using SwampOfSalem.Gators.Thinking;
using SwampOfSalem.Shared.DTOs;
using SwampOfSalem.Shared.Models;

namespace SwampOfSalem.Gators.Responses;

/// <summary>
/// Generates night-time reflections for all living alligators.
/// Each gator identifies their top suspect, produces a reasoning sentence,
/// and generates a private inner thought — all without any LLM calls.
/// </summary>
public static class NightReporter
{
    /// <summary>
    /// Builds a <see cref="NightReportResponse"/> for the supplied list of living IDs.
    /// </summary>
    public static NightReportResponse Report(
        List<int> aliveIds,
        GameState gameState,
        Dictionary<int, List<MemoryEntry>> memories,
        Random rng)
    {
        var entries = new List<NightReportEntry>();

        foreach (var id in aliveIds)
        {
            var gator = gameState.Alligators.FirstOrDefault(a => a.Id == id);
            if (gator is null) continue;

            var mem = memories.GetValueOrDefault(id, []);

            // Determine top suspect and reason
            var (suspectId, reason) = SuspicionReasoner.Reason(gator, gameState, mem, rng);
            string? suspectName = suspectId.HasValue
                ? gameState.Alligators.FirstOrDefault(a => a.Id == suspectId.Value)?.Name
                : null;

            // Generate inner thought
            string thought = ThoughtEngine.Generate(gator, gameState, rng, suspectId);

            entries.Add(new NightReportEntry
            {
                AlligatorId     = gator.Id,
                AlligatorName   = gator.Name,
                TopSuspectId    = suspectId,
                TopSuspectName  = suspectName,
                SuspicionReason = reason,
                InnerThought    = thought,
            });
        }

        return new NightReportResponse { Entries = entries };
    }
}
