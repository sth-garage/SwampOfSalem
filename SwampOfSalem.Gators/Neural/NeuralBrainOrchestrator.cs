using System.Collections.Concurrent;
using SwampOfSalem.Shared.Models;

namespace SwampOfSalem.Gators.Neural;

/// <summary>
/// Manages the lifecycle of one <see cref="GatorBrainThread"/> per living alligator.
/// <para>
/// <b>Responsibilities:</b>
/// <list type="bullet">
///   <item><description>Spin up and shut down per-gator background threads.</description></item>
///   <item><description>Route <see cref="InterGatorSignal"/> messages between threads.</description></item>
///   <item><description>Apply accumulated neural outputs to the live game model on the
///        server request thread (the only thread that writes to <see cref="Alligator"/>).</description></item>
///   <item><description>Deliver reward signals back to the correct thread after outcomes
///        are known (e.g. correct vote, alive after night).</description></item>
/// </list>
/// </para>
/// <para>
/// <b>Threading model:</b>
/// <list type="bullet">
///   <item><description>One <see cref="GatorBrainThread"/> per living alligator runs in the background.</description></item>
///   <item><description>Those threads only READ game state; they never write.</description></item>
///   <item><description><see cref="ApplyOutputs"/> must be called from the server request thread
///        before vote/conversation decisions, and writes the neural suggestions to the gator model.</description></item>
/// </list>
/// </para>
/// </summary>
public sealed class NeuralBrainOrchestrator : IDisposable
{
    private readonly ConcurrentDictionary<int, GatorBrainThread> _threads = new();
    private readonly GameState _gameState;

    public NeuralBrainOrchestrator(GameState gameState)
    {
        _gameState = gameState;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Stops all existing threads, then creates and starts one thread per living alligator.
    /// Call this from <c>GatorBrainService.InitializeFromSpawnData</c> after gators are loaded.
    /// </summary>
    public void Restart(IEnumerable<Alligator> gators, ConcurrentDictionary<int, List<MemoryEntry>> memories)
    {
        StopAll();
        _threads.Clear();

        foreach (var gator in gators.Where(a => a.IsAlive))
        {
            var mem = memories.GetOrAdd(gator.Id, _ => []);
            var thread = new GatorBrainThread(gator.Id, gator, _gameState, mem);

            // Wire signal routing: when a thread broadcasts, we deliver the signal here
            thread.OnBroadcastSignal = RouteSignal;

            _threads[gator.Id] = thread;
        }

        // Start all threads together to minimise timing skew
        foreach (var t in _threads.Values)
            t.Start();

        Console.WriteLine(
            $"[NeuralOrchestrator] Started {_threads.Count} gator brain threads.");
    }

    /// <summary>Stops all threads. Blocks up to 500 ms per thread.</summary>
    public void StopAll()
    {
        foreach (var t in _threads.Values)
            t.Stop();
    }

    // ── Output application ────────────────────────────────────────────────────

    /// <summary>
    /// Reads the latest output from every thread and applies it to the live gator model.
    /// <para>
    /// Call this from the server request thread before any decision-making code
    /// (vote, conversation selection, suspicion updates). This is the ONE place where
    /// neural suggestions are written into the shared <see cref="Alligator"/> state.
    /// </para>
    /// </summary>
    public void ApplyOutputs()
    {
        foreach (var (id, thread) in _threads)
        {
            var output = thread.LatestOutput;
            if (output is null) continue;

            var gator = _gameState.Alligators.FirstOrDefault(a => a.Id == id && a.IsAlive);
            if (gator is null) continue;

            NeuralOutput.Apply(output, gator, _gameState);
        }
    }

    // ── Reward delivery ───────────────────────────────────────────────────────

    /// <summary>
    /// Delivers a reward signal to a specific gator's thread.
    /// <para>
    /// Positive reward (+1): the gator made a decision aligned with the eventual outcome
    /// (e.g. voted for the murderer, survived the night, correctly identified a threat).
    /// Negative reward (-1): the gator's decision was misaligned.
    /// </para>
    /// </summary>
    public void Reward(int gatorId, float reward)
    {
        if (_threads.TryGetValue(gatorId, out var thread))
            thread.QueueReward(reward);
    }

    /// <summary>
    /// Awards a positive reward to every gator who voted correctly this round
    /// (i.e. voted for the actual murderer), and a negative reward to those who didn't.
    /// Call this after an execution outcome is known.
    /// </summary>
    public void RewardVoteOutcome(int executedId, int? murdererId)
    {
        bool correctExecution = executedId == murdererId;

        foreach (var (id, thread) in _threads)
        {
            var mem = thread.LatestOutput; // just used as a proxy for "gator exists"
            if (mem is null) continue;

            // A reward of ±1 is applied to everyone
            thread.QueueReward(correctExecution ? +1f : -0.5f);
        }
    }

    /// <summary>
    /// Rewards a gator for surviving the night (+0.5).
    /// Punishes the murderer slightly for having been tracked (-0.3, because their
    /// cover is gradually being blown even if they survive).
    /// </summary>
    public void RewardNightSurvival(IEnumerable<int> survivorIds, int? murdererId)
    {
        foreach (var id in survivorIds)
        {
            float r = id == murdererId ? -0.3f : +0.5f;
            Reward(id, r);
        }
    }

    // ── Signal routing ────────────────────────────────────────────────────────

    /// <summary>
    /// Routes an outbound <see cref="InterGatorSignal"/> to the target gator's
    /// <see cref="GatorBrainThread.InboundChannel"/>. Called on the source thread.
    /// </summary>
    private void RouteSignal(InterGatorSignal signal)
    {
        if (signal.TargetId == -1)
        {
            // Broadcast to all other threads
            foreach (var (id, thread) in _threads)
            {
                if (id != signal.SourceId)
                    thread.InboundChannel.Writer.TryWrite(signal);
            }
        }
        else if (_threads.TryGetValue(signal.TargetId, out var target))
        {
            target.InboundChannel.Writer.TryWrite(signal);
        }
    }

    // ── Diagnostics ───────────────────────────────────────────────────────────

    /// <summary>
    /// Returns a per-gator diagnostic string for logging / debug endpoints.
    /// </summary>
    public IEnumerable<string> GetStats() =>
        _threads.Values.Select(t => t.GetStats());

    // ── Dispose ───────────────────────────────────────────────────────────────

    public void Dispose()
    {
        StopAll();
        foreach (var t in _threads.Values)
            t.Dispose();
        _threads.Clear();
    }
}
