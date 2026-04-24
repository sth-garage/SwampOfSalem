using System.Threading.Channels;
using SwampOfSalem.Shared.Models;

namespace SwampOfSalem.Gators.Neural;

/// <summary>
/// One dedicated background thread that runs a single alligator's neural network
/// on a continuous inference loop.
/// <para>
/// <b>Thread lifecycle:</b>
/// <list type="number">
///   <item><description><see cref="Start"/> spins up the thread. The thread runs until
///        <see cref="Stop"/> is called or the game resets.</description></item>
///   <item><description>Each tick the thread:
///     <list type="bullet">
///       <item><description>Drains all pending <see cref="InterGatorSignal"/> messages from its channel
///            and accumulates them into a combined inbound signal vector.</description></item>
///       <item><description>Encodes the current alligator state via <see cref="NeuralInput.Encode"/>.</description></item>
///       <item><description>Runs <see cref="GatorNeuralNet.Infer"/> to get the output vector.</description></item>
///       <item><description>Decodes the output via <see cref="NeuralOutput.Decode"/> and stores it
///            as the latest <see cref="LatestOutput"/>.</description></item>
///       <item><description>Broadcasts an <see cref="InterGatorSignal"/> to the target gator's channel
///            if outbound strength &gt; 0.5.</description></item>
///       <item><description>Applies any pending reward signal via <see cref="GatorNeuralNet.Train"/>.</description></item>
///       <item><description>Sleeps for <see cref="TickIntervalMs"/> milliseconds.</description></item>
///     </list>
///   </description></item>
/// </list>
/// </para>
/// <para>
/// <b>Thread safety:</b>
/// The thread only READS <see cref="Alligator"/> and <see cref="GameState"/> — it never writes to them.
/// All writes happen via <see cref="NeuralBrainOrchestrator.ApplyOutputs"/> on the server request thread.
/// <see cref="LatestOutput"/> is guarded by a lock so the server thread can safely read it.
/// <see cref="QueueReward"/> is thread-safe (volatile flag + Interlocked).
/// </para>
/// </summary>
public sealed class GatorBrainThread : IDisposable
{
    // ── Identity ──────────────────────────────────────────────────────────────

    public int GatorId { get; }

    // ── Neural net ────────────────────────────────────────────────────────────

    private readonly GatorNeuralNet _net;

    // ── State (shared read-only references, written only from server thread) ──

    private readonly Alligator _gator;
    private readonly GameState _gameState;
    private readonly List<MemoryEntry> _memories;

    // ── Signal channel (written to by other gators' threads) ──────────────────

    /// <summary>
    /// Unbounded channel into which other threads write <see cref="InterGatorSignal"/>
    /// messages directed at this gator.
    /// </summary>
    public readonly Channel<InterGatorSignal> InboundChannel =
        Channel.CreateUnbounded<InterGatorSignal>(new UnboundedChannelOptions
        {
            SingleReader = true,   // only this gator's thread reads
            AllowSynchronousContinuations = false,
        });

    // ── Output (written by thread, read by server thread) ─────────────────────

    private NeuralOutputData? _latestOutput;
    private readonly object   _outputLock = new();

    /// <summary>
    /// The most recently decoded output from this thread's neural net.
    /// Returns <see langword="null"/> until the first inference completes.
    /// </summary>
    public NeuralOutputData? LatestOutput
    {
        get { lock (_outputLock) return _latestOutput; }
        private set { lock (_outputLock) _latestOutput = value; }
    }

    // ── Signal broadcast callback ─────────────────────────────────────────────

    /// <summary>
    /// Delegate called when this thread wants to send a signal to another gator.
    /// Provided by <see cref="NeuralBrainOrchestrator"/> so the thread doesn't
    /// need to hold a reference to the full orchestrator.
    /// </summary>
    public Action<InterGatorSignal>? OnBroadcastSignal { get; set; }

    // ── Reward queue ──────────────────────────────────────────────────────────

    private float _pendingReward = 0f;
    private volatile bool _hasReward = false;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    private CancellationTokenSource _cts = new();
    private Thread? _thread;

    /// <summary>How long the thread sleeps between inference ticks (ms).</summary>
    public int TickIntervalMs { get; set; } = 100;

    // ── Constructor ───────────────────────────────────────────────────────────

    public GatorBrainThread(
        int gatorId,
        Alligator gator,
        GameState gameState,
        List<MemoryEntry> memories)
    {
        GatorId    = gatorId;
        _gator     = gator;
        _gameState = gameState;
        _memories  = memories;
        _net       = new GatorNeuralNet(gatorId * 31 + 7);
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /// <summary>Starts the background inference loop.</summary>
    public void Start()
    {
        _cts = new CancellationTokenSource();
        _thread = new Thread(Run)
        {
            IsBackground = true,
            Name         = $"GatorBrain-{GatorId}-{_gator.Name}",
            Priority     = ThreadPriority.BelowNormal,
        };
        _thread.Start();
    }

    /// <summary>Signals the thread to stop and waits up to 500 ms for it to exit.</summary>
    public void Stop()
    {
        _cts.Cancel();
        _thread?.Join(500);
    }

    /// <summary>
    /// Enqueues a scalar reward to be consumed on the next training step.
    /// Thread-safe; can be called from any thread.
    /// </summary>
    public void QueueReward(float reward)
    {
        // Use interlocked to safely accumulate rewards from multiple sources
        float current;
        float updated;
        do
        {
            current = Volatile.Read(ref _pendingReward);
            updated = Math.Clamp(current + reward, -1f, 1f);
        }
        while (Interlocked.CompareExchange(ref _pendingReward, updated, current) != current);

        _hasReward = true;
    }

    // ── Thread loop ───────────────────────────────────────────────────────────

    private void Run()
    {
        var ct = _cts.Token;

        while (!ct.IsCancellationRequested)
        {
            try
            {
                // ── 1. Drain inbound signals ──────────────────────────────
                var accumulated = new float[8];
                int signalCount = 0;

                while (InboundChannel.Reader.TryRead(out var sig))
                {
                    for (int i = 0; i < 8 && i < sig.Payload.Length; i++)
                        accumulated[i] += sig.Payload[i];
                    signalCount++;
                }

                // Normalise accumulated signals if we received more than one
                if (signalCount > 1)
                    for (int i = 0; i < 8; i++)
                        accumulated[i] /= signalCount;

                // ── 2. Encode current state ───────────────────────────────
                float[] input;
                lock (_gator) // brief read-only lock while we snapshot state
                {
                    input = NeuralInput.Encode(
                        _gator, _gameState, _memories,
                        signalCount > 0 ? accumulated : null);
                }

                // ── 3. Run inference ──────────────────────────────────────
                var raw = _net.Infer(input);

                // ── 4. Decode and store output ────────────────────────────
                NeuralOutputData decoded;
                lock (_gator)
                {
                    decoded = NeuralOutput.Decode(raw, _gator, _gameState);
                }
                LatestOutput = decoded;

                // ── 5. Broadcast outbound signal if strong enough ─────────
                if (decoded.OutboundStrength > 0.5f && decoded.OutboundTargetId >= 0)
                {
                    var payload = InterGatorSignal.BuildPayload(raw, GatorNeuralNet.OutputDim);
                    var signal  = new InterGatorSignal
                    {
                        SourceId = GatorId,
                        TargetId = decoded.OutboundTargetId,
                        Payload  = payload,
                        Day      = _gameState.DayNumber,
                    };
                    OnBroadcastSignal?.Invoke(signal);
                }

                // ── 6. Train on any pending reward ────────────────────────
                if (_hasReward)
                {
                    _hasReward = false;
                    float reward = Interlocked.Exchange(ref _pendingReward, 0f);
                    _net.Train(reward);
                }

                // ── 7. Sleep ───────────────────────────────────────────────
                Thread.Sleep(TickIntervalMs);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                // Log but continue — one bad tick shouldn't kill the thread
                Console.Error.WriteLine(
                    $"[GatorBrainThread-{GatorId}] Unhandled exception: {ex.Message}");
                Thread.Sleep(TickIntervalMs * 2);
            }
        }
    }

    // ── Diagnostics ───────────────────────────────────────────────────────────

    /// <summary>Returns a summary of this thread's neural activity.</summary>
    public string GetStats() =>
        $"Gator {GatorId} ({_gator.Name}): {_net} | thread alive={_thread?.IsAlive}";

    // ── Dispose ───────────────────────────────────────────────────────────────

    public void Dispose()
    {
        Stop();
        _cts.Dispose();
    }
}
