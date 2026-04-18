using GatorGazing.Shared.DTOs;
using GatorGazing.Shared.Enums;
using GatorGazing.Shared.Models;
using GatorGazing.SK.Plugins;
using GatorGazing.SK.Prompts;
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.Agents;
using Microsoft.SemanticKernel.ChatCompletion;
using System.Collections.Concurrent;

namespace GatorGazing.SK.Agents;

/// <summary>
/// Manages Semantic Kernel agents for each alligator.
/// Each agent has its own ChatHistory (memory), personality prompt, and plugins.
/// </summary>
public class GatorAgentService
{
    private readonly Kernel _kernel;
    private readonly ConcurrentDictionary<int, ChatCompletionAgent> _agents = new();
    private readonly ConcurrentDictionary<int, ChatHistory> _histories = new();
    private readonly ConcurrentDictionary<int, List<MemoryEntry>> _memories = new();
    private readonly GameState _gameState;

    public GatorAgentService(Kernel kernel, GameState gameState)
    {
        _kernel = kernel;
        _gameState = gameState;
    }

    /// <summary>
    /// Initialize agents from spawn data.
    /// Populates GameState.Alligators and creates SK agents for each.
    /// </summary>
    public void InitializeFromSpawnData(IEnumerable<AlligatorSpawnData> spawnData)
    {
        _gameState.Alligators.Clear();
        _gameState.DeadIds.Clear();
        _gameState.DayNumber = 1;
        _gameState.Phase = Shared.Enums.GamePhase.Day;
        _gameState.MurdererId = null;

        foreach (var data in spawnData)
        {
            var personality = Enum.TryParse<Shared.Enums.Personality>(data.Personality, true, out var p)
                ? p : Shared.Enums.Personality.Cheerful;
            var gator = new Alligator
            {
                Id = data.Id,
                Name = data.Name,
                Personality = personality,
                IsMurderer = data.IsMurderer,
                IsLiar = data.IsLiar,
                IsAlive = true
            };
            _gameState.Alligators.Add(gator);
            if (data.IsMurderer) _gameState.MurdererId = data.Id;
        }

        InitializeAgents();
    }

    /// <summary>
    /// Initialize or re-initialize agents for all living alligators.
    /// </summary>
    public void InitializeAgents()
    {
        _agents.Clear();
        _histories.Clear();
        _memories.Clear();

        foreach (var gator in _gameState.Alligators.Where(a => a.IsAlive))
        {
            CreateAgent(gator);
        }
    }

    private ChatCompletionAgent CreateAgent(Alligator gator)
    {
        var systemPrompt = PersonalityPrompts.GetSystemPrompt(
            gator.Name, gator.Personality, gator.IsMurderer, gator.IsLiar);

        var agentKernel = _kernel.Clone();
        agentKernel.Plugins.AddFromObject(new SwampPlugin(
            gator.Id,
            id => _gameState.Alligators.FirstOrDefault(a => a.Id == id),
            id => _memories.GetOrAdd(id, _ => [])
        ));

        var agent = new ChatCompletionAgent
        {
            Name = gator.Name,
            Instructions = systemPrompt,
            Kernel = agentKernel,
        };

        _agents[gator.Id] = agent;
        _histories[gator.Id] = new ChatHistory();
        _memories.TryAdd(gator.Id, []);

        return agent;
    }

    /// <summary>
    /// Add a memory to an alligator's history (own action or observed event).
    /// </summary>
    public void AddMemory(int alligatorId, MemoryEntry memory)
    {
        var memories = _memories.GetOrAdd(alligatorId, _ => []);
        memories.Add(memory);

        // Also inject into chat history so the agent "remembers"
        if (_histories.TryGetValue(alligatorId, out var history))
        {
            history.AddSystemMessage($"[Memory - Day {memory.Day}] {memory.Detail}");
        }
    }

    /// <summary>
    /// Generate dialog for a 1:1 or small group conversation.
    /// </summary>
    public async Task<AgentDialogResponse> GenerateDialogAsync(AgentDialogRequest request)
    {
        if (!_agents.TryGetValue(request.AlligatorId, out var agent))
            return new AgentDialogResponse { AlligatorId = request.AlligatorId, Message = "..." };

        var history = _histories.GetOrAdd(request.AlligatorId, _ => new ChatHistory());

        var contextMsg = BuildContextMessage(request);
        history.AddUserMessage(contextMsg);

        var response = await GetFirstResponseAsync(agent, history);
        var message = response?.Content ?? "...";

        // Record this as a memory
        AddMemory(request.AlligatorId, new MemoryEntry
        {
            Day = _gameState.DayNumber,
            Type = request.DialogType,
            Detail = $"Said: \"{message}\" ({request.DialogType})",
            RelatedAlligatorId = request.TargetAlligatorId
        });

        return new AgentDialogResponse
        {
            AlligatorId = request.AlligatorId,
            Message = message
        };
    }

    /// <summary>
    /// Run a debate round where all agents respond to the current debate state.
    /// All agents "speak" based on the same context (simultaneous roundtable).
    /// </summary>
    public async Task<DebateRoundResponse> RunDebateRoundAsync(DebateRoundRequest request)
    {
        var response = new DebateRoundResponse();

        // Build shared context from previous messages
        var debateContext = "DEBATE ROUND " + request.RoundNumber + ":\n";
        if (request.VictimId.HasValue)
        {
            var victim = _gameState.Alligators.FirstOrDefault(a => a.Id == request.VictimId);
            debateContext += $"{victim?.Name ?? "Someone"} was murdered last night. Who did it?\n";
        }
        foreach (var msg in request.PreviousMessages)
        {
            debateContext += $"{msg.SpeakerName}: {msg.Message}\n";
        }

        // All agents respond simultaneously
        var tasks = request.ParticipantIds.Select(async id =>
        {
            var dialogRequest = new AgentDialogRequest
            {
                AlligatorId = id,
                DialogType = "debate",
                ParticipantIds = request.ParticipantIds,
                Context = debateContext
            };
            return await GenerateDialogAsync(dialogRequest);
        });

        var results = await Task.WhenAll(tasks);
        response.Responses.AddRange(results);
        return response;
    }

    /// <summary>
    /// Get an agent's vote decision. Votes happen one at a time, clockwise.
    /// Each voter sees all previous votes.
    /// </summary>
    public async Task<VoteResponse> GetVoteAsync(VoteRequest request)
    {
        if (!_agents.TryGetValue(request.AlligatorId, out var agent))
            return new VoteResponse { AlligatorId = request.AlligatorId, VoteForId = request.CandidateIds.First() };

        var history = _histories.GetOrAdd(request.AlligatorId, _ => new ChatHistory());

        var candidates = request.CandidateIds
            .Select(id => _gameState.Alligators.FirstOrDefault(a => a.Id == id))
            .Where(a => a is not null)
            .Select(a => $"{a!.Name} (ID:{a.Id})")
            .ToList();

        var prompt = $"""
            VOTE TIME. You must vote to execute one alligator. 
            Debate summary: {request.DebateSummary}
            Candidates: {string.Join(", ", candidates)}
            
            Respond with ONLY the ID number of who you vote for, followed by a brief reason.
            Format: ID|reason
            Example: 3|They were acting suspicious near the victim's house
            """;

        history.AddUserMessage(prompt);
        var response = await GetFirstResponseAsync(agent, history);
        var content = response?.Content ?? $"{request.CandidateIds.First()}|No strong opinion";

        // Parse response
        var parts = content.Split('|', 2);
        var voteForId = request.CandidateIds.First();
        var reasoning = content;

        if (parts.Length >= 2 && int.TryParse(parts[0].Trim(), out var parsedId)
            && request.CandidateIds.Contains(parsedId))
        {
            voteForId = parsedId;
            reasoning = parts[1].Trim();
        }

        AddMemory(request.AlligatorId, new MemoryEntry
        {
            Day = _gameState.DayNumber,
            Type = "vote",
            Detail = $"Voted for {_gameState.Alligators.FirstOrDefault(a => a.Id == voteForId)?.Name ?? "unknown"}: {reasoning}",
            RelatedAlligatorId = voteForId
        });

        return new VoteResponse
        {
            AlligatorId = request.AlligatorId,
            VoteForId = voteForId,
            Reasoning = reasoning
        };
    }

    private string BuildContextMessage(AgentDialogRequest request)
    {
        var gator = _gameState.Alligators.FirstOrDefault(a => a.Id == request.AlligatorId);
        var sb = new System.Text.StringBuilder();

        sb.AppendLine($"[Day {_gameState.DayNumber}, Phase: {_gameState.Phase}]");

        if (request.TargetAlligatorId.HasValue)
        {
            var target = _gameState.Alligators.FirstOrDefault(a => a.Id == request.TargetAlligatorId);
            if (target is not null)
            {
                var rel = gator?.Relations.GetValueOrDefault(target.Id, 0) ?? 0;
                var susp = gator?.Suspicion.GetValueOrDefault(target.Id, 0) ?? 0;
                sb.AppendLine($"You are talking to {target.Name}. You feel {DescribeRelation(rel)} toward them. Suspicion: {susp:F0}/100.");
            }
        }

        if (request.Context is not null)
            sb.AppendLine(request.Context);

        // Type-specific instructions
        switch (request.DialogType)
        {
            case "conversation":
                sb.AppendLine("You are having a casual conversation. Say something natural — ask a question, share a story, react to what they said, or make small talk about swamp life. Keep it SHORT (1-2 sentences).");
                break;
            case "thought":
                sb.AppendLine("Generate an inner thought. This is what you're privately thinking right now — it can contradict what you say out loud. Be honest with yourself. Keep it SHORT (1 sentence).");
                break;
            case "accusation":
                sb.AppendLine("You are accusing someone during the town debate. State who you suspect and why. Be passionate and in-character. Keep it SHORT (1-2 sentences).");
                break;
            case "defense":
                sb.AppendLine("You are defending yourself during the debate — someone suspects you. Deny it convincingly. Keep it SHORT (1-2 sentences).");
                break;
            case "debate":
                sb.AppendLine("You are in the debate phase. Argue your case — accuse someone, back up a claim, or defend yourself. Stay in character. Keep it SHORT (1-2 sentences).");
                break;
            case "mourn":
                sb.AppendLine("Someone was killed last night. React with grief, shock, anger, or suspicion — whatever fits your personality. Keep it SHORT (1-2 sentences).");
                break;
            case "dawn_thought":
                sb.AppendLine("It's dawn and someone was murdered. Generate a private inner thought about the murder. If you ARE the murderer, think something secretly satisfied or calculating. Keep it SHORT (1 sentence).");
                break;
            case "bluff":
                sb.AppendLine("You are the murderer. Say something during a casual conversation that deflects suspicion — act innocent, point fingers elsewhere, or build trust. Keep it SHORT (1-2 sentences).");
                break;
            case "opinion":
                sb.AppendLine("Share your opinion about another alligator with the person you're talking to. Be natural — praise them or badmouth them based on how you really feel. Keep it SHORT (1-2 sentences).");
                break;
            case "guarded":
                sb.AppendLine("You are talking to someone you don't trust or dislike. Be curt, evasive, or passive-aggressive. Keep it SHORT (1 sentence).");
                break;
            case "execute_plea":
                sb.AppendLine("You have been voted to be executed. Beg for your life, protest your innocence, or accept your fate — whatever fits your personality. Keep it SHORT (1-2 sentences).");
                break;
            case "execute_react":
                sb.AppendLine("Someone is being walked to the centre to be executed. React as a bystander — relief, doubt, sadness, or grim satisfaction. Keep it SHORT (1 sentence).");
                break;
            case "vote_announce":
                sb.AppendLine("You are casting your vote. Announce who you're voting for and give a brief reason. Keep it SHORT (1 sentence).");
                break;
            case "persuade":
                sb.AppendLine("You are trying to convince others to vote for someone you suspect. Be persuasive and in-character. Keep it SHORT (1-2 sentences).");
                break;
            default:
                sb.AppendLine($"Generate a {request.DialogType} message. Keep it SHORT (1-2 sentences max).");
                break;
        }

        return sb.ToString();
    }

    private static string DescribeRelation(double val) => val switch
    {
        >= 60 => "very positive",
        >= 20 => "positive",
        >= -20 => "neutral",
        >= -60 => "negative",
        _ => "very negative"
    };

    private static async Task<ChatMessageContent?> GetFirstResponseAsync(ChatCompletionAgent agent, ChatHistory history)
    {
        await foreach (var msg in agent.InvokeAsync(history))
        {
            return msg;
        }
        return null;
    }
}
