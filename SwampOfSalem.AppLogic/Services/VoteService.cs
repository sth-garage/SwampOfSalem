using SwampOfSalem.Shared.Models;

namespace SwampOfSalem.AppLogic.Services;

/// <summary>
/// Manages sequential clockwise voting, tallying, and execution.
/// </summary>
public class VoteService
{
    public List<int> EstablishVoteOrder(GameState state)
    {
        state.VoteOrder = state.Alligators
            .Where(a => a.IsAlive)
            .OrderBy(a => a.HomeIndex)
            .Select(a => a.Id)
            .ToList();
        state.VoteIndex = 0;
        state.VoteResults.Clear();
        return state.VoteOrder;
    }

    public bool RecordVote(GameState state, int voterId, int targetId)
    {
        state.VoteResults.TryAdd(targetId, 0);
        state.VoteResults[targetId]++;
        state.VoteIndex++;
        return state.VoteIndex >= state.VoteOrder.Count;
    }

    public int? TallyVotes(GameState state)
    {
        if (state.VoteResults.Count == 0) return null;
        var max = state.VoteResults.Max(kv => kv.Value);
        var topVoted = state.VoteResults.Where(kv => kv.Value == max).ToList();
        return topVoted.Count > 1 ? null : topVoted[0].Key;
    }

    public void Execute(GameState state, int alligatorId)
    {
        var gator = state.Alligators.FirstOrDefault(a => a.Id == alligatorId);
        if (gator is not null)
        {
            gator.IsAlive = false;
            state.DeadIds.Add(alligatorId);
        }
    }
}
