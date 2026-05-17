namespace SwampOfSalem.Gators.Neural;

/// <summary>
/// Two-layer feed-forward neural network backing a single alligator's reasoning.
/// <para>
/// Architecture: input(64) → hidden(96) → output(48)
/// <list type="bullet">
///   <item><description>Layer 1: 64 → 96 neurons with sigmoid activation</description></item>
///   <item><description>Layer 2: 96 → 48 neurons with sigmoid activation</description></item>
/// </list>
/// </para>
/// <para>
/// <b>Training</b><br/>
/// Training uses a scalar reward signal r ∈ [-1, +1] and works as follows:
/// <list type="number">
///   <item><description>Run a forward pass to get the output vector <c>a</c>.</description></item>
///   <item><description>Compute output error as <c>-r * (a - 0.5)</c> — reward pulls outputs
///        toward 1.0, punishment toward 0.0.</description></item>
///   <item><description>Backpropagate through both layers.</description></item>
/// </list>
/// </para>
/// <para>
/// <b>Thread safety</b><br/>
/// Each gator owns exactly one <see cref="GatorNeuralNet"/> instance which is only
/// accessed from that gator's dedicated <see cref="GatorBrainThread"/>. No locking needed.
/// </para>
/// </summary>
public sealed class GatorNeuralNet
{
    // ── Architecture constants ────────────────────────────────────────────────

    public const int InputDim  = 64;
    public const int HiddenDim = 96;
    public const int OutputDim = 48;

    // ── Layers ────────────────────────────────────────────────────────────────

    private readonly NeuralLayer _hidden;
    private readonly NeuralLayer _output;

    // ── Last inference results ────────────────────────────────────────────────

    private float[] _lastInput  = new float[InputDim];
    private float[] _lastOutput = new float[OutputDim];

    /// <summary>The raw output vector from the most recent <see cref="Infer"/> call.</summary>
    public float[] LastOutput => _lastOutput;

    // ── Statistics ────────────────────────────────────────────────────────────

    public int InferenceCount { get; private set; }
    public int TrainingSteps  { get; private set; }

    // ── Constructor ───────────────────────────────────────────────────────────

    /// <param name="seed">Deterministic seed derived from the gator's ID so each
    /// gator starts with a unique weight distribution.</param>
    public GatorNeuralNet(int seed)
    {
        var rng = new Random(seed);
        _hidden = new NeuralLayer(InputDim,  HiddenDim, rng) { LearningRate = 0.008f };
        _output = new NeuralLayer(HiddenDim, OutputDim, rng) { LearningRate = 0.008f };
    }

    // ── Inference ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Runs a forward pass and returns the output vector.
    /// The vector is also cached so <see cref="Train"/> can backprop without
    /// needing the caller to store it.
    /// </summary>
    public float[] Infer(float[] input)
    {
        if (input.Length != InputDim)
            throw new ArgumentException($"Expected {InputDim} inputs, got {input.Length}.", nameof(input));

        _lastInput  = input;
        var hidden  = _hidden.Forward(input);
        _lastOutput = _output.Forward(hidden);

        InferenceCount++;
        return _lastOutput;
    }

    // ── Training ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Performs one backpropagation step using a scalar reward signal.
    /// <para>
    /// Reward contract:
    /// <list type="bullet">
    ///   <item><description>+1.0 → the last decision was correct / well-aligned</description></item>
    ///   <item><description> 0.0 → neutral (no update)</description></item>
    ///   <item><description>-1.0 → the last decision was wrong / misaligned</description></item>
    /// </list>
    /// </para>
    /// Must be called after <see cref="Infer"/> has been called at least once.
    /// </summary>
    public void Train(float reward)
    {
        if (reward == 0f) return;

        // Error signal: reward > 0 pulls outputs toward 1, reward < 0 pushes toward 0
        var outputGrad = new float[OutputDim];
        for (int i = 0; i < OutputDim; i++)
            outputGrad[i] = -reward * (_lastOutput[i] - 0.5f);

        // Backprop through output layer → get hidden-layer gradient
        var hiddenGrad = _output.Backward(outputGrad);

        // Backprop through hidden layer (gradient w.r.t. input discarded)
        _hidden.Backward(hiddenGrad);

        TrainingSteps++;
    }

    // ── Convenience ───────────────────────────────────────────────────────────

    /// <summary>Returns a human-readable summary of this network's activity.</summary>
    public override string ToString() =>
        $"GatorNet[{InputDim}→{HiddenDim}→{OutputDim}] inferences={InferenceCount} trainSteps={TrainingSteps}";
}
