namespace SwampOfSalem.Shared.Enums;

/// <summary>
/// Represents the current on-canvas activity of an alligator during the Day phase.
/// <para>
/// The frontend simulation loop reads this value to decide which animation frame
/// and speech-bubble logic to render. Personality weights in
/// <c>PersonalityConstants.ActivityWeights</c> determine how frequently each
/// alligator transitions into each activity.
/// </para>
/// </summary>
public enum Activity
{
    /// <summary>
    /// The alligator is walking toward a target position on the canvas.
    /// Most common activity; all gators default to this state.
    /// </summary>
    Moving,

    /// <summary>
    /// The alligator has stopped to talk with a nearby neighbour.
    /// While talking, <c>SocialNeed</c> refills and relationships drift.
    /// </summary>
    Talking,

    /// <summary>
    /// The alligator is inside their own home and has invited visitors in.
    /// Hosting conversations are private — cannot be overheard by passers-by.
    /// </summary>
    Hosting,

    /// <summary>
    /// The alligator has entered another gator's home for a private conversation.
    /// Like Hosting, these chats are hidden from the rest of the swamp.
    /// </summary>
    Visiting,

    /// <summary>
    /// The alligator is participating in the public Debate phase accusation round.
    /// This activity is set by <c>phases.js</c> and is not driven by personality weights.
    /// </summary>
    Debating
}
