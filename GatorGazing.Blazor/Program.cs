using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using GatorGazing.Blazor;
using GatorGazing.Shared.Models;
using GatorGazing.SK.Agents;
using Microsoft.SemanticKernel;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

// Default HttpClient for static assets
builder.Services.AddSingleton(sp => new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });

// LLM provider configuration
// Supports: "AzureOpenAI" or "OpenAI" (for local LLMs like Ollama, LM Studio, llama.cpp, etc.)
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
        Console.WriteLine("WARNING: AzureOpenAI selected but not configured. Set LLM:AzureOpenAI:Endpoint and ApiKey in wwwroot/appsettings.json");
    }
}
else
{
    // OpenAI-compatible endpoint (works with Ollama, LM Studio, llama.cpp, vLLM, etc.)
    var modelId = builder.Configuration["LLM:OpenAI:ModelId"] ?? "llama3";
    var endpoint = builder.Configuration["LLM:OpenAI:Endpoint"] ?? "http://localhost:11434/v1";
    var apiKey = builder.Configuration["LLM:OpenAI:ApiKey"] ?? "not-needed";

    builder.Services.AddOpenAIChatCompletion(
        modelId: modelId,
        endpoint: new Uri(endpoint),
        apiKey: apiKey);
}

// Game state and agent service (in-process)
builder.Services.AddSingleton<GameState>();
builder.Services.AddSingleton<GatorAgentService>();

await builder.Build().RunAsync();
