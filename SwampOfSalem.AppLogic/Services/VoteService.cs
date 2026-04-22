using SwampOfSalem.Shared.Models;

namespace SwampOfSalem.AppLogic.Services;

/// <summary>
/// Manages the sequential clockwise voting ceremony during the Vote phase.
/// <para>
/// Usage sequence:
/// <list type="number">
///   <item><description>Call <see cref="EstablishVoteOrder"/> to lock in the clockwise voter sequence.</description></item>
///   <item><description>For each voter, the frontend calls <c>POST /api/agent/vote</c> for the AI decision, then calls <see cref="RecordVote"/>.</description></item>
///   <item><description>When <see cref="RecordVote"/> returns <c>true</c> (all votes in), call <see cref="TallyVotes"/>.</description></item>
///   <item><description>If a clear winner exists (no tie), call <see cref="Execute"/> to eliminate them.</description></item>
/// </list>
/// </para>
/// </summary>
public class VoteService
{
    /// <summary>
    /// Establishes the clockwise vote order for the current round.
    /// Clears any previous round's vote results and resets the index to 0.
    /// </summary>
    /// <param name="state">The game state to initialise vote data on.</param>
    /// <returns>Ordered list of living alligator IDs in clockwise voting sequence.</returns>
    public List<int> EstablishVoteOrder(GameState state)
    {
        // Sort by HomeIndex (culde-sac slot index) to produce a consistent clockwise order.
        state.VoteOrder = state.Alligators
            .Where(a => a.IsAlive)
            .OrderBy(a => a.HomeIndex)
            .Select(a => a.Id)
            .ToList();

        state.VoteIndex = 0;       // Reset cursor to the first voter.
        state.VoteResults.Clear(); // Wipe any results from a previous round.
        return state.VoteOrder;
    }

    /// <summary>
    /// Records one vote from <paramref name="voterId"/> targeting <paramref name="targetId"/>,
    /// increments the tally and advances the voter cursor.
    /// </summary>
    /// <param name="state">Current game state.</param>
    /// <param name="voterId">ID of the gator casting the vote (used by callers for logging).</param>
    /// <param name="targetId">ID of the gator being voted against.</param>
    /// <returns>
    /// <c>true</c> when all voters have cast their vote (voting complete);
    /// <c>false</c> if more voters remain.
    /// </returns>
    public bool RecordVote(GameState state, int voterId, int targetId)
    {
        // Initialise the vote tally entry for this target if it doesn't exist yet.
        state.VoteResults.TryAdd(targetId, 0);
        state.VoteResults[targetId]++;
        state.VoteIndex++;

        // Signal completion once every living gator has voted.
        return state.VoteIndex >= state.VoteOrder.Count;
    }

    /// <summary>
    /// Tallies all votes and returns the ID of the alligator with the most votes.
    /// Returns <c>null</c> on a tie — no execution occurs when the town is split.
    /// </summary>
    /// <param name="state">Game state containing the current vote results.</param>
    /// <returns>The winning candidate's ID, or <c>null</c> on a tie.</returns>
    public int? TallyVotes(GameState state)
    {
        if (state.VoteResults.Count == 0) return null;

        var max      = state.VoteResults.Max(kv => kv.Value);
        var topVoted = state.VoteResults.Where(kv => kv.Value == max).ToList();

        // More than one candidate with the maximum = tie; no one is executed.
        return topVoted.Count > 1 ? null : topVoted[0].Key;
    }

    /// <summary>
    /// Eliminates the specified alligator by marking them dead and adding
    /// their ID to <see cref="GameState.DeadIds"/>.
    /// Safe to call with an unknown ID — does nothing if not found.
    /// </summary>
    /// <param name="state">Current game state to mutate.</param>
    /// <param name="alligatorId">ID of the alligator to execute.</param>
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
