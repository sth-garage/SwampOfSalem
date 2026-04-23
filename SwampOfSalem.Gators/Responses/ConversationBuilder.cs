using SwampOfSalem.Gators.Phrases;
using SwampOfSalem.Gators.Thinking;
using SwampOfSalem.Shared.DTOs;
using SwampOfSalem.Shared.Models;

namespace SwampOfSalem.Gators.Responses;

/// <summary>
/// Builds a complete back-and-forth conversation between two alligators without
/// any AI calls. Conversations are driven by:
/// <list type="bullet">
///   <item><description>Relationship tier (warm / neutral / cold) between the two gators.</description></item>
///   <item><description>Personality of each speaker.</description></item>
///   <item><description>Game context (day number, phase, suspicion levels).</description></item>
///   <item><description>A topic-rotation strategy so turns feel coherent and varied.</description></item>
/// </list>
/// </summary>
public static class ConversationBuilder
{
    // Conversation topic types that rotate through a dialogue
    private enum Topic { Greeting, SmallTalk, Suspicion, Gossip, Farewell }

    /// <summary>
    /// Builds a multi-turn conversation between two alligators.
    /// The opening line is always included as message 1.
    /// </summary>
    public static ChatConversationResponse Build(
        ChatConversationRequest request,
        Alligator initiator,
        Alligator responder,
        GameState gameState,
        List<MemoryEntry> initiatorMemories,
        List<MemoryEntry> responderMemories,
        Random rng)
    {
        int maxTurns = Math.Clamp(request.MaxTurns, 2, 9);
        var messages = new List<ConversationMessage>();

        // Determine relationship tiers
        double iToR = initiator.Relations.GetValueOrDefault(responder.Id, 0);
        double rToI = responder.Relations.GetValueOrDefault(initiator.Id, 0);
        string iTier = PhraseBanks.RelationTier(iToR);
        string rTier = PhraseBanks.RelationTier(rToI);

        // Topic sequence
        var topics = BuildTopicSequence(maxTurns, gameState, initiator, responder);

        bool isMurdererConv = initiator.IsMurderer || responder.IsMurderer;

        for (int i = 0; i < maxTurns; i++)
        {
            bool isInitiatorTurn = (i % 2 == 0);
            var speaker  = isInitiatorTurn ? initiator : responder;
            var listener = isInitiatorTurn ? responder  : initiator;
            string tier  = isInitiatorTurn ? iTier : rTier;
            var topic    = topics[Math.Min(i, topics.Count - 1)];

            string spoken, thought;

            if (i == 0 && !string.IsNullOrWhiteSpace(request.OpeningLine))
            {
                // Use the caller-supplied opening line verbatim
                spoken  = request.OpeningLine;
                thought = ThoughtEngine.Generate(speaker, gameState, rng, listener.Id);
            }
            else
            {
                (spoken, thought) = GenerateTurn(
                    speaker, listener, tier, topic, gameState, rng, isMurdererConv);
            }

            messages.Add(new ConversationMessage
            {
                Conversation      = 1,
                MessageId         = i + 1,
                Order             = i + 1,
                SpeakerGatorId    = speaker.Id,
                SpeakingToGatorId = listener.Id,
                Speech            = spoken,
                Thought           = thought,
            });
        }

        return new ChatConversationResponse
        {
            InitiatorId = request.InitiatorId,
            ResponderId = request.ResponderId,
            Messages    = messages,
        };
    }

    // ── Turn generation ──────────────────────────────────────────────────────

    private static (string Spoken, string Thought) GenerateTurn(
        Alligator speaker,
        Alligator listener,
        string tier,
        Topic topic,
        GameState gameState,
        Random rng,
        bool isMurdererConv)
    {
        string dialogType = TopicToDialogType(topic, speaker, gameState);

        // Murderer bluffs during casual talk
        if (speaker.IsMurderer && topic is Topic.SmallTalk or Topic.Gossip)
        {
            var bluff = MurdererPhrases.DayBluff[speaker.Personality];
            string decoy = ResolveDecoy(speaker, gameState);
            string spoken = ThoughtEngine.Substitute(
                ThoughtEngine.Pick(bluff, rng),
                speaker.Name, listener.Name,
                ResolveSuspect(speaker, gameState), null, decoy);
            string thought = ThoughtEngine.Generate(speaker, gameState, rng, listener.Id);
            return (spoken, thought);
        }

        var phrases = PhraseBanks.Get(speaker.Personality, dialogType, tier);
        string rawSpoken = ThoughtEngine.Pick(phrases, rng);
        string suspect = ResolveSuspect(speaker, gameState);
        string targetName = listener.Name;

        string finalSpoken = ThoughtEngine.Substitute(rawSpoken, speaker.Name, targetName, suspect, null, suspect);
        string finalThought = ThoughtEngine.Generate(speaker, gameState, rng, listener.Id);

        return (finalSpoken, finalThought);
    }

    // ── Topic sequencing ─────────────────────────────────────────────────────

    private static List<Topic> BuildTopicSequence(
        int turns,
        GameState gameState,
        Alligator initiator,
        Alligator responder)
    {
        var seq = new List<Topic>();
        bool hasDead = gameState.Alligators.Any(a => !a.IsAlive);
        bool highSuspicion = initiator.Suspicion.Values.Any(v => v > 40)
                          || responder.Suspicion.Values.Any(v => v > 40);

        for (int i = 0; i < turns; i++)
        {
            if (i == 0)             { seq.Add(Topic.Greeting); continue; }
            if (i == turns - 1)     { seq.Add(Topic.Farewell); continue; }

            // Middle turns: weighted topics based on game state
            if (hasDead && i == 1) { seq.Add(Topic.Suspicion); continue; }
            if (highSuspicion && i % 2 == 0) { seq.Add(Topic.Suspicion); continue; }
            seq.Add(i % 3 == 0 ? Topic.Gossip : Topic.SmallTalk);
        }

        return seq;
    }

    private static string TopicToDialogType(Topic topic, Alligator speaker, GameState gameState) =>
        topic switch
        {
            Topic.Greeting   => PhraseBanks.Introduction,
            Topic.Suspicion  => PhraseBanks.Accusation,
            Topic.Gossip     => PhraseBanks.Opinion,
            Topic.Farewell   => PhraseBanks.Guarded,
            _                => PhraseBanks.Conversation,
        };

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static string ResolveSuspect(Alligator gator, GameState gameState)
    {
        var id = gator.Suspicion
            .Where(kv => gameState.Alligators.Any(a => a.Id == kv.Key && a.IsAlive))
            .OrderByDescending(kv => kv.Value)
            .Select(kv => (int?)kv.Key)
            .FirstOrDefault();
        return id.HasValue
            ? gameState.Alligators.FirstOrDefault(a => a.Id == id.Value)?.Name ?? "someone"
            : "someone";
    }

    private static string ResolveDecoy(Alligator murderer, GameState gameState)
    {
        var id = gameState.Alligators
            .Where(a => a.IsAlive && a.Id != murderer.Id)
            .OrderByDescending(a => a.Suspicion.GetValueOrDefault(murderer.Id, 0))
            .ThenBy(a => murderer.Relations.GetValueOrDefault(a.Id, 0))
            .Select(a => (int?)a.Id)
            .FirstOrDefault();
        return id.HasValue
            ? gameState.Alligators.FirstOrDefault(a => a.Id == id.Value)?.Name ?? "someone"
            : "someone";
    }
}
