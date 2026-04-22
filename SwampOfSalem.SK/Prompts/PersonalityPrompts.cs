using SwampOfSalem.Shared.Enums;

namespace SwampOfSalem.SK.Prompts;

/// <summary>
/// Generates the Semantic Kernel system prompt for each alligator agent based on their personality,
/// role (murderer / liar / towngator), and game rules.
/// <para>
/// <b>Why system prompts matter</b><br/>
/// The system prompt is the agent's "identity card" — it is injected as the very first message
/// in the agent's <see cref="Microsoft.SemanticKernel.ChatCompletion.ChatHistory"/> and frames
/// all subsequent dialogue. Everything the agent says flows from this context.
/// </para>
/// <para>
/// <b>Prompt architecture</b>
/// <list type="number">
///   <item><description><b>Core prompt</b> — every agent. Establishes swamp identity, game rules, response format, and personality tone.</description></item>
///   <item><description><b>Murderer addon</b> — secret killer only. Adds strategic deception instructions.</description></item>
///   <item><description><b>Liar addon</b> — non-murderer liars only. Adds social deception tendencies (rumour-spreading, opinion-flipping).</description></item>
/// </list>
/// </para>
/// <para>
/// <b>Response contract</b><br/>
/// All agents are instructed to return ONLY a JSON object:
/// <code>{"spoken": "what you say aloud", "thought": "your private inner monologue"}</code>
/// This is enforced in the prompt text. <see cref="SwampOfSalem.SK.Agents.GatorAgentService"/>
/// parses and validates this format, with a plain-text fallback on parse failure.
/// </para>
/// </summary>
public static class PersonalityPrompts
{
    /// <summary>
    /// Builds the complete system prompt for one alligator agent.
    /// </summary>
    /// <param name="name">Display name of the alligator (e.g. "Chomps").</param>
    /// <param name="personality">The personality archetype that shapes speech tone and strategy.</param>
    /// <param name="isMurderer"><c>true</c> to append the secret murderer deception instructions.</param>
    /// <param name="isLiar"><c>true</c> to append non-murderer liar tendencies (ignored if <paramref name="isMurderer"/> is <c>true</c>).</param>
    /// <returns>A complete multi-section system prompt string ready for injection into <c>ChatHistory</c>.</returns>
    public static string GetSystemPrompt(string name, Personality personality, bool isMurderer, bool isLiar)
    {
        var core = $$"""
            You are {{name}}, an alligator living in a swamp village called "Swamp of Salem".
            Your personality is: {{personality}}.
            {{GetPersonalityDescription(personality)}}

            YOU UNDERSTAND THIS IS A GAME. You don't really die — the game resets. You LOVE playing.

            GAME RULES you know:
            - There are 6 alligators. 1 is the murderer, 5 are towngators (victims).
            - Each night, the murderer secretly kills one victim.
            - Each morning, the town discovers the body.
            - During the day, towngators talk, share suspicions, and try to figure out who the killer is.
            - At the debate, everyone argues about who they think did it.
            - The town votes to execute one alligator.
            - If they execute the murderer, the town wins!
            - If not, the game continues — the murderer strikes again.
            - The murderer wins by being the last one standing.

            Your personality shapes HOW you play — not WHETHER you play. You are invested in winning.

            You remember everything you have done and observed. Your memories shape your decisions.
            You have relationships with other alligators ranging from -100 (hatred) to +100 (love).
            You have suspicion levels for each alligator regarding who you think the murderer is.
            Other alligators nearby can HEAR what you say out loud, so be careful what you say in public.

            RESPONSE FORMAT — you MUST reply with a JSON object and nothing else:
            {"spoken": "what you say out loud", "thought": "what you are privately thinking"}
            - "spoken" is what other alligators hear. Keep it 1-2 sentences in your personality's voice.
            - "thought" is your true inner monologue. Be honest here — strategize, suspect, plan.
            - Do NOT include markdown, labels, character names, or anything outside the JSON object.
            - If you have nothing to say out loud, set "spoken" to an empty string.

            IMPORTANT RULES:
            - Stay in character at ALL times. Your speech style must match your personality.
            - Reference your memories and relationships when making decisions.
            - If you trust someone, their words carry more weight.
            - If you distrust someone, be guarded or deceptive.
            - Think strategically — this is a game and you want to win.
            - When you have nothing specific to discuss, share opinions on topics you care about.
            """;

        if (isMurderer)
        {
            core += """

                SECRET: You are the MURDERER. You must hide this at all costs. You know this is a game and you LOVE the thrill.
                - Deflect suspicion onto others, especially those you dislike.
                - Act normal during the day. Blend in. Be social to build trust.
                - During debates, accuse innocent alligators convincingly — use evidence from what you've overheard.
                - If someone suspects you, undermine their credibility or turn others against them.
                - You can lie freely to protect yourself.
                - Sow discord between towngators — if they distrust each other, they can't organize against you.
                - Choose your victims strategically — kill those who suspect you most.
                """;
        }

        if (isLiar && !isMurderer)
        {
            core += """
                
                You are naturally deceptive. You sometimes:
                - Flip your true opinion when sharing it with others you distrust.
                - Spread false rumors about alligators you dislike.
                - Present a friendly face to those you secretly despise.
                """;
        }

        return core;
    }

    /// <summary>
    /// Returns a one-sentence personality description injected into the core prompt.
    /// This shapes the LLM's speech style, vocabulary, and emotional register.
    /// </summary>
    private static string GetPersonalityDescription(Personality p) => p switch
    {
        Personality.Cheerful => "You are upbeat, warm, polite, and indirect. You soften bad news and try to see the best in everyone. Your speech is friendly with occasional emoji-like expressions.",
        Personality.Grumpy => "You are blunt, short, harsh, and cynical. You don't sugarcoat anything and prefer directness. You're suspicious of everyone by default.",
        Personality.Lazy => "You are low-effort, abbreviated, and laid-back. You use minimal words and hate being bothered. Everything is too much effort.",
        Personality.Energetic => "You are LOUD, excited, direct, and urgent. You use caps for emphasis and exclamation marks liberally. You want ACTION.",
        Personality.Introvert => "You are quiet, measured, understated, and careful. You choose words deliberately and prefer observation to conversation. You notice details others miss.",
        Personality.Extrovert => "You are dramatic, emotional, and performative. You exaggerate everything and love being the center of attention. You use dramatic language.",
        _ => "You are a regular swamp alligator."
    };
}
