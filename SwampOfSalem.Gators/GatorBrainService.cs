using System.Collections.Concurrent;
using SwampOfSalem.Gators.Neural;
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
/// <b>Neural layer</b><br/>
/// Each living alligator also runs a <see cref="GatorBrainThread"/> on a dedicated
/// background thread. The thread continuously runs a 64→96→48 feed-forward network,
/// producing suspicion nudges, mood suggestions, social-need adjustments, and
/// inter-gator influence signals. Outputs are applied via
/// <see cref="NeuralBrainOrchestrator.ApplyOutputs"/> before each decision point.
/// </para>
/// </summary>
public class GatorBrainService : IDisposable
{
    private readonly GameState _gameState;
    private readonly ConcurrentDictionary<int, List<MemoryEntry>> _memories = new();
    private readonly NeuralBrainOrchestrator _neural;

    public GatorBrainService(GameState gameState)
    {
        _gameState = gameState;
        _neural    = new NeuralBrainOrchestrator(gameState);
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

        // Record starting population for panic-escalation calculations
        _gameState.StartingPopulation = _gameState.Alligators.Count;

        // Form initial cliques from spawn-time relation seeds
        CliqueService.FormCliques(_gameState);
    }

    /// <summary>
    /// Resets agent state without changing game state (mirrors GatorAgentService.InitializeAgents).
    /// </summary>
    public void InitializeAgents()
    {
        _memories.Clear();
        _neural.StopAll();
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

        // Re-evaluate mood whenever new information arrives
        var gator = _gameState.Alligators.FirstOrDefault(a => a.Id == alligatorId);
        if (gator is not null)
        {
            var mem = _memories.GetOrAdd(alligatorId, _ => []);
            MoodEvaluator.Evaluate(gator, _gameState, mem, BuildContext(gator));
        }
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

        // Apply any accumulated neural suggestions (suspicion nudges, mood) before deciding
        _neural.ApplyOutputs();

        var (voteForId, reasoning) = VoteDecider.Decide(
            gator, request.CandidateIds, _gameState, memories, rng);

        AddMemory(gator.Id, new MemoryEntry
        {
            Day               = _gameState.DayNumber,
            Type              = "vote",
            Detail            = $"Voted for {_gameState.Alligators.FirstOrDefault(a => a.Id == voteForId)?.Name ?? "unknown"}: {reasoning}",
            RelatedAlligatorId = voteForId,
        });

        // Re-evaluate mood after committing a vote
        MoodEvaluator.Evaluate(gator, _gameState, memories, BuildContext(gator));

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

        // Apply neural outputs so mood/suspicion nudges are current before the conversation
        _neural.ApplyOutputs();

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

        // Re-evaluate mood for both participants after the conversation
        var iCtx = BuildContext(initiator, justHadPositiveConversation: true);
        MoodEvaluator.Evaluate(initiator, _gameState, iMem, iCtx);
        var rCtx = BuildContext(responder, justHadPositiveConversation: true);
        MoodEvaluator.Evaluate(responder, _gameState, rMem, rCtx);

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

        // Reward surviving gators for making it through the night
        _neural.RewardNightSurvival(aliveIds, _gameState.MurdererId);

        // Night is a major event — re-evaluate all living gators' moods
        // Update clique membership now that someone may have died
        CliqueService.UpdateCliques(_gameState);

        foreach (var id in aliveIds)
        {
            var gator = _gameState.Alligators.FirstOrDefault(a => a.Id == id);
            if (gator is null) continue;
            var mem = _memories.GetOrAdd(id, _ => []);
            MoodEvaluator.Evaluate(gator, _gameState, mem, BuildContext(gator));
        }

        return Task.FromResult(report);
    }

    // ── RNG factory ──────────────────────────────────────────────────────────

    /// <summary>
    /// Builds an <see cref="EvaluationContext"/> for <paramref name="gator"/> based on
    /// current game state and their memory log. Used to drive <see cref="MoodEvaluator"/>.
    /// </summary>
    private EvaluationContext BuildContext(Alligator gator, bool justHadPositiveConversation = false)
    {
        var living = _gameState.Alligators.Where(a => a.IsAlive).ToList();
        var mem    = _memories.GetOrAdd(gator.Id, _ => []);

        // Count current-round votes against this gator
        int votesAgainst = mem.Count(m => m.Type == "vote" &&
            m.RelatedAlligatorId == gator.Id &&
            m.Day == _gameState.DayNumber);

        // Is this gator the vote leader?
        var voteLeaderId = mem
            .Where(m => m.Type == "vote" && m.Day == _gameState.DayNumber)
            .GroupBy(m => m.RelatedAlligatorId)
            .OrderByDescending(g => g.Count())
            .Select(g => g.Key)
            .FirstOrDefault();
        bool isVoteLeader = voteLeaderId == gator.Id;

        // Deaths this game
        var dead = _gameState.Alligators.Where(a => !a.IsAlive).ToList();
        int murderCount = dead.Count;

        // Ally-death tracking (relation > 30 == ally)
        var deadAllies = dead.Where(d => gator.Relations.GetValueOrDefault(d.Id, 0) >= 30).ToList();
        bool closeFriendDied = deadAllies.Any();
        int lastAllyDeathDay = closeFriendDied ? _gameState.DayNumber : 0; // approximation

        // Best ally died THIS night: last dead whose relation was highest
        bool bestAllyDiedThisNight = deadAllies.Any() &&
            mem.Any(m => m.Type == "death" && m.Day == _gameState.DayNumber &&
                deadAllies.Any(a => a.Id == m.RelatedAlligatorId));

        // All allies dead?
        bool allAlliesDead = closeFriendDied &&
            _gameState.Alligators
                .Where(a => a.IsAlive && a.Id != gator.Id)
                .All(a => gator.Relations.GetValueOrDefault(a.Id, 0) < 30);

        // Overheard own name as suspect
        bool overheardSelf = mem.Any(m =>
            m.Type == "overheard" &&
            m.Detail != null &&
            m.Detail.Contains(gator.Name, StringComparison.OrdinalIgnoreCase));

        // Times voted against without execution
        int timesVotedAgainst = mem.Count(m =>
            m.Type == "voted_against" || (m.Type == "vote" && m.RelatedAlligatorId == gator.Id));

        // Obsession streak: same suspect targeted consecutively
        var topSuspectToday = gator.Suspicion
            .OrderByDescending(kv => kv.Value)
            .Select(kv => (int?)kv.Key)
            .FirstOrDefault();
        int obsessionDays = topSuspectToday.HasValue
            ? mem.Count(m => m.Type == "vote" &&
                m.RelatedAlligatorId == topSuspectToday.Value)
            : 0;

        // Murder happened nearby approximation (any death this day)
        bool murderNearby = dead.Any() && _gameState.DayNumber > 1;

        // ── Clique context ────────────────────────────────────────────────────
        var clique = CliqueService.GetClique(gator, _gameState);

        bool cliqueMateKilledThisNight = clique is not null &&
            dead.Any(d => clique.MemberIds.Contains(d.Id) &&
                mem.Any(m => m.Type == "death" && m.Day == _gameState.DayNumber &&
                    m.RelatedAlligatorId == d.Id));

        bool rivalCliqueAccusing = false;
        if (gator.CliqueId.HasValue)
        {
            var myClique = _gameState.Cliques.FirstOrDefault(c => c.Id == gator.CliqueId.Value);
            if (myClique is not null)
            {
                rivalCliqueAccusing = myClique.RivalCliqueIds
                    .SelectMany(rid => _gameState.Cliques
                        .Where(c => c.Id == rid)
                        .SelectMany(c => c.MemberIds))
                    .Select(rid => _gameState.Alligators.FirstOrDefault(a => a.Id == rid))
                    .Where(a => a is not null)
                    .Cast<Alligator>()
                    .Any(rival => rival.Suspicion.GetValueOrDefault(gator.Id, 0) > 35);
            }
        }

        bool cliqueBetrayalVote = clique is not null &&
            mem.Any(m => m.Type == "voted_against" &&
                m.Day == _gameState.DayNumber &&
                m.RelatedAlligatorId.HasValue &&
                clique.MemberIds.Contains(m.RelatedAlligatorId.Value));

        return new EvaluationContext
        {
            VotesAgainstSelf           = votesAgainst,
            IsVoteLeader               = isVoteLeader,
            BestAllyDiedThisNight      = bestAllyDiedThisNight,
            HighRelationGatorVotedAgainstMe = mem.Any(m =>
                m.Type == "voted_against" &&
                m.RelatedAlligatorId.HasValue &&
                gator.Relations.GetValueOrDefault(m.RelatedAlligatorId.Value, 0) >= 50),
            CloseFriendDied            = closeFriendDied,
            FriendDeathDay             = lastAllyDeathDay,
            OverheardSelfAsSuspect     = overheardSelf,
            TimesVotedAgainst          = timesVotedAgainst,
            WasExecutedThisDay         = false, // can't know yet at eval time
            AllAlliesDead              = allAlliesDead,
            DaysObsessedWithSameSuspect = obsessionDays,
            LastVoteTargetWasInnocent  = false, // would require post-execution feedback
            JustHadPositiveConversation = justHadPositiveConversation,
            DisagreedWithLastVoteOutcome = false,
            ContradictedSelf           = false,
            MurderCountThisGame        = murderCount,
            MissedKeyEventsLastNight   = mem.Count(m => m.Day == _gameState.DayNumber - 1) < 2,
            VotedWithMajorityLastRound = false,
            MurderHappenedNearby       = murderNearby,
            LastMurderDay              = _gameState.DayNumber,
            AlliesDeadThisGame         = deadAllies.Count,
            LastAllyDeathDay           = lastAllyDeathDay,
            // Panic escalation
            DeathCount                 = dead.Count,
            // Clique
            CliqueMateKilledThisNight  = cliqueMateKilledThisNight,
            RivalCliqueActivelyAccusing = rivalCliqueAccusing,
            CliqueMateBetrayedVote     = cliqueBetrayalVote,
        };
    }

    /// <summary>
    /// Creates a deterministic but varied <see cref="Random"/> instance per
    /// gator × day × dialog-type, ensuring the same call always picks the
    /// same phrase while different days/types yield variety.
    /// </summary>
    private static Random MakeRng(int gatorId, int day, string dialogType) =>
        new(gatorId * 31 + day * 997 + (dialogType?.GetHashCode() ?? 0));

    public void Dispose() => _neural.Dispose();
}
