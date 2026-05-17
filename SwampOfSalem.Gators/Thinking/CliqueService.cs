using SwampOfSalem.Shared.Models;

namespace SwampOfSalem.Gators.Thinking;

/// <summary>
/// Manages the formation, maintenance, and dissolution of gator cliques.
///
/// <para>
/// <b>Formation algorithm</b><br/>
/// After all gators are spawned, <see cref="FormCliques"/> scans every pair of
/// living alligators and groups those with high mutual relation scores into cliques
/// of 2–4 members. The minimum threshold to join a clique is a mutual relation
/// of ≥ 25 with at least one existing member.
/// </para>
///
/// <para>
/// <b>Rivalry</b><br/>
/// After cliques are formed, any two cliques whose average cross-group sentiment
/// is below −15 become rivals. Rivalry is symmetric and stored in
/// <see cref="Clique.RivalCliqueIds"/>.
/// </para>
///
/// <para>
/// <b>Updates</b><br/>
/// Call <see cref="UpdateCliques"/> after each death or major vote outcome.
/// It prunes dead members, dissolves singleton cliques, recalculates cohesion,
/// and re-evaluates rivalries.
/// </para>
/// </summary>
public static class CliqueService
{
    private const double JoinThreshold    = 25.0;  // min mutual relation to enter a clique
    private const double CohesionFloor    = 15.0;  // below this a clique dissolves
    private const double RivalryThreshold = -15.0; // cross-group average that triggers rivalry
    private const int    MaxCliqueSize    = 4;

    private static readonly string[] CliqueNames =
    [
        "The Inner Circle",
        "The Shoreline Crew",
        "The Bog Brothers",
        "The Deep Water Club",
        "The Lily Pad Gang",
        "The Mudbank Regulars",
        "The Cattail Collective",
        "The Slow Current Squad",
        "The Old Reed Alliance",
        "The Sunning Society",
    ];

    // ── Public API ────────────────────────────────────────────────────────────

    /// <summary>
    /// Builds cliques from scratch using current live relation scores.
    /// Should be called once after <c>InitializeFromSpawnData</c> completes.
    /// </summary>
    public static void FormCliques(GameState gameState)
    {
        // Clear any previous clique assignments
        gameState.Cliques.Clear();
        foreach (var g in gameState.Alligators)
            g.CliqueId = null;

        var living = gameState.Alligators.Where(a => a.IsAlive).ToList();

        // Build affinity groups using a greedy union-find approach
        var groups = new List<List<int>>();

        foreach (var gator in living)
        {
            // Find the best existing group this gator can join
            int bestGroupIndex = -1;
            double bestAffinity = JoinThreshold - 1; // must beat threshold

            for (int gi = 0; gi < groups.Count; gi++)
            {
                var grp = groups[gi];
                if (grp.Count >= MaxCliqueSize) continue;

                double avgMutual = AverageMutualRelation(gator, grp, gameState);
                if (avgMutual > bestAffinity)
                {
                    bestAffinity  = avgMutual;
                    bestGroupIndex = gi;
                }
            }

            if (bestGroupIndex >= 0)
                groups[bestGroupIndex].Add(gator.Id);
            else
                groups.Add([gator.Id]); // start a new potential group
        }

        // Only groups of ≥ 2 become official cliques
        int cliqueIdCounter = 1;
        foreach (var grp in groups.Where(g => g.Count >= 2))
        {
            var clique = new Clique
            {
                Id         = cliqueIdCounter,
                Name       = PickName(cliqueIdCounter),
                MemberIds  = [..grp],
                FormedOnDay = gameState.DayNumber,
                Cohesion   = ComputeCohesion(grp, gameState),
            };
            gameState.Cliques.Add(clique);

            foreach (int id in grp)
            {
                var g = gameState.Alligators.FirstOrDefault(a => a.Id == id);
                if (g is not null) g.CliqueId = clique.Id;
            }

            cliqueIdCounter++;
        }

        EvaluateRivalries(gameState);
    }

    /// <summary>
    /// Called after any death or major social event. Prunes dead members,
    /// dissolves weak cliques, recalculates cohesion, and re-evaluates rivalries.
    /// May also form new cliques from unaffiliated gators who have grown close.
    /// </summary>
    public static void UpdateCliques(GameState gameState)
    {
        // Remove dead members
        foreach (var clique in gameState.Cliques)
        {
            clique.MemberIds.RemoveAll(id => gameState.DeadIds.Contains(id));
        }

        // Dissolve singleton / empty cliques
        var dissolved = gameState.Cliques.Where(c => c.IsDissolvedOrSingleton).ToList();
        foreach (var c in dissolved)
        {
            foreach (int id in c.MemberIds)
            {
                var g = gameState.Alligators.FirstOrDefault(a => a.Id == id);
                if (g is not null) g.CliqueId = null;
            }
            // Remove from all rivals
            foreach (var other in gameState.Cliques)
                other.RivalCliqueIds.Remove(c.Id);
        }
        gameState.Cliques.RemoveAll(c => c.IsDissolvedOrSingleton);

        // Recalculate cohesion; dissolve if too weak
        var weakCliques = new List<Clique>();
        foreach (var clique in gameState.Cliques)
        {
            clique.Cohesion = ComputeCohesion(clique.MemberIds, gameState);
            if (clique.Cohesion < CohesionFloor)
                weakCliques.Add(clique);
        }
        foreach (var c in weakCliques)
        {
            foreach (int id in c.MemberIds)
            {
                var g = gameState.Alligators.FirstOrDefault(a => a.Id == id);
                if (g is not null) g.CliqueId = null;
            }
            foreach (var other in gameState.Cliques)
                other.RivalCliqueIds.Remove(c.Id);
            gameState.Cliques.Remove(c);
        }

        // Try to recruit newly-unaffiliated gators into existing cliques
        var unaffiliated = gameState.Alligators
            .Where(a => a.IsAlive && a.CliqueId is null)
            .ToList();

        foreach (var gator in unaffiliated)
        {
            foreach (var clique in gameState.Cliques.Where(c => c.MemberIds.Count < MaxCliqueSize))
            {
                double avg = AverageMutualRelation(gator, clique.MemberIds, gameState);
                if (avg >= JoinThreshold)
                {
                    clique.MemberIds.Add(gator.Id);
                    gator.CliqueId = clique.Id;
                    clique.Cohesion = ComputeCohesion(clique.MemberIds, gameState);
                    break;
                }
            }
        }

        // Form new micro-cliques from gators still unaffiliated
        var stillUnaffiliated = gameState.Alligators
            .Where(a => a.IsAlive && a.CliqueId is null)
            .ToList();

        int nextId = gameState.Cliques.Count == 0 ? 1 : gameState.Cliques.Max(c => c.Id) + 1;
        for (int i = 0; i < stillUnaffiliated.Count - 1; i++)
        {
            for (int j = i + 1; j < stillUnaffiliated.Count; j++)
            {
                var a = stillUnaffiliated[i];
                var b = stillUnaffiliated[j];
                if (MutualRelation(a, b) >= JoinThreshold)
                {
                    var newClique = new Clique
                    {
                        Id          = nextId++,
                        Name        = PickName(nextId),
                        MemberIds   = [a.Id, b.Id],
                        FormedOnDay = gameState.DayNumber,
                        Cohesion    = MutualRelation(a, b),
                    };
                    gameState.Cliques.Add(newClique);
                    a.CliqueId = newClique.Id;
                    b.CliqueId = newClique.Id;
                    break;
                }
            }
        }

        EvaluateRivalries(gameState);
    }

    // ── Clique query helpers (used by VoteDecider, ConversationBuilder) ────────

    /// <summary>
    /// Returns true if <paramref name="a"/> and <paramref name="b"/> share a clique.
    /// </summary>
    public static bool SameClique(Alligator a, Alligator b) =>
        a.CliqueId.HasValue && a.CliqueId == b.CliqueId;

    /// <summary>
    /// Returns true if the cliques of <paramref name="a"/> and <paramref name="b"/> are rivals.
    /// </summary>
    public static bool AreRivals(Alligator a, Alligator b, GameState gameState)
    {
        if (!a.CliqueId.HasValue || !b.CliqueId.HasValue) return false;
        var cliqueA = gameState.Cliques.FirstOrDefault(c => c.Id == a.CliqueId.Value);
        return cliqueA is not null && cliqueA.RivalCliqueIds.Contains(b.CliqueId.Value);
    }

    /// <summary>
    /// Returns the clique for a given gator, or null if unaffiliated.
    /// </summary>
    public static Clique? GetClique(Alligator gator, GameState gameState) =>
        gator.CliqueId.HasValue
            ? gameState.Cliques.FirstOrDefault(c => c.Id == gator.CliqueId.Value)
            : null;

    /// <summary>
    /// Returns what fraction of a gator's clique (excluding themselves) are voting
    /// for a given candidate — a "clique consensus" score 0..1.
    /// Returns 0 if the gator is unaffiliated.
    /// </summary>
    public static double CliqueCandidateConsensus(
        Alligator voter,
        int candidateId,
        GameState gameState)
    {
        var clique = GetClique(voter, gameState);
        if (clique is null) return 0.0;

        var peers = clique.MemberIds
            .Where(id => id != voter.Id)
            .Select(id => gameState.Alligators.FirstOrDefault(a => a.Id == id))
            .Where(a => a is not null)
            .Cast<Alligator>()
            .ToList();

        if (peers.Count == 0) return 0.0;

        int agreeing = peers.Count(p =>
            p.Suspicion.TryGetValue(candidateId, out double s) && s > 40);

        return (double)agreeing / peers.Count;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private static void EvaluateRivalries(GameState gameState)
    {
        // Clear all existing rivalries and rebuild
        foreach (var c in gameState.Cliques)
            c.RivalCliqueIds.Clear();

        for (int i = 0; i < gameState.Cliques.Count; i++)
        {
            for (int j = i + 1; j < gameState.Cliques.Count; j++)
            {
                var ca = gameState.Cliques[i];
                var cb = gameState.Cliques[j];

                double crossSentiment = AverageCrossGroupSentiment(ca.MemberIds, cb.MemberIds, gameState);
                if (crossSentiment <= RivalryThreshold)
                {
                    ca.RivalCliqueIds.Add(cb.Id);
                    cb.RivalCliqueIds.Add(ca.Id);
                }
            }
        }
    }

    private static double AverageCrossGroupSentiment(
        List<int> groupA,
        List<int> groupB,
        GameState gameState)
    {
        double total = 0;
        int count = 0;
        foreach (int idA in groupA)
        {
            var ga = gameState.Alligators.FirstOrDefault(a => a.Id == idA);
            if (ga is null) continue;
            foreach (int idB in groupB)
            {
                total += ga.Relations.GetValueOrDefault(idB, 0);
                count++;
            }
        }
        return count == 0 ? 0 : total / count;
    }

    private static double AverageMutualRelation(
        Alligator gator,
        List<int> groupIds,
        GameState gameState)
    {
        if (groupIds.Count == 0) return 0;
        double total = 0;
        foreach (int id in groupIds)
        {
            var other = gameState.Alligators.FirstOrDefault(a => a.Id == id);
            if (other is null) continue;
            total += MutualRelation(gator, other);
        }
        return total / groupIds.Count;
    }

    private static double MutualRelation(Alligator a, Alligator b)
    {
        double ab = a.Relations.GetValueOrDefault(b.Id, 0);
        double ba = b.Relations.GetValueOrDefault(a.Id, 0);
        return (ab + ba) / 2.0;
    }

    private static double ComputeCohesion(List<int> memberIds, GameState gameState)
    {
        if (memberIds.Count < 2) return 0;
        double total = 0;
        int pairs = 0;
        for (int i = 0; i < memberIds.Count; i++)
        {
            var a = gameState.Alligators.FirstOrDefault(g => g.Id == memberIds[i]);
            if (a is null) continue;
            for (int j = i + 1; j < memberIds.Count; j++)
            {
                var b = gameState.Alligators.FirstOrDefault(g => g.Id == memberIds[j]);
                if (b is null) continue;
                total += MutualRelation(a, b);
                pairs++;
            }
        }
        return pairs == 0 ? 0 : total / pairs;
    }

    private static string PickName(int index) =>
        CliqueNames[(index - 1) % CliqueNames.Length];
}
