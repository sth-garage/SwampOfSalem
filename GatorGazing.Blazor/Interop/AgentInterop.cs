using GatorGazing.Shared.DTOs;
using GatorGazing.Shared.Models;
using GatorGazing.SK.Agents;
using Microsoft.JSInterop;

namespace GatorGazing.Blazor.Interop;

/// <summary>
/// JS-callable interop bridge. The JS simulation calls these methods
/// to get AI-generated dialog, thoughts, debate messages, and votes.
/// Calls GatorAgentService directly (in-process, no HTTP).
/// </summary>
public class AgentInterop
{
    private readonly GatorAgentService _agents;

    public AgentInterop(GatorAgentService agents)
    {
        _agents = agents;
    }

    /// <summary>
    /// Called by JS after spawnPeople() to populate GameState and initialize SK agents.
    /// </summary>
    [JSInvokable]
    public Task InitializeAgents(AlligatorSpawnData[] alligators)
    {
        _agents.InitializeFromSpawnData(alligators);
        return Task.CompletedTask;
    }

    [JSInvokable]
    public async Task<string> GetAgentDialog(int alligatorId, string dialogType, int? targetId, string? context)
    {
        var request = new AgentDialogRequest
        {
            AlligatorId = alligatorId,
            DialogType = dialogType,
            TargetAlligatorId = targetId,
            Context = context
        };
        var response = await _agents.GenerateDialogAsync(request);
        return response.Message;
    }

    [JSInvokable]
    public async Task<string> GetAgentThought(int alligatorId)
    {
        var request = new AgentDialogRequest
        {
            AlligatorId = alligatorId,
            DialogType = "thought"
        };
        var response = await _agents.GenerateDialogAsync(request);
        return response.Message;
    }

    [JSInvokable]
    public async Task<int> GetAgentVote(int alligatorId, int[] candidateIds, string debateSummary)
    {
        var request = new VoteRequest
        {
            AlligatorId = alligatorId,
            CandidateIds = [.. candidateIds],
            DebateSummary = debateSummary
        };
        var response = await _agents.GetVoteAsync(request);
        return response.VoteForId;
    }

    [JSInvokable]
    public Task AddAgentMemory(int alligatorId, int day, string type, string detail, int? relatedId)
    {
        _agents.AddMemory(alligatorId, new MemoryEntry
        {
            Day = day,
            Type = type,
            Detail = detail,
            RelatedAlligatorId = relatedId
        });
        return Task.CompletedTask;
    }
}
