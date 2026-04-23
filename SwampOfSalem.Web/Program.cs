// ════════════════════════════════════════════════════════════════════════════════
// Swamp of Salem — ASP.NET Core Minimal API Host
// ════════════════════════════════════════════════════════════════════════════════
//
// This file is the entire server. There are no controllers — every endpoint is a
// one-liner lambda registered directly on the WebApplication (Minimal API style).
//
// Service registration order:
//   1. Semantic Kernel (AddKernel)
//   2. LLM provider (Azure OpenAI or OpenAI-compatible, read from appsettings.json)
//   3. GameState singleton  — shared mutable game session snapshot
//   4. GatorAgentService singleton — owns all SK agents and their chat histories
//
// Endpoint groups:
//   POST /api/agent/*  — AI agent actions (dialog, vote, memory, conversation, etc.)
//   GET  /api/game-config — serialises all C# game constants to JSON for the JS client
//   GET  /api/config      — returns the active LLM provider info for the test panel
//
// Static files (wwwroot/) are served by UseDefaultFiles + UseStaticFiles.
// The entire frontend is plain HTML + ES-module JavaScript; no Blazor/React.
//
// ════════════════════════════════════════════════════════════════════════════════
using SwampOfSalem.Shared.DTOs;
using SwampOfSalem.Shared.Models;
using SwampOfSalem.SK.Agents;
using SwampOfSalem.Gators;
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.ChatCompletion;

// ── LLM Provider configuration ────────────────────────────────────────────────
// The active provider is selected via "LLM:Provider" in appsettings.json.
// Supported values: "OpenAI" (default, also works with local LM Studio / Ollama)
//                   "AzureOpenAI"
// ⚠️  Never commit real API keys in appsettings.json — use dotnet user-secrets instead.
var builder = WebApplication.CreateBuilder(args);

// LLM provider configuration
var llmProvider = builder.Configuration["LLM:Provider"] ?? "OpenAI";

// Semantic Kernel
builder.Services.AddKernel();

if (llmProvider.Equals("AzureOpenAI", StringComparison.OrdinalIgnoreCase))
{
    var deploymentName = builder.Configuration["LLM:AzureOpenAI:DeploymentName"] ?? "gpt-4o";
    var endpoint = builder.Configuration["LLM:AzureOpenAI:Endpoint"] ?? "";
    var apiKey = builder.Configuration["LLM:AzureOpenAI:ApiKey"] ?? "";

    if (!string.IsNullOrEmpty(endpoint) && !string.IsNullOrEmpty(apiKey))
    {
        builder.Services.AddAzureOpenAIChatCompletion(deploymentName, endpoint, apiKey);
    }
    else
    {
        Console.WriteLine("WARNING: AzureOpenAI selected but not configured.");
    }
}
else
{
    var modelId = builder.Configuration["LLM:OpenAI:ModelId"] ?? "llama3";
    var endpoint = builder.Configuration["LLM:OpenAI:Endpoint"] ?? "http://localhost:11434/v1";
    var apiKey = builder.Configuration["LLM:OpenAI:ApiKey"] ?? "not-needed";

    builder.Services.AddOpenAIChatCompletion(
        modelId: modelId,
        endpoint: new Uri(endpoint),
        apiKey: apiKey);
}

// Game state and agent service (in-process, singleton for single-user game)
builder.Services.AddSingleton<GameState>();
builder.Services.AddSingleton<GatorAgentService>();
builder.Services.AddSingleton<GatorBrainService>(sp => new GatorBrainService(sp.GetRequiredService<GameState>()));

// DialogRouter delegates all calls to either GatorAgentService (AI) or GatorBrainService (rule-based)
// based on a runtime-switchable Mode setting seeded from appsettings "DialogSource".
builder.Services.AddSingleton<DialogRouter>(sp => new DialogRouter(
    sp.GetRequiredService<GatorAgentService>(),
    sp.GetRequiredService<GatorBrainService>(),
    builder.Configuration["DialogSource"] ?? "AI"));

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

// ── API Endpoints ───────────────────────────────────────────────────────────
// All agent endpoints live under /api/agent and delegate to GatorAgentService.
//
var api = app.MapGroup("/api/agent");

api.MapPost("/initialize", (AlligatorSpawnData[] alligators, DialogRouter agents) =>
{
    agents.InitializeFromSpawnData(alligators);
    return Results.Ok();
});

api.MapPost("/dialog", async (AgentDialogRequest request, DialogRouter agents) =>
{
    try
    {
        var response = await agents.GenerateDialogAsync(request);
        return Results.Ok(new { message = response.Message, thought = response.Thought });
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"GetAgentDialog failed for {request.AlligatorId}: {ex.Message}");
        return Results.Ok(new { message = $"*{request.DialogType}*", thought = (string?)null });
    }
});

api.MapPost("/thought", async (AgentDialogRequest request, DialogRouter agents) =>
{
    try
    {
        request.DialogType = "thought";
        var response = await agents.GenerateDialogAsync(request);
        return Results.Ok(new { message = response.Message, thought = response.Thought });
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"GetAgentThought failed for {request.AlligatorId}: {ex.Message}");
        return Results.Ok(new { message = "*thinking*", thought = (string?)null });
    }
});

api.MapPost("/vote", async (VoteRequest request, DialogRouter agents) =>
{
    var response = await agents.GetVoteAsync(request);
    return Results.Ok(new { voteForId = response.VoteForId });
});

api.MapPost("/memory", (MemoryRequest request, DialogRouter agents) =>
{
    agents.AddMemory(request.AlligatorId, new MemoryEntry
    {
        Day = request.Day,
        Type = request.Type,
        Detail = request.Detail,
        RelatedAlligatorId = request.RelatedId
    });
    return Results.Ok();
});

api.MapPost("/memory/batch", (MemoryBatchRequest request, DialogRouter agents) =>
{
    foreach (var entry in request.Entries)
    {
        agents.AddMemory(request.AlligatorId, new MemoryEntry
        {
            Day = entry.Day,
            Type = entry.Type,
            Detail = entry.Detail,
            RelatedAlligatorId = entry.RelatedId
        });
    }
    return Results.Ok();
});

api.MapPost("/night-report", async (NightReportRequest request, DialogRouter agents) =>
{
    try
    {
        var response = await agents.GenerateNightReportAsync(request.AliveIds);
        return Results.Ok(response);
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"GenerateNightReport failed: {ex.Message}");
        return Results.Ok(new NightReportResponse { Entries = [] });
    }
});

api.MapPost("/conversation", async (ChatConversationRequest request, DialogRouter agents) =>
{
    try
    {
        Console.WriteLine($"[API /conversation] Request: initiator={request.InitiatorId}, responder={request.ResponderId}, maxTurns={request.MaxTurns}");
        var response = await agents.GenerateFullConversationAsync(request);
        Console.WriteLine($"[API /conversation] Response: {response.Messages.Count} messages");
        return Results.Ok(response);
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"GenerateFullConversation failed: {ex.Message}\n{ex.StackTrace}");
        return Results.Ok(new ChatConversationResponse
        {
            InitiatorId = request.InitiatorId,
            ResponderId = request.ResponderId,
            Messages = new List<ConversationMessage>()
        });
    }
});

// AI connection test endpoint
api.MapPost("/test-chat", async (TestChatRequest request, Kernel kernel) =>
{
    try
    {
        var chatService = kernel.GetRequiredService<IChatCompletionService>();
        var history = new ChatHistory(
            "You are a friendly alligator named Gus who lives in a swamp. Keep responses brief (1-2 sentences).");
        foreach (var m in request.Messages)
        {
            if (m.IsUser)
                history.AddUserMessage(m.Text);
            else
                history.AddAssistantMessage(m.Text);
        }
        var result = await chatService.GetChatMessageContentAsync(history);
        return Results.Ok(new { message = result.Content ?? "(empty response)" });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { message = "âŒ Connection failed", error = ex.Message });
    }
});

// Get Gator â€” generate a randomized, fully fleshed-out alligator character
api.MapPost("/get-gator", async (Kernel kernel) =>
{
    try
    {
        var chatService = kernel.GetRequiredService<IChatCompletionService>();

        var systemPrompt = """
You are a creative character designer for a murder-mystery swamp simulation called "Swamp of Salem."
Your job is to invent a unique alligator character. Be creative, specific, and consistent.
You MUST respond with EXACTLY two sections, in this order:

--- NARRATIVE ---
A rich 3-5 sentence description of who this alligator is: their backstory, personality quirks,
what they love or hate about swamp life, how they come across to others, and one notable secret or flaw.

--- JSON ---
A valid JSON object (no markdown, no code fences, just raw JSON) with these exact fields:
{
  "name": "string â€” a swamp-themed alligator name (first name only)",
  "personality": "one of: cheerful, grumpy, lazy, energetic, introvert, extrovert",
  "mood": "one of: content, anxious, suspicious, friendly, brooding, excitable",
  "liar": true or false,
  "thoughtStat": integer 1â€“10 (how perceptive / introspective they are),
  "topicOpinions": {
    "mud wallowing": integer -100 to 100,
    "fish tacos": integer -100 to 100,
    "loud splashing": integer -100 to 100,
    "sharing territory": integer -100 to 100,
    "napping in sunbeams": integer -100 to 100,
    "strangers near the nest": integer -100 to 100,
    "hunting at dawn": integer -100 to 100,
    "swamp gossip": integer -100 to 100,
    "sunbathing on rocks": integer -100 to 100,
    "trusting outsiders": integer -100 to 100,
    "long swims": integer -100 to 100,
    "tall grass hiding spots": integer -100 to 100,
    "the old ways": integer -100 to 100,
    "new arrivals in the swamp": integer -100 to 100,
    "cooperation over competition": integer -100 to 100,
    "hoarding fish": integer -100 to 100,
    "loud singing at night": integer -100 to 100,
    "clean water vs murky water": integer -100 to 100,
    "settling disputes with a duel": integer -100 to 100
  },
  "likes": ["3-5 short strings describing what they enjoy"],
  "dislikes": ["3-5 short strings describing what bothers them"],
  "secret": "one sentence â€” a private fact they would never admit",
  "catchphrase": "a short distinctive phrase they might say"
}

Rules:
- Opinions in topicOpinions must match personality (e.g. grumpy gators are suspicious of strangers)
- liar should be true about 20% of the time
- thoughtStat for introvert/grumpy should trend 7-10; for extrovert/cheerful trend 2-5
- Every field is required
""";

        var history = new ChatHistory(systemPrompt);
        history.AddUserMessage("Generate a completely random alligator character for me.");

        var result = await chatService.GetChatMessageContentAsync(history);
        var raw = result.Content ?? "";

        // Split into narrative and JSON sections
        var narrativeIdx = raw.IndexOf("--- NARRATIVE ---", StringComparison.OrdinalIgnoreCase);
        var jsonIdx      = raw.IndexOf("--- JSON ---",      StringComparison.OrdinalIgnoreCase);

        string narrative = "";
        string json      = "{}";

        if (narrativeIdx >= 0 && jsonIdx > narrativeIdx)
        {
            narrative = raw[(narrativeIdx + 17)..jsonIdx].Trim();
            var jsonSection = raw[(jsonIdx + 12)..].Trim();
            // Strip any accidental code fences
            if (jsonSection.StartsWith("```")) jsonSection = jsonSection[(jsonSection.IndexOf('\n') + 1)..];
            if (jsonSection.EndsWith("```"))   jsonSection = jsonSection[..jsonSection.LastIndexOf("```")];
            json = jsonSection.Trim();
        }
        else
        {
            narrative = raw;
        }

        return Results.Ok(new { narrative, json });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { narrative = "âŒ Generation failed: " + ex.Message, json = "{}" });
    }
});

// Game config endpoint â€” returns all game constants as JSON for the JS simulation
app.MapGet("/api/game-config", () =>
{
    var json = SwampOfSalem.AppLogic.Services.GameConfigProvider.GetConfigJson();
    return Results.Content(json, "application/json");
});

// Configuration info endpoint for the test panel
app.MapGet("/api/config", (IConfiguration config, DialogRouter router) =>
{
    var provider = config["LLM:Provider"] ?? "OpenAI";
    return Results.Ok(new
    {
        provider,
        model = provider.Equals("AzureOpenAI", StringComparison.OrdinalIgnoreCase)
            ? config["LLM:AzureOpenAI:DeploymentName"] ?? "gpt-4o"
            : config["LLM:OpenAI:ModelId"] ?? "llama3",
        endpoint = provider.Equals("AzureOpenAI", StringComparison.OrdinalIgnoreCase)
            ? config["LLM:AzureOpenAI:Endpoint"] ?? ""
            : config["LLM:OpenAI:Endpoint"] ?? "http://localhost:11434/v1",
        dialogSource = router.Mode
    });
});

// Dialog-source endpoints — let the UI read and switch the active response engine at runtime
app.MapGet("/api/dialog-source", (DialogRouter router) =>
    Results.Ok(new { dialogSource = router.Mode }));

app.MapPost("/api/dialog-source", (DialogSourceRequest req, DialogRouter router) =>
{
    router.Mode = (req.DialogSource ?? "AI").Trim();
    return Results.Ok(new { dialogSource = router.Mode });
});

app.Run();

// â”€â”€ Request DTOs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

record MemoryRequest(int AlligatorId, int Day, string Type, string Detail, int? RelatedId);
record MemoryBatchEntry(int Day, string Type, string Detail, int? RelatedId);
record MemoryBatchRequest(int AlligatorId, List<MemoryBatchEntry> Entries);
record TestChatRequest(List<TestChatMessage> Messages);
record TestChatMessage(bool IsUser, string Text);
record DialogSourceRequest(string? DialogSource);

// ── DialogRouter ──────────────────────────────────────────────────────────────
// Wraps GatorAgentService (AI) and GatorBrainService (rule-based) and delegates
// every call to whichever is currently active. Mode can be switched at runtime
// via POST /api/dialog-source without restarting the server.
// ─────────────────────────────────────────────────────────────────────────────
class DialogRouter(GatorAgentService ai, GatorBrainService brain, string initialMode)
{
    /// <summary>Active engine: "AI" (Semantic Kernel) or "RuleBased" (SwampOfSalem.Gators).</summary>
    public string Mode { get; set; } = initialMode;

    private bool UseAi => !Mode.Equals("RuleBased", StringComparison.OrdinalIgnoreCase);

    public void InitializeFromSpawnData(IEnumerable<AlligatorSpawnData> data)
    {
        if (UseAi) ai.InitializeFromSpawnData(data);
        else brain.InitializeFromSpawnData(data);
    }

    public void InitializeAgents()
    {
        if (UseAi) ai.InitializeAgents();
        else brain.InitializeAgents();
    }

    public void AddMemory(int id, MemoryEntry memory)
    {
        if (UseAi) ai.AddMemory(id, memory);
        else brain.AddMemory(id, memory);
    }

    public Task<AgentDialogResponse> GenerateDialogAsync(AgentDialogRequest req)
        => UseAi ? ai.GenerateDialogAsync(req) : brain.GenerateDialogAsync(req);

    public Task<DebateRoundResponse> RunDebateRoundAsync(DebateRoundRequest req)
        => UseAi ? ai.RunDebateRoundAsync(req) : brain.RunDebateRoundAsync(req);

    public Task<VoteResponse> GetVoteAsync(VoteRequest req)
        => UseAi ? ai.GetVoteAsync(req) : brain.GetVoteAsync(req);

    public Task<ChatConversationResponse> GenerateFullConversationAsync(ChatConversationRequest req)
        => UseAi ? ai.GenerateFullConversationAsync(req) : brain.GenerateFullConversationAsync(req);

    public Task<NightReportResponse> GenerateNightReportAsync(List<int> aliveIds)
        => UseAi ? ai.GenerateNightReportAsync(aliveIds) : brain.GenerateNightReportAsync(aliveIds);
}
