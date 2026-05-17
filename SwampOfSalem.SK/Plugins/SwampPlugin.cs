using SwampOfSalem.Shared.Models;
using Microsoft.SemanticKernel;
using System.ComponentModel;

namespace SwampOfSalem.SK.Plugins;

/// <summary>
/// Semantic Kernel native plugin that exposes live game-state data to alligator agents.
/// <para>
/// Each alligator's cloned <see cref="Kernel"/> instance has its own <c>SwampPlugin</c>
/// registered, scoped to that specific <c>agentId</c>. This means every agent queries
/// their <b>own</b> relationship and suspicion values — not a shared global view.
/// </para>
/// <para>
/// SK agents can call these methods by name during inference (function calling /
/// tool use mode). The <c>[KernelFunction]</c> attribute registers a method as a
/// callable tool, and the <c>[Description]</c> attributes provide the tool
/// descriptions sent to the LLM in the function-calling schema.
/// </para>
/// <para>
/// Pattern note: dependencies are injected via <see cref="Func{T,TResult}"/> delegates
/// rather than direct service references so the plugin can be lightweight and testable
/// without a full DI container.
/// </para>
/// </summary>
public class SwampPlugin
{
    private readonly Func<int, Alligator?> _getAlligator;
    private readonly Func<int, List<MemoryEntry>> _getMemories;
    private readonly int _agentId;

    /// <summary>
    /// Initialises the plugin for a specific alligator agent.
    /// </summary>
    /// <param name="agentId">The ID of the alligator this plugin instance belongs to.</param>
    /// <param name="getAlligator">Delegate to fetch any alligator by ID from the game state.</param>
    /// <param name="getMemories">Delegate to fetch the in-process memory list for any alligator ID.</param>
    public SwampPlugin(int agentId, Func<int, Alligator?> getAlligator, Func<int, List<MemoryEntry>> getMemories)
    {
        _agentId = agentId;
        _getAlligator = getAlligator;
        _getMemories = getMemories;
    }

    /// <summary>
    /// Returns how this agent feels about another alligator on the [-100, +100] relationship scale.
    /// The LLM can call this to ground its dialogue in the actual numerical relationship value,
    /// rather than relying solely on what was injected into chat history.
    /// </summary>
    /// <param name="otherId">The ID of the other alligator.</param>
    /// <returns>Relationship score: -100 = deep hatred, 0 = neutral, +100 = strong bond.</returns>
    [KernelFunction, Description("Get how you feel about another alligator (-100 hate to +100 love)")]
    public double GetRelationship([Description("The other alligator's ID")] int otherId)
    {
        var me = _getAlligator(_agentId);
        return me?.Relations.GetValueOrDefault(otherId, 0) ?? 0;
    }

    /// <summary>
    /// Returns this agent's current suspicion level of another alligator (0–100 scale).
    /// A value above <c>CONVICTION_THRESHOLD</c> (55) means this agent will accuse and
    /// vote against that suspect during the Debate/Vote phases.
    /// </summary>
    /// <param name="otherId">The ID of the suspected alligator.</param>
    /// <returns>Suspicion score from 0 (not suspicious) to 100 (certain they are the murderer).</returns>
    [KernelFunction, Description("Get your suspicion level of another alligator (0-100)")]
    public double GetSuspicion([Description("The other alligator's ID")] int otherId)
    {
        var me = _getAlligator(_agentId);
        return me?.Suspicion.GetValueOrDefault(otherId, 0) ?? 0;
    }

    /// <summary>
    /// Returns this agent's most recent memories as a formatted multi-line string.
    /// Up to 20 entries are returned, formatted as <c>[Day N] detail</c>.
    /// The LLM uses this to recall what happened during the simulation so it can
    /// make contextually grounded decisions during debate and voting.
    /// </summary>
    /// <returns>Formatted memory string, or <c>"No memories yet."</c> if empty.</returns>
    [KernelFunction, Description("Get your recent memories")]
    public string GetRecentMemories()
    {
        var memories = _getMemories(_agentId);
        if (memories.Count == 0) return "No memories yet.";
        return string.Join("\n", memories.TakeLast(20).Select(m => $"[Day {m.Day}] {m.Detail}"));
    }

    /// <summary>
    /// Returns basic publicly-observable information about another alligator.
    /// Useful when the agent needs to describe or refer to someone during dialogue.
    /// </summary>
    /// <param name="id">The ID of the alligator to look up.</param>
    /// <returns>A short descriptor string, or <c>"Unknown alligator."</c> if not found.</returns>
    [KernelFunction, Description("Get information about another alligator")]
    public string GetAlligatorInfo([Description("The alligator's ID")] int id)
    {
        var a = _getAlligator(id);
        if (a is null) return "Unknown alligator.";
        return $"{a.Name} (ID:{a.Id}) - {a.Personality}, Alive:{a.IsAlive}";
    }

}