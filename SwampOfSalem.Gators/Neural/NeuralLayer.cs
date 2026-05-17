namespace SwampOfSalem.Gators.Neural;

/// <summary>
/// A single fully-connected layer of a feed-forward neural network.
/// <para>
/// Stores a weight matrix W[outputs, inputs] and a bias vector b[outputs].
/// Supports forward inference and a simple SGD weight update driven by an
/// upstream gradient signal from the next layer (or a scalar reward).
/// </para>
/// <para>
/// Weights are initialised with Xavier uniform scaling so that signal variance
/// is approximately preserved across layers at game start.
/// </para>
/// </summary>
public sealed class NeuralLayer
{
    // ── Dimensions ────────────────────────────────────────────────────────────

    public int InputSize  { get; }
    public int OutputSize { get; }

    // ── Parameters ────────────────────────────────────────────────────────────

    /// <summary>Weight matrix W[outputIdx, inputIdx].</summary>
    private readonly float[,] _w;

    /// <summary>Bias vector b[outputIdx].</summary>
    private readonly float[] _b;

    // ── Cached activations (needed for backprop) ──────────────────────────────

    private float[] _lastInput  = [];
    private float[] _lastPreAct = [];   // pre-activation (z = Wx + b)
    private float[] _lastOutput = [];   // post-activation (a = σ(z))

    // ── Hyperparameters ───────────────────────────────────────────────────────

    /// <summary>Stochastic gradient descent learning rate.</summary>
    public float LearningRate { get; set; } = 0.01f;

    // ── Constructor ───────────────────────────────────────────────────────────

    public NeuralLayer(int inputSize, int outputSize, Random rng)
    {
        InputSize  = inputSize;
        OutputSize = outputSize;

        _w = new float[outputSize, inputSize];
        _b = new float[outputSize];

        // Xavier uniform: range = ±sqrt(6 / (fan_in + fan_out))
        float limit = MathF.Sqrt(6f / (inputSize + outputSize));
        for (int o = 0; o < outputSize; o++)
        {
            _b[o] = 0f;
            for (int i = 0; i < inputSize; i++)
                _w[o, i] = (float)(rng.NextDouble() * 2 - 1) * limit;
        }
    }

    // ── Forward pass ─────────────────────────────────────────────────────────

    /// <summary>
    /// Computes a = σ(Wx + b) and caches intermediate values for backprop.
    /// Uses sigmoid activation so every output is naturally bounded [0, 1].
    /// </summary>
    public float[] Forward(float[] input)
    {
        _lastInput  = input;
        _lastPreAct = new float[OutputSize];
        _lastOutput = new float[OutputSize];

        for (int o = 0; o < OutputSize; o++)
        {
            float z = _b[o];
            for (int i = 0; i < InputSize; i++)
                z += _w[o, i] * input[i];

            _lastPreAct[o] = z;
            _lastOutput[o] = Sigmoid(z);
        }

        return _lastOutput;
    }

    // ── Backward pass ─────────────────────────────────────────────────────────

    /// <summary>
    /// Backpropagates <paramref name="outputGradient"/> (dL/da for each output neuron),
    /// updates W and b via SGD, and returns the gradient to pass to the previous layer
    /// (dL/dx — useful for chaining layers).
    /// </summary>
    public float[] Backward(float[] outputGradient)
    {
        // dL/dz = dL/da * σ'(z)   where σ'(z) = a*(1-a)
        var dz = new float[OutputSize];
        for (int o = 0; o < OutputSize; o++)
        {
            float a = _lastOutput[o];
            dz[o] = outputGradient[o] * a * (1f - a);
        }

        // Gradient for previous layer: dL/dx = W^T · dz
        var inputGradient = new float[InputSize];
        for (int i = 0; i < InputSize; i++)
        {
            float g = 0f;
            for (int o = 0; o < OutputSize; o++)
                g += _w[o, i] * dz[o];
            inputGradient[i] = g;
        }

        // SGD update: W -= lr * dz · x^T,  b -= lr * dz
        for (int o = 0; o < OutputSize; o++)
        {
            _b[o] -= LearningRate * dz[o];
            for (int i = 0; i < InputSize; i++)
                _w[o, i] -= LearningRate * dz[o] * _lastInput[i];
        }

        return inputGradient;
    }

    // ── Activation ────────────────────────────────────────────────────────────

    private static float Sigmoid(float x)
    {
        // Numerically stable sigmoid
        if (x >= 0f)
        {
            float e = MathF.Exp(-x);
            return 1f / (1f + e);
        }
        else
        {
            float e = MathF.Exp(x);
            return e / (1f + e);
        }
    }
}
