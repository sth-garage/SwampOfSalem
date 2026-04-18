using System.Text.Json;
using System.Text.Json.Serialization;
using SwampOfSalem.AppLogic.Constants;

namespace SwampOfSalem.AppLogic.Services;

/// <summary>
/// Serializes all game constants into a single JSON object for injection into JS.
/// </summary>
public static class GameConfigProvider
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    /// <summary>
    /// Returns a JSON string containing every game constant, ready for
    /// <c>window.GameConfig = JSON.parse(json)</c>.
    /// </summary>
    public static string GetConfigJson()
    {
        var config = new Dictionary<string, object>
        {
            // GameConstants â€” scalars
            ["GATOR_SIZE"] = GameConstants.GatorSize,
            ["GATOR_COUNT"] = GameConstants.GatorCount,
            ["TICK_MS"] = GameConstants.TickMs,
            ["TALK_DIST"] = GameConstants.TalkDist,
            ["TALK_STOP"] = GameConstants.TalkStop,
            ["HOUSE_ENTER_D"] = GameConstants.HouseEnterD,
            ["SOCIAL_DECAY"] = GameConstants.SocialDecay,
            ["SOCIAL_GAIN"] = GameConstants.SocialGain,
            ["SOCIAL_MAX"] = GameConstants.SocialMax,
            ["SOCIAL_URGENT"] = GameConstants.SocialUrgent,
            ["DAY_TICKS"] = GameConstants.DayTicks,
            ["NIGHT_TICKS"] = GameConstants.NightTicks,
            ["DAWN_TICKS"] = GameConstants.DawnTicks,
            ["DEBATE_TICKS"] = GameConstants.DebateTicks,
            ["HOME_WARN_TICKS"] = GameConstants.HomeWarnTicks,
            ["VOTE_DISPLAY_TICKS"] = GameConstants.VoteDisplayTicks,
            ["MAX_DEBATE_SPEAKERS"] = GameConstants.MaxDebateSpeakers,
            ["DEBATE_SPEAK_COOLDOWN"] = GameConstants.DebateSpeakCooldown,
            ["CONVICTION_THRESHOLD"] = GameConstants.ConvictionThreshold,
            ["PHASE"] = new Dictionary<string, string>
            {
                ["DAY"] = GameConstants.Phase.Day,
                ["NIGHT"] = GameConstants.Phase.Night,
                ["DAWN"] = GameConstants.Phase.Dawn,
                ["DEBATE"] = GameConstants.Phase.Debate,
                ["VOTE"] = GameConstants.Phase.Vote,
                ["EXECUTE"] = GameConstants.Phase.Execute,
                ["OVER"] = GameConstants.Phase.Over
            },

            // PersonalityConstants
            ["PERSONALITIES"] = PersonalityConstants.Personalities,
            ["PERSONALITY_EMOJI"] = PersonalityConstants.PersonalityEmoji,
            ["ACTIVITY_EMOJI"] = PersonalityConstants.ActivityEmoji,
            ["THOUGHT_STAT_BASE"] = PersonalityConstants.ThoughtStatBase,
            ["SOCIAL_STAT_BASE"] = PersonalityConstants.SocialStatBase,
            ["ACTIVITY_WEIGHTS"] = PersonalityConstants.ActivityWeights,
            ["SOCIAL_START"] = PersonalityConstants.SocialStart,
            ["ACTIVITY_TICKS"] = PersonalityConstants.ActivityTicks,
            ["MOOD_MATRIX"] = PersonalityConstants.MoodMatrix,
            ["WALK_SPEED"] = PersonalityConstants.WalkSpeed,
            ["MEMORY_STRENGTH"] = PersonalityConstants.MemoryStrength,

            // AppearanceConstants
            ["NAMES"] = AppearanceConstants.Names,
            ["SKIN_TONES"] = AppearanceConstants.SkinTones,
            ["HAT_STYLES"] = AppearanceConstants.HatStyles,
            ["SHIRT_COLORS"] = AppearanceConstants.ShirtColors,
            ["HOUSE_COLORS"] = AppearanceConstants.HouseColors,

            // RelationshipConstants
            ["LIAR_CHANCE"] = RelationshipConstants.LiarChance,
            ["COMPAT"] = RelationshipConstants.Compat
        };

        return JsonSerializer.Serialize(config, JsonOptions);
    }
}
