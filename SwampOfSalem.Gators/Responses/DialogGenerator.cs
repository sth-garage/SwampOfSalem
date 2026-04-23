using SwampOfSalem.Gators.Phrases;
using SwampOfSalem.Gators.Thinking;
using SwampOfSalem.Shared.DTOs;
using SwampOfSalem.Shared.Models;

namespace SwampOfSalem.Gators.Responses;

/// <summary>
/// Generates a single-turn spoken line and inner thought for one alligator.
/// Maps the <c>AgentDialogRequest.DialogType</c> string onto the appropriate
/// phrase bank and thought-engine path.
/// </summary>
public static class DialogGenerator
{
    /// <summary>
    /// Produces a spoken line and private thought for the given dialog request.
    /// </summary>
    public static AgentDialogResponse Generate(
        AgentDialogRequest request,
        Alligator gator,
        GameState gameState,
        List<MemoryEntry> memories,
        Random rng)
    {
        string? victimName = ResolveVictimName(gameState, memories);
        string tier        = ResolveTier(gator, request.TargetAlligatorId);
        string targetName  = ResolveTargetName(request.TargetAlligatorId, gameState);
        string suspectName = ResolveSuspectName(gator, gameState);
        string decoyName   = ResolveDecoyName(gator, gameState);

        string spoken = BuildSpoken(request.DialogType, gator, gameState, rng,
            tier, targetName, suspectName, victimName, decoyName);

        string thought = BuildThought(request.DialogType, gator, gameState, rng,
            request.TargetAlligatorId, victimName);

        return new AgentDialogResponse
        {
            AlligatorId = gator.Id,
            Message     = spoken,
            Thought     = thought,
        };
    }

    // ── Spoken line builder ──────────────────────────────────────────────────

    private static string BuildSpoken(
        string dialogType,
        Alligator gator,
        GameState gameState,
        Random rng,
        string tier,
        string targetName,
        string suspectName,
        string? victimName,
        string decoyName)
    {
        // Murderer overrides for specific types
        if (gator.IsMurderer)
        {
            if (dialogType is PhraseBanks.Bluff or "conversation" or PhraseBanks.Opinion)
            {
                var bluff = MurdererPhrases.DayBluff[gator.Personality];
                return Sub(ThoughtEngine.Pick(bluff, rng), gator.Name, targetName, suspectName, victimName, decoyName);
            }
            if (dialogType is PhraseBanks.Debate or PhraseBanks.Accusation)
            {
                var deflect = MurdererPhrases.DebateDeflect[gator.Personality];
                return Sub(ThoughtEngine.Pick(deflect, rng), gator.Name, targetName, suspectName, victimName, decoyName);
            }
        }

        // Map dialog type to phrase bank key (handle aliases)
        var bankKey = dialogType switch
        {
            "dawn_thought"   => PhraseBanks.DawnThought,
            "vote_announce"  => PhraseBanks.VoteAnnounce,
            "execute_plea"   => PhraseBanks.ExecutePlea,
            "execute_react"  => PhraseBanks.ExecuteReact,
            _                => dialogType,
        };

        var phrases = PhraseBanks.Get(gator.Personality, bankKey, tier);
        return Sub(ThoughtEngine.Pick(phrases, rng), gator.Name, targetName, suspectName, victimName, decoyName);
    }

    // ── Thought builder ──────────────────────────────────────────────────────

    private static string BuildThought(
        string dialogType,
        Alligator gator,
        GameState gameState,
        Random rng,
        int? targetId,
        string? victimName)
    {
        if (dialogType is PhraseBanks.DawnThought or "dawn_thought")
            return ThoughtEngine.GenerateDawn(gator, gameState, rng, victimName);

        return ThoughtEngine.Generate(gator, gameState, rng, targetId);
    }

    // ── Resolution helpers ───────────────────────────────────────────────────

    private static string ResolveTier(Alligator gator, int? targetId)
    {
        if (targetId is null) return "neutral";
        return PhraseBanks.RelationTier(gator.Relations.GetValueOrDefault(targetId.Value, 0));
    }

    private static string ResolveTargetName(int? targetId, GameState gameState)
    {
        if (targetId is null) return "everyone";
        return gameState.Alligators.FirstOrDefault(a => a.Id == targetId.Value)?.Name ?? "them";
    }

    private static string ResolveSuspectName(Alligator gator, GameState gameState)
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

    private static string ResolveDecoyName(Alligator gator, GameState gameState)
    {
        if (!gator.IsMurderer) return ResolveSuspectName(gator, gameState);
        // For murderer: prefer the gator who suspects them most
        var id = gameState.Alligators
            .Where(a => a.IsAlive && a.Id != gator.Id)
            .OrderByDescending(a => a.Suspicion.GetValueOrDefault(gator.Id, 0))
            .ThenBy(a => gator.Relations.GetValueOrDefault(a.Id, 0))
            .Select(a => (int?)a.Id)
            .FirstOrDefault();
        return id.HasValue
            ? gameState.Alligators.FirstOrDefault(a => a.Id == id.Value)?.Name ?? "someone"
            : "someone";
    }

    private static string? ResolveVictimName(GameState gameState, List<MemoryEntry> memories)
    {
        var mem = memories.Where(m => m.Type == "death" && m.RelatedAlligatorId.HasValue).LastOrDefault();
        if (mem?.RelatedAlligatorId is int vid)
            return gameState.Alligators.FirstOrDefault(a => a.Id == vid)?.Name;
        return gameState.Alligators.FirstOrDefault(a => !a.IsAlive)?.Name;
    }

    private static string Sub(string template, string name, string target, string suspect, string? victim, string decoy) =>
        ThoughtEngine.Substitute(template, name, target, suspect, victim, decoy);
}
