using SwampOfSalem.Shared.Models;
using Microsoft.SemanticKernel;
using System.ComponentModel;

namespace SwampOfSalem.SK.Plugins;

/// <summary>
/// SK plugin that provides game state information to agents.
/// Agents can call these functions to query relationships, memories, and suspicion.
/// </summary>
public class SwampPlugin
{
    private readonly Func<int, Alligator?> _getAlligator;
    private readonly Func<int, List<MemoryEntry>> _getMemories;
    private readonly int _agentId;

    public SwampPlugin(int agentId, Func<int, Alligator?> getAlligator, Func<int, List<MemoryEntry>> getMemories)
    {
        _agentId = agentId;
        _getAlligator = getAlligator;
        _getMemories = getMemories;
    }

    [KernelFunction, Description("Get how you feel about another alligator (-100 hate to +100 love)")]
    public double GetRelationship([Description("The other alligator's ID")] int otherId)
    {
        var me = _getAlligator(_agentId);
        return me?.Relations.GetValueOrDefault(otherId, 0) ?? 0;
    }

    [KernelFunction, Description("Get your suspicion level of another alligator (0-100)")]
    public double GetSuspicion([Description("The other alligator's ID")] int otherId)
    {
        var me = _getAlligator(_agentId);
        return me?.Suspicion.GetValueOrDefault(otherId, 0) ?? 0;
    }

    [KernelFunction, Description("Get your recent memories")]
    public string GetRecentMemories()
    {
        var memories = _getMemories(_agentId);
        if (memories.Count == 0) return "No memories yet.";
        return string.Join("\n", memories.TakeLast(20).Select(m => $"[Day {m.Day}] {m.Detail}"));
    }

    [KernelFunction, Description("Get information about another alligator")]
    public string GetAlligatorInfo([Description("The alligator's ID")] int id)
    {
        var a = _getAlligator(id);
        if (a is null) return "Unknown alligator.";
        return $"{a.Name} (ID:{a.Id}) - {a.Personality}, Alive:{a.IsAlive}";
    }
}
