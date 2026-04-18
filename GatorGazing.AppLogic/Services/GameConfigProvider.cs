using System.Text.Json;
using System.Text.Json.Serialization;
using GatorGazing.AppLogic.Constants;

namespace GatorGazing.AppLogic.Services;

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
            // GameConstants — scalars
            ["PERSON_SIZE"] = GameConstants.PersonSize,
            ["PEOPLE_COUNT"] = GameConstants.PeopleCount,
            ["TICK_MS"] = GameConstants.TickMs,
            ["TALK_DIST"] = GameConstants.TalkDist,
            ["TALK_STOP"] = GameConstants.TalkStop,
            ["HOUSE_ENTER_D"] = GameConstants.HouseEnterD,
            ["APPLE_PRICE"] = GameConstants.ApplePrice,
            ["ORANGE_PRICE"] = GameConstants.OrangePrice,
            ["ORANGE_LOVER_DEBT_MAX"] = GameConstants.OrangeLoverDebtMax,
            ["OBSERVE_SHOP_RADIUS"] = GameConstants.ObserveShopRadius,
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
            ["ORANGE_LOVER_CHANCE"] = PersonalityConstants.OrangeLoverChance,
            ["MEMORY_STRENGTH"] = PersonalityConstants.MemoryStrength,

            // DialogConstants
            ["DIALOGUE"] = DialogConstants.Dialogue,
            ["INVITE_LINES"] = DialogConstants.InviteLines,
            ["THOUGHTS"] = DialogConstants.Thoughts,
            ["MURDERER_BLUFF"] = DialogConstants.MurdererBluff,
            ["ACCUSE_LINES"] = DialogConstants.AccuseLines,
            ["DEFEND_LINES"] = DialogConstants.DefendLines,
            ["MOURN_LINES"] = DialogConstants.MournLines,
            ["DEBATE_ARGUMENT_LINES"] = DialogConstants.DebateArgumentLines,
            ["GUARDED_LINES"] = DialogConstants.GuardedLines,
            ["LIE_INCRIMINATE_LINES"] = DialogConstants.LieIncriminateLines,
            ["SHOP_LINES"] = DialogConstants.ShopLines,
            ["ORANGE_BUY_LINES"] = DialogConstants.OrangeBuyLines,
            ["THEFT_WITNESS_LINES"] = DialogConstants.TheftWitnessLines,
            ["VICTIM_REACT_LINES"] = DialogConstants.VictimReactLines,
            ["OPINION_SHARE_LINES_POS"] = DialogConstants.OpinionShareLinesPos,
            ["OPINION_SHARE_LINES_NEG"] = DialogConstants.OpinionShareLinesNeg,
            ["DAWN_THOUGHTS_INNOCENT"] = DialogConstants.DawnThoughtsInnocent,
            ["DAWN_THOUGHTS_MURDERER"] = DialogConstants.DawnThoughtsMurderer,
            ["PERSUADE_LINES"] = DialogConstants.PersuadeLines,
            ["RELATION_THOUGHTS"] = DialogConstants.RelationThoughts,

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
