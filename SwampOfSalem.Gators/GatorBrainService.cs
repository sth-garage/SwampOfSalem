using System.Collections.Concurrent;
using SwampOfSalem.Gators.Responses;
using SwampOfSalem.Gators.Thinking;
using SwampOfSalem.Shared.DTOs;
using SwampOfSalem.Shared.Enums;
using SwampOfSalem.Shared.Models;

namespace SwampOfSalem.Gators;

/// <summary>
/// Rule-based drop-in replacement for <c>GatorAgentService</c> (from SwampOfSalem.SK).
/// <para>
/// Every public method mirrors the API of <c>GatorAgentService</c> exactly so that
/// the Web layer can swap the SK-backed implementation for this purely deterministic
/// one without changing any endpoint code. No LLM, no Semantic Kernel, no network
/// calls — all responses are generated from personality-keyed phrase banks,
/// suspicion/relationship scores, and game-state logic.
/// </para>
/// <para>
/// <b>Random seeding strategy</b><br/>
/// A fresh <see cref="Random"/> is created for each public call using
/// <c>gatorId ^ dayNumber ^ hashCode(dialogType)</c> so that the same request
/// always produces the same phrase while different days/types yield variety.
/// </para>
/// </summary>
public class GatorBrainService
{
    private readonly GameState _gameState;
    private readonly ConcurrentDictionary<int, List<MemoryEntry>> _memories = new();

    public GatorBrainService(GameState gameState)
    {
        _gameState = gameState;
    }

    // ── Initialization ───────────────────────────────────────────────────────

    /// <summary>
    /// Initialises game state from spawn data (mirrors GatorAgentService.InitializeFromSpawnData).
    /// </summary>
    public void InitializeFromSpawnData(IEnumerable<AlligatorSpawnData> spawnData)
    {
        _gameState.Alligators.Clear();
        _gameState.DeadIds.Clear();
        _gameState.DayNumber = 1;
        _gameState.Phase = GamePhase.Day;
        _gameState.MurdererId = null;
        _memories.Clear();

        foreach (var data in spawnData)
        {
            var personality = Enum.TryParse<Personality>(data.Personality, true, out var p)
                ? p : Personality.Cheerful;

            var gator = new Alligator
            {
                Id          = data.Id,
                Name        = data.Name,
                Personality = personality,
                IsMurderer  = data.IsMurderer,
                IsLiar      = data.IsLiar,
                IsAlive     = true,
            };

            // Seed topic opinions into suspicion / relations where possible
            foreach (var (topic, score) in data.TopicOpinions)
            {
                // Topic opinions that mention gator names contribute to relation seeds
                var mentioned = _gameState.Alligators.FirstOrDefault(a =>
                    topic.Contains(a.Name, StringComparison.OrdinalIgnoreCase));
                if (mentioned is not null)
                {
                    gator.Relations.TryAdd(mentioned.Id, score);
                }
            }

            _gameState.Alligators.Add(gator);
            if (data.IsMurderer) _gameState.MurdererId = data.Id;
            _memories.TryAdd(data.Id, []);
        }
    }

    /// <summary>
    /// Resets agent state without changing game state (mirrors GatorAgentService.InitializeAgents).
    /// </summary>
    public void InitializeAgents()
    {
        _memories.Clear();
        foreach (var gator in _gameState.Alligators.Where(a => a.IsAlive))
            _memories.TryAdd(gator.Id, []);
    }

    // ── Memory ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Adds a memory entry for an alligator (mirrors GatorAgentService.AddMemory).
    /// </summary>
    public void AddMemory(int alligatorId, MemoryEntry memory)
    {
        _memories.GetOrAdd(alligatorId, _ => []).Add(memory);
    }

    // ── Dialog ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Generates a single spoken line and thought for one alligator
    /// (mirrors GatorAgentService.GenerateDialogAsync).
    /// </summary>
    public Task<AgentDialogResponse> GenerateDialogAsync(AgentDialogRequest request)
    {
        var gator = _gameState.Alligators.FirstOrDefault(a => a.Id == request.AlligatorId);
        if (gator is null)
            return Task.FromResult(new AgentDialogResponse
            {
                AlligatorId = request.AlligatorId,
                Message = "[error: gator not found]",
            });

        var rng = MakeRng(gator.Id, _gameState.DayNumber, request.DialogType);
        var memories = _memories.GetOrAdd(gator.Id, _ => []);

        var response = DialogGenerator.Generate(request, gator, _gameState, memories, rng);

        // Record spoken as a memory
        AddMemory(gator.Id, new MemoryEntry
        {
            Day               = _gameState.DayNumber,
            Type              = request.DialogType,
            Detail            = $"Said: \"{response.Message}\" ({request.DialogType})",
            RelatedAlligatorId = request.TargetAlligatorId,
        });

        return Task.FromResult(response);
    }

    // ── Debate ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Runs a debate round where all participants respond simultaneously
    /// (mirrors GatorAgentService.RunDebateRoundAsync).
    /// </summary>
    public async Task<DebateRoundResponse> RunDebateRoundAsync(DebateRoundRequest request)
    {
        var response = new DebateRoundResponse();

        // Build shared context string for logging/memory purposes
        var debateContext = $"DEBATE ROUND {request.RoundNumber}:\n";
        if (request.VictimId.HasValue)
        {
            var victim = _gameState.Alligators.FirstOrDefault(a => a.Id == request.VictimId);
            debateContext += $"{victim?.Name ?? "Someone"} was murdered last night. Who did it?\n";
        }
        foreach (var msg in request.PreviousMessages)
            debateContext += $"{msg.SpeakerName}: {msg.Message}\n";

        var tasks = request.ParticipantIds.Select(async id =>
        {
            var dialogRequest = new AgentDialogRequest
            {
                AlligatorId    = id,
                DialogType     = "debate",
                ParticipantIds = request.ParticipantIds,
                Context        = debateContext,
            };
            return await GenerateDialogAsync(dialogRequest);
        });

        response.Responses.AddRange(await Task.WhenAll(tasks));
        return response;
    }

    // ── Vote ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// Gets one alligator's vote decision (mirrors GatorAgentService.GetVoteAsync).
    /// </summary>
    public Task<VoteResponse> GetVoteAsync(VoteRequest request)
    {
        var gator = _gameState.Alligators.FirstOrDefault(a => a.Id == request.AlligatorId);
        if (gator is null || request.CandidateIds.Count == 0)
        {
            return Task.FromResult(new VoteResponse
            {
                AlligatorId = request.AlligatorId,
                VoteForId   = request.CandidateIds.FirstOrDefault(),
                Reasoning   = "No strong opinion.",
            });
        }

        var rng = MakeRng(gator.Id, _gameState.DayNumber, "vote");
        var memories = _memories.GetOrAdd(gator.Id, _ => []);

        var (voteForId, reasoning) = VoteDecider.Decide(
            gator, request.CandidateIds, _gameState, memories, rng);

        AddMemory(gator.Id, new MemoryEntry
        {
            Day               = _gameState.DayNumber,
            Type              = "vote",
            Detail            = $"Voted for {_gameState.Alligators.FirstOrDefault(a => a.Id == voteForId)?.Name ?? "unknown"}: {reasoning}",
            RelatedAlligatorId = voteForId,
        });

        return Task.FromResult(new VoteResponse
        {
            AlligatorId = gator.Id,
            VoteForId   = voteForId,
            Reasoning   = reasoning,
        });
    }

    // ── Conversation ─────────────────────────────────────────────────────────

    /// <summary>
    /// Generates a complete multi-turn conversation between two alligators in one call
    /// (mirrors GatorAgentService.GenerateFullConversationAsync).
    /// </summary>
    public Task<ChatConversationResponse> GenerateFullConversationAsync(ChatConversationRequest request)
    {
        var initiator = _gameState.Alligators.FirstOrDefault(a => a.Id == request.InitiatorId);
        var responder = _gameState.Alligators.FirstOrDefault(a => a.Id == request.ResponderId);

        if (initiator is null || responder is null)
        {
            return Task.FromResult(new ChatConversationResponse
            {
                InitiatorId = request.InitiatorId,
                ResponderId = request.ResponderId,
                Messages    = [],
            });
        }

        var rng = MakeRng(initiator.Id ^ responder.Id, _gameState.DayNumber, "conversation");
        var iMem = _memories.GetOrAdd(initiator.Id, _ => []);
        var rMem = _memories.GetOrAdd(responder.Id, _ => []);

        var result = ConversationBuilder.Build(request, initiator, responder,
            _gameState, iMem, rMem, rng);

        // Record memories for both gators
        foreach (var msg in result.Messages)
        {
            int listenerId = msg.SpeakerGatorId == initiator.Id ? responder.Id : initiator.Id;
            var listenerName = _gameState.Alligators.FirstOrDefault(a => a.Id == listenerId)?.Name ?? "?";
            AddMemory(msg.SpeakerGatorId, new MemoryEntry
            {
                Day               = _gameState.DayNumber,
                Type              = "conversation",
                Detail            = $"Said to {listenerName}: \"{msg.Speech}\"",
                RelatedAlligatorId = listenerId,
            });
        }

        return Task.FromResult(result);
    }

    // ── Night report ─────────────────────────────────────────────────────────

    /// <summary>
    /// Generates night-time reflections for all living alligators
    /// (mirrors GatorAgentService.GenerateNightReportAsync).
    /// </summary>
    public Task<NightReportResponse> GenerateNightReportAsync(List<int> aliveIds)
    {
        var rng = MakeRng(aliveIds.Count, _gameState.DayNumber, "night");
        var memoriesSnapshot = new Dictionary<int, List<MemoryEntry>>(
            aliveIds.ToDictionary(id => id, id => _memories.GetOrAdd(id, _ => [])));

        var report = NightReporter.Report(aliveIds, _gameState, memoriesSnapshot, rng);
        return Task.FromResult(report);
    }

    // ── RNG factory ──────────────────────────────────────────────────────────

    /// <summary>
    /// Creates a deterministic but varied <see cref="Random"/> instance per
    /// gator × day × dialog-type, ensuring the same call always picks the
    /// same phrase while different days/types yield variety.
    /// </summary>
    private static Random MakeRng(int gatorId, int day, string dialogType) =>
        new(gatorId * 31 + day * 997 + (dialogType?.GetHashCode() ?? 0));
}
