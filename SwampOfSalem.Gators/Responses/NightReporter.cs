using SwampOfSalem.Gators.Phrases;
using SwampOfSalem.Gators.Thinking;
using SwampOfSalem.Shared.DTOs;
using SwampOfSalem.Shared.Enums;
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

            // Prepend mood flavour to reason when an active mood produces relevant phrasing
            if (gator.Mood != Mood.Normal)
            {
                var moodThoughtPhrases = MoodPhraseBanks.GetThought(gator.Mood);
                if (moodThoughtPhrases.Length > 0 && rng.Next(2) == 0)
                {
                    var moodLine = ThoughtEngine.Pick(moodThoughtPhrases, rng);
                    string victimName = gameState.Alligators.FirstOrDefault(a => !a.IsAlive)?.Name ?? "them";
                    reason = ThoughtEngine.Substitute(moodLine, gator.Name, suspectName, suspectName, victimName, null)
                             + " " + reason;
                }
            }

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
