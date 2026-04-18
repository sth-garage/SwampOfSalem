using SwampOfSalem.Shared.DTOs;
using SwampOfSalem.Shared.Enums;
using SwampOfSalem.Shared.Models;
using SwampOfSalem.SK.Plugins;
using SwampOfSalem.SK.Prompts;
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.Agents;
using Microsoft.SemanticKernel.ChatCompletion;
using System.Collections.Concurrent;

namespace SwampOfSalem.SK.Agents;

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
    private readonly ConcurrentDictionary<int, List<string>> _pendingTopicOpinions = new();
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

            // Inject topic opinions into this agent's system context so it can reference them naturally
            if (data.TopicOpinions.Count > 0)
            {
                var opinionLines = data.TopicOpinions
                    .Select(kv =>
                    {
                        var label = kv.Value >= 60 ? "loves" : kv.Value >= 20 ? "likes" : kv.Value >= -20 ? "is neutral about" : kv.Value >= -60 ? "dislikes" : "hates";
                        return $"{label} {kv.Key} ({kv.Value:+0;-0})";                    })
                    .ToList();
                // Defer injection until after CreateAgent so the history exists
                _pendingTopicOpinions[data.Id] = opinionLines;
            }
        }

        InitializeAgents();

        // Inject topic opinions into each agent's chat history
        foreach (var (id, lines) in _pendingTopicOpinions)
        {
            if (_histories.TryGetValue(id, out var hist))
                hist.AddSystemMessage($"[Your opinions] You: {string.Join("; ", lines)}.");
        }
        _pendingTopicOpinions.Clear();
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
            return new AgentDialogResponse { AlligatorId = request.AlligatorId, Message = "[error: agent not found]" };

        var history = _histories.GetOrAdd(request.AlligatorId, _ => new ChatHistory());

        var contextMsg = BuildContextMessage(request);
        history.AddUserMessage(contextMsg);

        var response = await GetFirstResponseAsync(agent, history);
        var raw = response?.Content ?? "{}";

        // Parse JSON {spoken, thought} from the LLM response
        string spoken = "empty/null";
        string? thought = null;
        try
        {
            var jsonText = raw.Trim();
            // Strip markdown code fences
            if (jsonText.StartsWith("```"))
            {
                jsonText = System.Text.RegularExpressions.Regex.Replace(jsonText, @"^```\w*\s*", "");
                jsonText = System.Text.RegularExpressions.Regex.Replace(jsonText, @"\s*```$", "");
            }
            // Try to find a JSON object embedded in the response
            var braceStart = jsonText.IndexOf('{');
            var braceEnd = jsonText.LastIndexOf('}');
            if (braceStart >= 0 && braceEnd > braceStart)
            {
                jsonText = jsonText[braceStart..(braceEnd + 1)];
            }
            using var doc = System.Text.Json.JsonDocument.Parse(jsonText);
            spoken = doc.RootElement.TryGetProperty("spoken", out var s) ? (string.IsNullOrEmpty(s.GetString()) ? "<silence>" : s.GetString()!) : "empty/null";
            thought = doc.RootElement.TryGetProperty("thought", out var t) ? t.GetString() : null;
        }
        catch
        {
            // Fallback: extract just the first non-empty line as spoken text
            var lines = raw.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            spoken = lines.FirstOrDefault(l => l.Length > 0 && !l.StartsWith("**") && !l.StartsWith("{")) ?? raw;
            // Strip leading name prefix like "Gnarla: " or quotes
            spoken = System.Text.RegularExpressions.Regex.Replace(spoken, @"^\w+:\s*", "");
            spoken = spoken.Trim('"', '\u201C', '\u201D');
            if (string.IsNullOrWhiteSpace(spoken)) spoken = "empty/null";
        }

        // Record this as a memory
        AddMemory(request.AlligatorId, new MemoryEntry
        {
            Day = _gameState.DayNumber,
            Type = request.DialogType,
            Detail = $"Said: \"{spoken}\" ({request.DialogType})",
            RelatedAlligatorId = request.TargetAlligatorId
        });

        return new AgentDialogResponse
        {
            AlligatorId = request.AlligatorId,
            Message = spoken,
            Thought = thought
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

        var aliveCount = _gameState.Alligators.Count(a => a.IsAlive);
        var deadCount = _gameState.Alligators.Count(a => !a.IsAlive);
        sb.AppendLine($"[Day {_gameState.DayNumber}, Phase: {_gameState.Phase}, Alive: {aliveCount}, Dead: {deadCount}]");

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
            case "introduction":
                sb.AppendLine("You are meeting this alligator for the very FIRST time. Introduce yourself by name, say something about who you are or what you like, and ask them a genuine question. Keep it natural and SHORT (1-2 sentences).");
                break;
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
                sb.AppendLine("Share your opinion about another alligator with the gator you're talking to. Be natural — praise them or badmouth them based on how you really feel. Keep it SHORT (1-2 sentences).");
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

        sb.AppendLine("REMEMBER: Reply with ONLY a JSON object: {\"spoken\": \"...\", \"thought\": \"...\"}");

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

    /// <summary>
    /// Generate a complete back-and-forth conversation between two alligators in a single AI call.
    /// The initiator's opening line is provided; the AI fills in all subsequent turns (up to maxTurns).
    /// </summary>
    public async Task<ChatConversationResponse> GenerateFullConversationAsync(ChatConversationRequest request)
    {
        var initiator = _gameState.Alligators.FirstOrDefault(a => a.Id == request.InitiatorId);
        var responder = _gameState.Alligators.FirstOrDefault(a => a.Id == request.ResponderId);

        if (initiator is null || responder is null)
            return new ChatConversationResponse { InitiatorId = request.InitiatorId, ResponderId = request.ResponderId };

        // Use the chat completion service directly for a single structured call
        var chatService = _kernel.GetRequiredService<IChatCompletionService>();

        var initiatorPrompt = PersonalityPrompts.GetSystemPrompt(
            initiator.Name, initiator.Personality, initiator.IsMurderer, initiator.IsLiar);
        var responderPrompt = PersonalityPrompts.GetSystemPrompt(
            responder.Name, responder.Personality, responder.IsMurderer, responder.IsLiar);

        var rel_ir = initiator.Relations.GetValueOrDefault(responder.Id, 0);
        var rel_ri = responder.Relations.GetValueOrDefault(initiator.Id, 0);

        var maxTurns = Math.Clamp(request.MaxTurns, 1, 9);

        var systemPrompt = $$"""
            You are a creative writer generating a short swamp alligator conversation.
            There are two alligators:
            - {{initiator.Name}} (ID:{{initiator.Id}}): {{initiatorPrompt}}
              Feels {{DescribeRelation(rel_ir)}} toward {{responder.Name}}.
            - {{responder.Name}} (ID:{{responder.Id}}): {{responderPrompt}}
              Feels {{DescribeRelation(rel_ri)}} toward {{initiator.Name}}.

            {{(request.Context is not null ? $"Context: {request.Context}" : string.Empty)}}

            {{initiator.Name}} has already said: "{{request.OpeningLine}}"

            Continue the conversation for up to {{maxTurns}} total turns (including the opening line already spoken).
            Alternate between {{responder.Name}} and {{initiator.Name}}, starting with {{responder.Name}}.
            Keep each line SHORT (1-2 sentences), natural, and in-character.

            Respond with a JSON array only — no markdown, no explanation. Format:
            [
              {"speakerId": <id>, "spoken": "...", "thought": "..."},
              ...
            ]
            Include the opening line as the first element with speakerId {{initiator.Id}}.
            """;

        var history = new ChatHistory(systemPrompt);
        history.AddUserMessage("Generate the conversation now.");

        var result = await chatService.GetChatMessageContentAsync(history);
        var raw = result?.Content ?? "[]";

        var turns = ParseConversationTurns(raw, request.InitiatorId, request.OpeningLine, maxTurns);

        // Record memories for both gators
        foreach (var turn in turns)
        {
            var otherId = turn.SpeakerId == request.InitiatorId ? request.ResponderId : request.InitiatorId;
            AddMemory(turn.SpeakerId, new MemoryEntry
            {
                Day = _gameState.DayNumber,
                Type = "conversation",
                Detail = $"Said to {_gameState.Alligators.FirstOrDefault(a => a.Id == otherId)?.Name ?? "?"}: \"{turn.Spoken}\"",
                RelatedAlligatorId = otherId
            });
        }

        return new ChatConversationResponse
        {
            InitiatorId = request.InitiatorId,
            ResponderId = request.ResponderId,
            Turns = turns
        };
    }

    private static List<ConversationTurn> ParseConversationTurns(string raw, int initiatorId, string openingLine, int maxTurns)
    {
        var fallback = new List<ConversationTurn>
        {
            new() { SpeakerId = initiatorId, Spoken = openingLine }
        };

        try
        {
            var json = raw.Trim();
            if (json.StartsWith("```"))
            {
                json = System.Text.RegularExpressions.Regex.Replace(json, @"^```\w*\s*", "");
                json = System.Text.RegularExpressions.Regex.Replace(json, @"\s*```$", "");
            }
            var bracketStart = json.IndexOf('[');
            var bracketEnd = json.LastIndexOf(']');
            if (bracketStart >= 0 && bracketEnd > bracketStart)
                json = json[bracketStart..(bracketEnd + 1)];

            using var doc = System.Text.Json.JsonDocument.Parse(json);
            var turns = new List<ConversationTurn>();
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                if (turns.Count >= maxTurns) break;
                var speakerId = el.TryGetProperty("speakerId", out var sid) ? sid.GetInt32() : initiatorId;
                var spoken = el.TryGetProperty("spoken", out var sp) ? sp.GetString() ?? string.Empty : string.Empty;
                var thought = el.TryGetProperty("thought", out var th) ? th.GetString() : null;
                if (!string.IsNullOrWhiteSpace(spoken))
                    turns.Add(new ConversationTurn { SpeakerId = speakerId, Spoken = spoken, Thought = thought });
            }
            return turns.Count > 0 ? turns : fallback;
        }
        catch
        {
            return fallback;
        }
    }

    private static async Task<ChatMessageContent?> GetFirstResponseAsync(ChatCompletionAgent agent, ChatHistory history)
    {
        await foreach (var msg in agent.InvokeAsync(history))
        {
            return msg;
        }
        return null;
    }

    /// <summary>
    /// Generate a night-time reflection for all living alligators in parallel.
    /// Each gator reports who they suspect most and why.
    /// </summary>
    public async Task<NightReportResponse> GenerateNightReportAsync(List<int> aliveIds)
    {
        var chatService = _kernel.GetRequiredService<IChatCompletionService>();

        var tasks = aliveIds.Select(async id =>
        {
            var gator = _gameState.Alligators.FirstOrDefault(a => a.Id == id);
            if (gator is null) return null;

            var others = _gameState.Alligators
                .Where(a => a.IsAlive && a.Id != id)
                .Select(a =>
                {
                    var rel = gator.Relations.GetValueOrDefault(a.Id, 0);
                    var susp = gator.Suspicion.GetValueOrDefault(a.Id, 0);
                    return $"{a.Name} (ID:{a.Id}) — you feel {DescribeRelation(rel)} toward them, suspicion:{susp:F0}/100";
                });

            var memories = _memories.TryGetValue(id, out var mem) ? mem : [];
            var memLines = memories.TakeLast(8).Select(m => $"  [{m.Type}] {m.Detail}");

            var systemPrompt = PersonalityPrompts.GetSystemPrompt(
                gator.Name, gator.Personality, gator.IsMurderer, gator.IsLiar);

            var prompt = $$$"""
                {{{systemPrompt}}}

                It is now night. Reflect on the day (Day {{{_gameState.DayNumber}}}).

                Other alligators you know:
                {{{string.Join("\n", others)}}}

                Your recent memories:
                {{{string.Join("\n", memLines)}}}

                Based on your memories and feelings, who do you suspect most of being the murderer?
                Respond ONLY with a JSON object in this exact format (no markdown):
                {{
                  "topSuspectId": <id number or null>,
                  "suspicionReason": "<1-2 sentences>",
                  "innerThought": "<private thought, 1 sentence>"
                }}
                """;

            var history = new ChatHistory(prompt);
            history.AddUserMessage("Reflect on the day and give your night report now.");

            try
            {
                var result = await chatService.GetChatMessageContentAsync(history);
                var raw = result?.Content ?? "{}";

                // Strip markdown fences
                var json = raw.Trim();
                if (json.StartsWith("```")) {
                    json = System.Text.RegularExpressions.Regex.Replace(json, @"^```\w*\s*", "");
                    json = System.Text.RegularExpressions.Regex.Replace(json, @"\s*```$", "");
                }
                var braceStart = json.IndexOf('{');
                var braceEnd   = json.LastIndexOf('}');
                if (braceStart >= 0 && braceEnd > braceStart)
                    json = json[braceStart..(braceEnd + 1)];

                using var doc = System.Text.Json.JsonDocument.Parse(json);
                int? suspectId = null;
                if (doc.RootElement.TryGetProperty("topSuspectId", out var sidEl)
                    && sidEl.ValueKind == System.Text.Json.JsonValueKind.Number)
                    suspectId = sidEl.GetInt32();

                var reason  = doc.RootElement.TryGetProperty("suspicionReason", out var rEl) ? rEl.GetString() : null;
                var thought = doc.RootElement.TryGetProperty("innerThought",    out var tEl) ? tEl.GetString() : null;
                var suspectName = suspectId.HasValue
                    ? _gameState.Alligators.FirstOrDefault(a => a.Id == suspectId)?.Name
                    : null;

                return new NightReportEntry
                {
                    AlligatorId    = id,
                    AlligatorName  = gator.Name,
                    TopSuspectId   = suspectId,
                    TopSuspectName = suspectName,
                    SuspicionReason = reason ?? "I'm not sure yet.",
                    InnerThought   = thought
                };
            }
            catch
            {
                return new NightReportEntry
                {
                    AlligatorId    = id,
                    AlligatorName  = gator.Name,
                    SuspicionReason = "Something feels off, but I can't put my claw on it.",
                };
            }
        });

        var results = await Task.WhenAll(tasks);
        return new NightReportResponse
        {
            Entries = results.Where(e => e is not null).Cast<NightReportEntry>().ToList()
        };
    }
}
