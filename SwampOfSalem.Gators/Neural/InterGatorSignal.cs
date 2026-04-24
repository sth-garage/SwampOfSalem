namespace SwampOfSalem.Gators.Neural;

/// <summary>
/// A lightweight influence message broadcast from one gator's neural thread
/// to another gator's input channel.
/// <para>
/// Each tick a gator's neural net decides whether to broadcast a signal
/// (controlled by output[46] — outbound strength). If strength &gt; 0.5 the
/// thread writes an <see cref="InterGatorSignal"/> into the target gator's
/// <c>Channel&lt;InterGatorSignal&gt;</c>. On the next inference the target gator
/// reads all pending signals, sums them into its <c>inboundSignal</c> float[8]
/// slot of the input vector, and the cycle continues.
/// </para>
/// <para>
/// <b>Signal semantics (8 floats, all [0, 1]):</b>
/// <list type="bullet">
///   <item><description>[0] Suspicion broadcast — "I think you're suspicious." </description></item>
///   <item><description>[1] Trust broadcast — "I trust you."</description></item>
///   <item><description>[2] Fear broadcast — "I'm scared."</description></item>
///   <item><description>[3] Alliance proposal — "I want to work with you."</description></item>
///   <item><description>[4] Warning — "Someone's after me/you."</description></item>
///   <item><description>[5] Gossip — generic information transfer intensity.</description></item>
///   <item><description>[6] Hostility — "I'm turning against you."</description></item>
///   <item><description>[7] Strength — how confident the sender feels overall.</description></item>
/// </list>
/// The receiver uses these values as part of the [36–43] input slots.
/// </para>
/// </summary>
public sealed record InterGatorSignal
{
    /// <summary>ID of the alligator that produced this signal.</summary>
    public required int SourceId { get; init; }

    /// <summary>ID of the intended recipient. -1 means broadcast to all.</summary>
    public required int TargetId { get; init; }

    /// <summary>8-float signal payload (see class-level documentation for semantics).</summary>
    public required float[] Payload { get; init; }

    /// <summary>Game day on which this signal was generated.</summary>
    public required int Day { get; init; }

    /// <summary>
    /// Builds the outbound signal payload from the neural net's output vector.
    /// Extracts meaningful dimensions from the output and maps them to the 8 signal slots.
    /// </summary>
    public static float[] BuildPayload(float[] nnOutput, int outputDim)
    {
        if (outputDim < 48)
            return new float[8];

        // Map NN output dimensions to semantically meaningful signal components
        return
        [
            // [0] Suspicion: average of top-3 suspicion outputs
            (nnOutput[0] + nnOutput[1] + nnOutput[2]) / 3f,

            // [1] Trust: complement of suspicion (high trust = low suspicion)
            1f - (nnOutput[0] + nnOutput[1] + nnOutput[2]) / 3f,

            // [2] Fear: average of Cornered/Desperate/Hunted mood weights [5+6, 5+7, 5+8]
            (nnOutput[11] + nnOutput[12] + nnOutput[13]) / 3f,

            // [3] Alliance: Bonded mood weight [5+14] + trust relation output [41]
            (nnOutput[19] + nnOutput[41]) / 2f,

            // [4] Warning: Hunted mood weight [5+9]
            nnOutput[14],

            // [5] Gossip: social desire output [40]
            nnOutput[40],

            // [6] Hostility: Betrayed mood weight [5+15] + negative relation output [42]
            (nnOutput[20] + nnOutput[42]) / 2f,

            // [7] Strength: outbound strength output [46]
            nnOutput[46],
        ];
    }
}
