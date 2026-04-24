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
/// Central AI orchestration service for the Swamp of Salem simulation.
/// <para>
/// <b>Architecture overview</b><br/>
/// Each living alligator is backed by a Semantic Kernel <see cref="ChatCompletionAgent"/>
/// with its own isolated <see cref="ChatHistory"/> (in-process memory). The agents
/// share a single <see cref="Kernel"/> instance (and therefore a single LLM connection)
/// but each agent gets a cloned kernel with its own <see cref="SwampPlugin"/> instance
/// so plugin calls stay scoped to the correct gator.
/// </para>
/// <para>
/// <b>Data flows</b>
/// <list type="number">
///   <item><description>JS calls <c>POST /api/agent/initialize</c> → <see cref="InitializeFromSpawnData"/> creates <see cref="Alligator"/> objects and SK agents.</description></item>
///   <item><description>JS calls <c>POST /api/agent/dialog</c> → <see cref="GenerateDialogAsync"/> returns spoken text + thought.</description></item>
///   <item><description>JS calls <c>POST /api/agent/conversation</c> → <see cref="GenerateFullConversationAsync"/> returns a full multi-turn exchange in one AI call.</description></item>
///   <item><description>JS calls <c>POST /api/agent/memory</c> → <see cref="AddMemory"/> injects observations into the agent's history.</description></item>
///   <item><description>JS calls <c>POST /api/agent/vote</c> → <see cref="GetVoteAsync"/> returns the gator's clockwise vote decision.</description></item>
///   <item><description>JS calls <c>POST /api/agent/night-report</c> → <see cref="GenerateNightReportAsync"/> returns all gators' night reflections in parallel.</description></item>
/// </list>
/// </para>
/// <para>
/// <b>Thread safety</b><br/>
/// All three concurrent dictionaries (<c>_agents</c>, <c>_histories</c>, <c>_memories</c>)
/// use <see cref="ConcurrentDictionary{TKey,TValue}"/> to safely handle parallel
/// night-report generation and any future multi-user expansion. The <c>GameState</c>
/// singleton itself is mutated only on the synchronous server request thread.
/// </para>
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
    /// Initialize agents from spawn data sent by the JavaScript frontend.
    /// <para>
    /// This method:
    /// <list type="number">
    ///   <item><description>Resets <see cref="GameState"/> to a clean Day 1 state.</description></item>
    ///   <item><description>Converts each <see cref="AlligatorSpawnData"/> DTO into an <see cref="Alligator"/> domain object.</description></item>
    ///   <item><description>Calls <see cref="InitializeAgents"/> to create one SK agent per living gator.</description></item>
    ///   <item><description>Injects AI-generated topic opinion context into each agent's <see cref="ChatHistory"/> as a system message so the agent can reference them naturally in dialogue.</description></item>
    /// </list>
    /// </para>
    /// </summary>
    /// <param name="spawnData">Array of spawn DTOs sent from <c>POST /api/agent/initialize</c>.</param>
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
    /// (Re-)initializes SK agents for all currently living alligators.
    /// Clears the <c>_agents</c>, <c>_histories</c>, and <c>_memories</c> dictionaries
    /// and creates a fresh <see cref="ChatCompletionAgent"/> for each alive gator.
    /// Called internally by <see cref="InitializeFromSpawnData"/> and can be called
    /// externally to reset agent state without changing game state.
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
        var memories = _memories.GetOrAdd(gator.Id, _ => []);
        var systemPrompt = PersonalityPrompts.GetSystemPrompt(
            gator.Name, gator.Personality, gator.IsMurderer, gator.IsLiar,
            gator.Mood, memories);

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
    /// Adds a memory to an alligator's in-process memory list <b>and</b> injects it
    /// into the agent's <see cref="ChatHistory"/> as a system message so the agent
    /// can reference it in future responses.
    /// Also triggers a mood-aware instruction refresh so mood changes mid-game propagate.
    /// </summary>
    /// <param name="alligatorId">ID of the alligator receiving the memory.</param>
    /// <param name="memory">The memory entry to add.</param>
    public void AddMemory(int alligatorId, MemoryEntry memory)
    {
        var memories = _memories.GetOrAdd(alligatorId, _ => []);
        memories.Add(memory);

        // Inject into chat history so the agent "remembers"
        if (_histories.TryGetValue(alligatorId, out var history))
        {
            history.AddSystemMessage($"[Memory - Day {memory.Day}] {memory.Detail}");
        }

        // Refresh agent instructions with latest mood + history on significant events
        if (memory.Type is "death" or "vote" or "conviction" or "night_report")
            RefreshAgentMood(alligatorId);
    }

    /// <summary>
    /// Rebuilds the SK agent's <c>Instructions</c> string to reflect the gator's
    /// <b>current</b> <see cref="Mood"/> and the latest slice of memory history.
    /// Call this whenever mood may have changed (e.g. after a death event, vote, or
    /// night report) so the LLM's framing stays current without restarting the agent.
    /// Also injects a system message into the chat history as a visible mood signal.
    /// </summary>
    /// <param name="alligatorId">ID of the alligator whose agent to refresh.</param>
    public void RefreshAgentMood(int alligatorId)
    {
        var gator = _gameState.Alligators.FirstOrDefault(a => a.Id == alligatorId);
        if (gator is null) return;
        if (!_agents.ContainsKey(alligatorId)) return;

        var memories = _memories.GetOrAdd(alligatorId, _ => []);

        // Rebuild a fresh prompt string to capture mood + recent memories
        var updatedPrompt = PersonalityPrompts.GetSystemPrompt(
            gator.Name, gator.Personality, gator.IsMurderer, gator.IsLiar,
            gator.Mood, memories);

        // Instructions is init-only, so push the refresh as a high-priority system message
        // into chat history — the model reads this as effectively a new framing instruction
        if (_histories.TryGetValue(alligatorId, out var history))
        {
            history.AddSystemMessage(
                $"[Mood update — Day {_gameState.DayNumber}] Your emotional state has shifted to: {gator.Mood}. " +
                $"Let this shape every word you say from this point forward.\n\n" +
                $"[Updated context]\n{updatedPrompt}");
        }
    }

    /// <summary>
    /// Asks one alligator agent to generate a contextual dialog response.
    /// <para>
    /// The method builds a context message from the game state (phase, day, target
    /// relationship, dialog-type instructions) and appends it to the agent's
    /// <see cref="ChatHistory"/>. The LLM must return a JSON object:
    /// <code>{"spoken": "...", "thought": "..."}</code>
    /// </para>
    /// <para>
    /// Parsing is defensive — if the model returns malformed JSON the method
    /// falls back to extracting the first sensible plain-text line.
    /// The spoken text is recorded as a new memory entry for the agent.
    /// </para>
    /// </summary>
    /// <param name="request">Describes who speaks, what type of dialog, and optional context.</param>
    /// <returns>The agent's spoken message and private thought.</returns>
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
    /// Runs a debate round where all participants generate a response simultaneously.
    /// <para>
    /// All agents are given the same debate context (previous messages, victim info)
    /// and respond in parallel using <see cref="Task.WhenAll"/>. This simulates a
    /// simultaneous roundtable — everyone hears the same debate history and forms
    /// their own in-character response.
    /// </para>
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
    /// Gets a single alligator's vote decision for the current Vote phase.
    /// <para>
    /// The agent receives the debate summary and a list of candidate names/IDs.
    /// It must respond in the format <c>ID|reason</c> (e.g. <c>3|They were near the victim</c>).
    /// The vote is recorded as a memory entry so the agent remembers who they voted for.
    /// Votes happen one at a time, clockwise, driven by <c>VoteService.EstablishVoteOrder()</c>.
    /// </para>
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

        var gator = _gameState.Alligators.FirstOrDefault(a => a.Id == request.AlligatorId);
        var moodLine = gator is not null
            ? $"Remember: your current mood is {gator.Mood} — let it influence the confidence and tone of your vote."
            : string.Empty;

        var prompt = $"""
            VOTE TIME. You must vote to execute one alligator. 
            Debate summary: {request.DebateSummary}
            Candidates: {string.Join(", ", candidates)}
            {moodLine}
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

        // Remind the agent of their current mood every turn so late-game changes take effect
        if (gator is not null)
        {
            sb.AppendLine($"[Your current mood: {gator.Mood}] Let this colour how you speak and reason right now.");
        }

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
                sb.AppendLine("You are in the debate phase. You MUST give a specific reason for your accusation — reference something you heard, saw, or that was said in the debate. Example: \"It's Gully because I heard him say something strange to Alex about the victim\" or \"I saw Chomps near the swamp that night.\" If others have made accusations, respond to them. Do NOT just say \"vote for X\" without a real reason. Stay in character. Keep it SHORT (1-2 sentences).");
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
    /// Generates a complete multi-turn conversation between two alligators in a <b>single</b> AI call.
    /// <para>
    /// Rather than making N round-trip API calls (one per turn), this method sends a single
    /// structured prompt asking the LLM to produce all turns at once as a JSON array.
    /// This is significantly faster and reduces token overhead from repeated context re-injection.
    /// </para>
    /// <para>
    /// The initiator's opening line is always included as the first message. The method
    /// clamps <c>MaxTurns</c> to the range [5, 9] to keep conversations a readable length.
    /// Both gators receive memory entries for every line they speak.
    /// </para>
    /// </summary>
    public async Task<ChatConversationResponse> GenerateFullConversationAsync(ChatConversationRequest request)
    {
        var initiator = _gameState.Alligators.FirstOrDefault(a => a.Id == request.InitiatorId);
        var responder = _gameState.Alligators.FirstOrDefault(a => a.Id == request.ResponderId);

        if (initiator is null || responder is null)
        {
            Console.Error.WriteLine($"[Conversation] Agent not found: initiator({request.InitiatorId})={initiator?.Name ?? "NULL"}, responder({request.ResponderId})={responder?.Name ?? "NULL"}. Returning empty response.");
            return new ChatConversationResponse
            {
                InitiatorId = request.InitiatorId,
                ResponderId = request.ResponderId,
                Messages = new List<ConversationMessage>()
            };
        }

        // Use the chat completion service directly for a single structured call
        var chatService = _kernel.GetRequiredService<IChatCompletionService>();

        var iMem = _memories.GetOrAdd(initiator.Id, _ => []);
        var rMem = _memories.GetOrAdd(responder.Id, _ => []);

        var initiatorPrompt = PersonalityPrompts.GetSystemPrompt(
            initiator.Name, initiator.Personality, initiator.IsMurderer, initiator.IsLiar,
            initiator.Mood, iMem);
        var responderPrompt = PersonalityPrompts.GetSystemPrompt(
            responder.Name, responder.Personality, responder.IsMurderer, responder.IsLiar,
            responder.Mood, rMem);

        var rel_ir = initiator.Relations.GetValueOrDefault(responder.Id, 0);
        var rel_ri = responder.Relations.GetValueOrDefault(initiator.Id, 0);

        var maxTurns = Math.Clamp(request.MaxTurns, 5, 9);

        var systemPrompt = $$"""
            You are a creative writer generating a short swamp alligator conversation.
            There are two alligators:
            - {{initiator.Name}} (ID:{{initiator.Id}}): {{initiatorPrompt}}
              Feels {{DescribeRelation(rel_ir)}} toward {{responder.Name}}.
            - {{responder.Name}} (ID:{{responder.Id}}): {{responderPrompt}}
              Feels {{DescribeRelation(rel_ri)}} toward {{initiator.Name}}.

            {{(request.Context is not null ? $"Context: {request.Context}" : string.Empty)}}

            {{initiator.Name}} has already said: "{{request.OpeningLine}}"

            Continue the conversation for {{maxTurns}} total turns (including the opening line already spoken).
            The conversation MUST contain EXACTLY {{maxTurns}} messages total.
            Alternate between speakers, starting with the opening line from {{initiator.Name}}.
            Keep each line SHORT (1-2 sentences max), natural, and in-character.

            CRITICAL: Respond with ONLY a JSON array. NO markdown code blocks, NO explanations, NO extra text.
            Format (exactly {{maxTurns}} items):
            [
              {"speakerId": {{initiator.Id}}, "spoken": "{{request.OpeningLine}}", "thought": "..."},
              {"speakerId": {{responder.Id}}, "spoken": "...", "thought": "..."},
              {"speakerId": {{initiator.Id}}, "spoken": "...", "thought": "..."},
              ...continue until {{maxTurns}} total messages...
            ]

            Include the opening line "{{request.OpeningLine}}" as the first element with speakerId {{initiator.Id}}.
            Every message MUST have a "thought" field (the character's private inner thoughts).
            """;

        var history = new ChatHistory(systemPrompt);
        history.AddUserMessage($"Generate exactly {maxTurns} conversation messages in JSON format. Start with the opening line from {initiator.Name} (ID {initiator.Id}), then alternate speakers. Output ONLY the JSON array, nothing else.");

        var result = await chatService.GetChatMessageContentAsync(history);
        var raw = result?.Content ?? "[]";

        Console.WriteLine($"[Conversation] {initiator.Name} & {responder.Name}: AI returned {raw.Length} chars");

        var messages = ParseConversationMessages(raw, request.InitiatorId, request.ResponderId, request.OpeningLine, maxTurns);

        Console.WriteLine($"[Conversation] Parsed {messages.Count} messages");

        // Record memories for both gators
        foreach (var msg in messages)
        {
            AddMemory(msg.SpeakerGatorId, new MemoryEntry
            {
                Day = _gameState.DayNumber,
                Type = "conversation",
                Detail = $"Said to {_gameState.Alligators.FirstOrDefault(a => a.Id == msg.SpeakingToGatorId)?.Name ?? "?"}: \"{msg.Speech}\"",
                RelatedAlligatorId = msg.SpeakingToGatorId
            });
        }

        return new ChatConversationResponse
        {
            InitiatorId = request.InitiatorId,
            ResponderId = request.ResponderId,
            Messages = messages
        };
    }

    private static List<ConversationMessage> ParseConversationMessages(string raw, int initiatorId, int responderId, string openingLine, int maxTurns)
    {
        try
        {
            Console.WriteLine($"[ParseConversation] Raw AI response ({raw.Length} chars): {raw}");

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

            Console.WriteLine($"[ParseConversation] Cleaned JSON: {json}");

            using var doc = System.Text.Json.JsonDocument.Parse(json);
            var messages = new List<ConversationMessage>();
            int order = 0;
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                if (messages.Count >= maxTurns) break;
                var speakerId = el.TryGetProperty("speakerId", out var sid) ? sid.GetInt32() : initiatorId;
                var spoken = el.TryGetProperty("spoken", out var sp) ? sp.GetString() ?? string.Empty : string.Empty;
                var thought = el.TryGetProperty("thought", out var th) ? th.GetString() : null;
                if (!string.IsNullOrWhiteSpace(spoken))
                {
                    order++;
                    var listenerId = speakerId == initiatorId ? responderId : initiatorId;
                    messages.Add(new ConversationMessage
                    {
                        Conversation = 1,
                        MessageId = order,
                        Order = order,
                        SpeakerGatorId = speakerId,
                        SpeakingToGatorId = listenerId,
                        Thought = thought,
                        Speech = spoken
                    });
                }
            }

            Console.WriteLine($"[ParseConversation] Parsed {messages.Count} messages");
            if (messages.Count == 0)
            {
                Console.Error.WriteLine("[ParseConversation] WARNING: Parsed 0 messages from AI response - NO FALLBACK, returning empty list");
            }

            return messages;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[ParseConversation] ERROR parsing AI response: {ex.Message}");
            Console.Error.WriteLine($"[ParseConversation] NO FALLBACK - returning empty list");
            return new List<ConversationMessage>();
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
    /// Generates night-time reflections for all living alligators in parallel.
    /// <para>
    /// Each gator is asked who they suspect most and why, given their memories and
    /// current relationship/suspicion scores. All requests are fired with
    /// <see cref="Task.WhenAll"/> so the Night phase remains fast even with 6 agents.
    /// </para>
    /// <para>
    /// Unlike <see cref="GenerateDialogAsync"/>, this method uses the raw
    /// <c>IChatCompletionService</c> directly (no agent wrapper) because night
    /// reflections don't need plugin access or persistent chat history.
    /// </para>
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

            var systemPrompt = PersonalityPrompts.GetSystemPrompt(
                gator.Name, gator.Personality, gator.IsMurderer, gator.IsLiar,
                gator.Mood, memories);

            var prompt = $$$"""
                {{{systemPrompt}}}

                It is now night. Reflect on the day (Day {{{_gameState.DayNumber}}}).

                Other alligators you know:
                {{{string.Join("\n", others)}}}

                Based on your memories and feelings, who do you suspect most of being the murderer?
                Pay close attention to debate accusations, who defended themselves, and what reasons they gave.
                Respond ONLY with a JSON object in this exact format (no markdown):
                {{
                  "topSuspectId": <id number or null>,
                  "suspicionReason": "<1-2 sentences referencing specific debate statements or behaviour>",
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
