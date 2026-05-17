using SwampOfSalem.Shared.Enums;
using SwampOfSalem.Shared.Models;

namespace SwampOfSalem.Gators.Thinking;

/// <summary>
/// Evaluates and updates an alligator's <see cref="Mood"/> based on current game state
/// and their memory log. Called from <c>GatorBrainService</c> whenever significant
/// events occur (memory added, day advanced, vote recorded, conversation completed).
///
/// <para>
/// Mood selection follows a priority ladder — higher-priority moods (threat-based)
/// override lower-priority ones (social / flavour). Only one mood is active at a time.
/// Moods set at a given day expire after one full day unless refreshed by a new trigger.
/// </para>
/// </summary>
public static class MoodEvaluator
{
    // ── Public entry point ────────────────────────────────────────────────────

    /// <summary>
    /// Re-evaluates and updates <paramref name="gator"/>'s Mood.
    /// Call after any significant game event for that gator.
    /// </summary>
    public static void Evaluate(
        Alligator gator,
        GameState gameState,
        List<MemoryEntry> memories,
        EvaluationContext ctx)
    {
        // Expire old mood after one day
        if (gator.Mood != Mood.Normal && gator.MoodSetDay > 0
            && gameState.DayNumber > gator.MoodSetDay + 1)
        {
            SetMood(gator, Mood.Normal, gameState.DayNumber);
        }

        Mood newMood = DetermineNewMood(gator, gameState, memories, ctx);

        // Only update if we computed something non-Normal, or if a higher-priority
        // mood is replacing a lower-priority one.
        if (newMood != Mood.Normal || gator.Mood == Mood.Normal)
            SetMood(gator, newMood, gameState.DayNumber);
    }

    // ── Core determination logic ──────────────────────────────────────────────

    private static Mood DetermineNewMood(
        Alligator gator,
        GameState gameState,
        List<MemoryEntry> memories,
        EvaluationContext ctx)
    {
        var living = gameState.Alligators.Where(a => a.IsAlive).ToList();

        // ── TIER 1: Immediate threat (highest priority) ──────────────────────

        // Doomed: murderer is 1 vote away from majority
        if (gator.IsMurderer && ctx.VotesAgainstSelf >= (living.Count / 2))
            return Mood.Doomed;

        // Desperate: 2 votes short of majority against them (non-murderer too)
        if (ctx.VotesAgainstSelf >= (living.Count / 2) - 1 && ctx.VotesAgainstSelf > 0)
            return Mood.Desperate;

        // Cornered: currently leading the vote count
        if (ctx.IsVoteLeader && ctx.VotesAgainstSelf > 0)
            return Mood.Cornered;

        // Last Stand: only non-murderer remaining (2 living, 1 is murderer)
        if (!gator.IsMurderer && living.Count == 2)
            return Mood.LastStand;

        // ── TIER 1.5: Panic escalation by death count ────────────────────────
        //
        // As the population shrinks the whole swamp grows more afraid.
        // The thresholds tighten with each successive death so early-game
        // deaths barely register but late-game deaths trigger strong responses.

        {
            int totalStarting = gameState.StartingPopulation > 0
                ? gameState.StartingPopulation
                : Math.Max(living.Count + gameState.DeadIds.Count, 1);
            double deathFrac = (double)ctx.DeathCount / totalStarting;

            // Half or more of the population gone — existential panic
            if (deathFrac >= 0.5 && !gator.IsMurderer)
                return Mood.Panicking;

            // A third gone — rising dread (Cheerful/Lazy resist slightly)
            if (deathFrac >= 0.33 && !gator.IsMurderer)
            {
                bool resistsDread = gator.Personality is Personality.Cheerful or Personality.Lazy;
                if (!resistsDread)
                    return Mood.StirredUp;
            }
        }

        // ── TIER 1.6: Clique disruption ──────────────────────────────────────

        // Clique mate killed this night — deep grief
        if (ctx.CliqueMateKilledThisNight)
            return Mood.Haunted;

        // Rival clique is actively driving accusations against this gator
        if (ctx.RivalCliqueActivelyAccusing)
            return Mood.Hunted;

        // A clique mate betrayed the group by voting against a member
        if (ctx.CliqueMateBetrayedVote)
            return Mood.Betrayed;

        // ── TIER 2: Acute personal event ────────────────────────────────────

        // Panicking: best ally just murdered (ally died THIS night)
        if (ctx.BestAllyDiedThisNight)
            return Mood.Panicking;

        // Betrayed: high-relation gator voted against them
        if (ctx.HighRelationGatorVotedAgainstMe)
            return Mood.Betrayed;

        // Haunted: saw a death marker of someone they were close to this day
        if (ctx.CloseFriendDied && gameState.DayNumber - ctx.FriendDeathDay <= 1)
            return Mood.Haunted;

        // ── TIER 3: Self-preservation signals ────────────────────────────────

        // Hunted: overheard own name as suspect
        if (ctx.OverheardSelfAsSuspect)
            return Mood.Hunted;

        // Resigned: voted against 2+ times without execution
        if (ctx.TimesVotedAgainst >= 2 && !ctx.WasExecutedThisDay)
            return Mood.Resigned;

        // Survivors Guilt: all prior allies dead
        if (!gator.IsMurderer && ctx.AllAlliesDead && living.Count > 2)
            return Mood.SurvivorsGuilt;

        // ── TIER 4: Evidence / suspicion state ───────────────────────────────

        // Obsessed: same suspect flagged for 3+ consecutive days
        if (ctx.DaysObsessedWithSameSuspect >= 3)
            return Mood.Obsessed;

        // Convinced: very high suspicion on one target, low on everyone else
        double topSuspicion = gator.Suspicion.Values.Any() ? gator.Suspicion.Values.Max() : 0;
        if (topSuspicion >= 75)
            return Mood.Convinced;

        // Conflicted: top suspect is also a very high-relation gator
        if (IsTopSuspectAlsoCloseFriend(gator))
            return Mood.Conflicted;

        // Doubting: recently voted for someone who was innocent (survived)
        if (ctx.LastVoteTargetWasInnocent)
            return Mood.Doubting;

        // Sleuthing: suspicion evenly spread and low
        if (topSuspicion < 20 && gator.Suspicion.Count > 0)
            return Mood.Sleuthing;

        // RedHerring: murderer with high conviction, low actual suspicion on them
        if (gator.IsMurderer && ctx.VotesAgainstSelf == 0 && living.Count > 3)
            return Mood.RedHerring;

        // ── TIER 5: Relationship events ───────────────────────────────────────

        // Bonded: max-relation gator is alive
        double maxRelation = gator.Relations.Values.Any() ? gator.Relations.Values.Max() : 0;
        if (maxRelation >= 80)
            return Mood.Bonded;

        // Charming: just completed a positive conversation (set by context)
        if (ctx.JustHadPositiveConversation)
            return Mood.Charming;

        // Clingy: very high relation with a specific alive gator
        if (maxRelation >= 70)
            return Mood.Clingy;

        // Isolated: all relations below 0
        if (gator.Relations.Values.Any() && gator.Relations.Values.All(v => v < 0))
            return Mood.Isolated;

        // ── TIER 6: Personality escalations ──────────────────────────────────

        if (gator.Personality == Personality.Energetic && ctx.DisagreedWithLastVoteOutcome)
            return Mood.Ranting;

        if (gator.Personality == Personality.Grumpy && ctx.HighRelationGatorVotedAgainstMe)
            return Mood.Stonewalling;

        if (gator.Personality == Personality.Introvert && ctx.ContradictedSelf)
            return Mood.Overthinking;

        if (gator.Personality == Personality.Cheerful && ctx.MurderCountThisGame >= 2 && topSuspicion < 30)
            return Mood.BlissfullyUnaware;

        if (gator.Personality == Personality.Lazy && ctx.MissedKeyEventsLastNight)
            return Mood.CheckedOut;

        if (gator.Personality == Personality.Extrovert && ctx.VotedWithMajorityLastRound)
            return Mood.Sycophantic;

        if (gator.Personality == Personality.Extrovert && topSuspicion > 50)
            return Mood.Showboating;

        // ── TIER 7: Swamp flavour ─────────────────────────────────────────────

        // ColdBlooded: murderer late game, multiple kills, no suspicion on them
        if (gator.IsMurderer && ctx.MurderCountThisGame >= 2
            && topSuspicion < 15 && living.Count <= 4)
            return Mood.ColdBlooded;

        // StirredUp: murder happened very nearby (same day, early discovery)
        if (ctx.MurderHappenedNearby && gameState.DayNumber == ctx.LastMurderDay)
            return Mood.StirredUp;

        // Submerged: 2+ allies died recently
        if (ctx.AlliesDeadThisGame >= 2 && gameState.DayNumber - ctx.LastAllyDeathDay <= 1)
            return Mood.Submerged;

        // Murky: lots of conflicting memory entries (he-said-she-said)
        int conflictingEntries = CountConflictingMemories(memories);
        if (conflictingEntries >= 4)
            return Mood.Murky;

        // Territorial: many negative relations + prefers home
        int negativeRelations = gator.Relations.Count(kv => kv.Value < -30);
        if (negativeRelations >= 2)
            return Mood.Territorial;

        // Sunning: day 1 with no dead yet (calm early game)
        if (gameState.DayNumber == 1 && !gameState.Alligators.Any(a => !a.IsAlive))
            return Mood.Sunning;

        return Mood.Normal;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static void SetMood(Alligator gator, Mood mood, int day)
    {
        gator.Mood       = mood;
        gator.MoodSetDay = day;
    }

    private static bool IsTopSuspectAlsoCloseFriend(Alligator gator)
    {
        var topSuspectId = gator.Suspicion
            .OrderByDescending(kv => kv.Value)
            .Select(kv => (int?)kv.Key)
            .FirstOrDefault();
        if (topSuspectId is null) return false;
        double rel = gator.Relations.GetValueOrDefault(topSuspectId.Value, 0);
        double suspicion = gator.Suspicion.GetValueOrDefault(topSuspectId.Value, 0);
        return rel >= 50 && suspicion >= 40;
    }

    private static int CountConflictingMemories(List<MemoryEntry> memories)
    {
        // Count how many memories reference contradictory behaviour patterns
        // Approximated by counting unique "overheard" + "spoke" entries about different suspects
        return memories
            .Where(m => m.Type is "overheard" or "conversation")
            .Select(m => m.RelatedAlligatorId)
            .Distinct()
            .Count();
    }
}

/// <summary>
/// Snapshot of per-event context passed into <see cref="MoodEvaluator.Evaluate"/>.
/// The caller (GatorBrainService) populates the relevant fields before calling Evaluate.
/// Fields default to false/0 so callers only need to set what they know.
/// </summary>
public sealed class EvaluationContext
{
    /// <summary>Number of current-round votes cast against this gator.</summary>
    public int VotesAgainstSelf { get; set; }

    /// <summary>Whether this gator is currently the vote leader.</summary>
    public bool IsVoteLeader { get; set; }

    /// <summary>Whether the gator's best ally died during the most recent night.</summary>
    public bool BestAllyDiedThisNight { get; set; }

    /// <summary>Whether a gator with relation >= 50 voted against this gator.</summary>
    public bool HighRelationGatorVotedAgainstMe { get; set; }

    /// <summary>Whether a close friend (relation >= 40) has died at any point this game.</summary>
    public bool CloseFriendDied { get; set; }

    /// <summary>Day number of the close friend's death (for expiry checks).</summary>
    public int FriendDeathDay { get; set; }

    /// <summary>Whether this gator overheard their own name mentioned as a suspect.</summary>
    public bool OverheardSelfAsSuspect { get; set; }

    /// <summary>Number of times this gator has been voted against without being executed.</summary>
    public int TimesVotedAgainst { get; set; }

    /// <summary>Whether this gator was the one executed today.</summary>
    public bool WasExecutedThisDay { get; set; }

    /// <summary>Whether all gators this one had positive relations with are now dead.</summary>
    public bool AllAlliesDead { get; set; }

    /// <summary>How many consecutive days this gator has been most suspicious of the same target.</summary>
    public int DaysObsessedWithSameSuspect { get; set; }

    /// <summary>Whether the last gator this one voted for turned out to be innocent (survived the vote).</summary>
    public bool LastVoteTargetWasInnocent { get; set; }

    /// <summary>Whether this gator just ended a positive conversation (net relation gain).</summary>
    public bool JustHadPositiveConversation { get; set; }

    /// <summary>Whether this gator voted for the losing candidate last round.</summary>
    public bool DisagreedWithLastVoteOutcome { get; set; }

    /// <summary>Whether the gator has stated a position and then contradicted it in a later memory entry.</summary>
    public bool ContradictedSelf { get; set; }

    /// <summary>Total murders committed this game (used for ColdBlooded/BlissfullyUnaware escalation).</summary>
    public int MurderCountThisGame { get; set; }

    /// <summary>Whether the gator has no memories of key events from last night (Lazy / checked-out).</summary>
    public bool MissedKeyEventsLastNight { get; set; }

    /// <summary>Whether this gator voted with the majority last round.</summary>
    public bool VotedWithMajorityLastRound { get; set; }

    /// <summary>Whether a murder occurred in the same area as this gator this day.</summary>
    public bool MurderHappenedNearby { get; set; }

    /// <summary>Day number of the most recent murder.</summary>
    public int LastMurderDay { get; set; }

    /// <summary>Total number of allies (relation >= 30) who have died at any point this game.</summary>
    public int AlliesDeadThisGame { get; set; }

    /// <summary>Day number of the most recent ally death.</summary>
    public int LastAllyDeathDay { get; set; }

    // ── Panic escalation ──────────────────────────────────────────────────────

    /// <summary>
    /// Total deaths in the game so far (murdered + executed).
    /// Used to compute the death fraction for panic escalation.
    /// </summary>
    public int DeathCount { get; set; }

    // ── Clique context ────────────────────────────────────────────────────────

    /// <summary>Whether a member of this gator's clique was killed last night.</summary>
    public bool CliqueMateKilledThisNight { get; set; }

    /// <summary>
    /// Whether a rival clique is currently the primary source of accusations
    /// against this gator (≥ 1 rival clique member has high suspicion of them).
    /// </summary>
    public bool RivalCliqueActivelyAccusing { get; set; }

    /// <summary>
    /// Whether a gator in this gator's own clique voted against a clique member
    /// this round — a betrayal of clique loyalty.
    /// </summary>
    public bool CliqueMateBetrayedVote { get; set; }
}
