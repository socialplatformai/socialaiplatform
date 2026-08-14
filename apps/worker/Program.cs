using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Infrastructure;
using SocialAi.Worker;
using SocialAi.Worker.Jobs;

var builder = Host.CreateApplicationBuilder(args);

var pg = builder.Configuration.GetConnectionString("Postgres")
         ?? "Host=localhost;Port=5432;Database=social_ai;Username=social;Password=changeme";

// DbContext compartilhado (Domain+Data da API). Jobs são sistêmicos: ICurrentWorkspace=null.
builder.Services.AddSingleton<ICurrentWorkspace, SystemWorkspace>();
// EnableRetryOnFailure: em PaaS o Postgres pode estar lento/reiniciando quando o worker sobe.
// A estratégia de retry do Npgsql reabre conexões em falhas transitórias, evitando que um job
// (BackgroundService) morra por uma indisponibilidade momentânea do banco — robustez de boot.
builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseNpgsql(pg, npg => npg.EnableRetryOnFailure()));

// B4/D3 (ADR-0009): custo + transição compartilhada (mesmo dono do poll da API) + cliente de
// poll do agents p/ o reconciliador. GenerationCostService lê Generation:* da config do worker.
builder.Services.AddScoped<SocialAi.Api.Generation.GenerationCostService>();
builder.Services.AddScoped<SocialAi.Api.Generation.GenerationCompletionService>();
var agentsBaseUrl = builder.Configuration["Agents:BaseUrl"] ?? "http://localhost:4000";
var agentsInternalToken = builder.Configuration["Agents:InternalToken"];
builder.Services.AddHttpClient<SocialAi.Worker.Jobs.AgentsPollClient>(c =>
{
    c.BaseAddress = new Uri(agentsBaseUrl);
    c.Timeout = TimeSpan.FromSeconds(30); // só consulta status (não aguarda pipeline)
    if (!string.IsNullOrWhiteSpace(agentsInternalToken))
        c.DefaultRequestHeaders.Add("x-internal-token", agentsInternalToken);
});
// task 2.3 — cliente que INICIA a geração real a partir do robô (POST /generate). Contraparte de
// escrita do AgentsPollClient. /generate retorna 202+jobId de imediato (não aguarda o pipeline de
// 60-120s — o GeneratingReaperJob reconcilia). MAS no free-tier o agents dorme após ~15min ociosos:
// a PRIMEIRA chamada após o sono paga um cold-start de ~20s (medido: 21,8s). Com timeout de 30s a
// margem era apertada e, no slot das 14:45 de 2026-08-14, ESTOUROU → StartAsync devolveu null → o
// robô pulou o slot ("agents indisponível"). 90s absorve o cold-start com folga: o robô não perde
// mais o slot por o agents estar frio. (O warm-up no cron externo reduz a chance; este timeout é a
// rede de segurança que funciona MESMO se o cron não aquecer a tempo.)
builder.Services.AddHttpClient<SocialAi.Worker.Jobs.AgentsStartClient>(c =>
{
    c.BaseAddress = new Uri(agentsBaseUrl);
    c.Timeout = TimeSpan.FromSeconds(90);
    if (!string.IsNullOrWhiteSpace(agentsInternalToken))
        c.DefaultRequestHeaders.Add("x-internal-token", agentsInternalToken);
});
// ADR-0010/§2.4 — cliente que INVENTA pauta (o cérebro do loop autônomo, POST /invent-pauta). Ao
// contrário do /generate (202+jobId), este é SÍNCRONO: aguarda a chamada LLM de texto (~2-5s) e
// devolve a pauta pronta. Timeout maior que o Start por isso. Mesmo x-internal-token.
builder.Services.AddHttpClient<SocialAi.Worker.Jobs.AgentsInventClient>(c =>
{
    c.BaseAddress = new Uri(agentsBaseUrl);
    c.Timeout = TimeSpan.FromSeconds(60);
    if (!string.IsNullOrWhiteSpace(agentsInternalToken))
        c.DefaultRequestHeaders.Add("x-internal-token", agentsInternalToken);
});

// Publishing (E-7): cifra de token, mídia, publishers.
builder.Services.AddSingleton<SecretProtector>();
// Assina a URL pública/temporária de imagem de slide (fallback sem-MinIO: a Meta baixa da API).
builder.Services.AddSingleton<MediaUrlSigner>();
// F6/E1: versão da Graph API em config (fonte única + telemetria de obsolescência no boot).
builder.Services.AddSingleton<SocialAi.Worker.Publishing.GraphApiConfig>();
builder.Services.AddScoped<SocialAi.Worker.Publishing.MediaService>();
builder.Services.AddScoped<SocialAi.Worker.Publishing.MockPublisher>();
// Imagem de slide (MinIO): store de imagem de slide no caminho de reconciliação (reaper). SÓ com MinIO
// configurado — senão o GenerationCompletionService recebe null e mantém base64 (igual à API).
if (!string.IsNullOrWhiteSpace(builder.Configuration["Minio:Endpoint"])
    || !string.IsNullOrWhiteSpace(builder.Configuration["Minio:PublicBaseUrl"]))
{
    builder.Services.AddScoped<SocialAi.Api.Generation.ISlideImageStore, SocialAi.Worker.Publishing.WorkerSlideImageStore>();
}
builder.Services.AddHttpClient<SocialAi.Worker.Publishing.InstagramGraphPublisher>();

// Fila de publicação = linhas Postgres (PublishLog), não Hangfire/Redis. Os jobs são
// BackgroundService com PeriodicTimer — não precisam de scheduler externo (S-21).
builder.Services.AddHostedService<HeartbeatService>();
builder.Services.AddHostedService<PublishSchedulerJob>();
builder.Services.AddHostedService<PublishJob>();
builder.Services.AddHostedService<MetricsCollectorJob>();
builder.Services.AddHostedService<AutonomousLoopJob>();
// Fase 2 (task 2.3): o robô. Fecha o circuito da autonomia (gera→gate→auto-aprova→agenda). Mesmos
// gates soberanos do loop (kill-switch Loop:Enabled default false + budget cap). Opt-in por workspace.
builder.Services.AddHostedService<PostingScheduleJob>();
builder.Services.AddHostedService<GeneratingReaperJob>();
// B3/S-09: refresh proativo dos tokens IG (60d) antes do vencimento.
builder.Services.AddHostedService<IgTokenRefreshJob>();

var host = builder.Build();

// B2/S-06: validação de boot da URL pública do MinIO.
// Em modo Graph, a Meta BAIXA a imagem da URL que enviamos — ela PRECISA ser pública e
// alcançável pela internet. Hosts internos (minio:9000) ou loopback (localhost/127.0.0.1)
// resolvem só dentro da rede do Docker → a Graph API não acessa e o publish falha em runtime.
// Recusamos subir agora, com mensagem clara, em vez de falhar silenciosamente depois.
// Em modo mock não validamos: degradado é estado de 1ª classe.
{
    var bootCfg = host.Services.GetRequiredService<IConfiguration>();
    var bootLog = host.Services.GetRequiredService<ILogger<Program>>();
    var publisherMode = bootCfg["Publisher:Mode"] ?? "mock";
    if (publisherMode != "mock")
    {
        var publicBase = bootCfg["Minio:PublicBaseUrl"] ?? "";
        var inacessivel = string.IsNullOrWhiteSpace(publicBase)
            || publicBase.Contains("minio:9000", StringComparison.OrdinalIgnoreCase)
            || publicBase.Contains("localhost", StringComparison.OrdinalIgnoreCase)
            || publicBase.Contains("127.0.0.1", StringComparison.OrdinalIgnoreCase);
        if (inacessivel)
        {
            const string msg = "Publisher:Mode=graph exige Minio:PublicBaseUrl com URL pública " +
                "alcançável pela internet (a Graph API baixa a imagem de lá). Valor atual inválido " +
                "(vazio, minio:9000 ou loopback). Configure uma URL pública ou use Publisher:Mode=mock.";
            bootLog.LogCritical("{Msg}", msg);
            throw new InvalidOperationException(msg);
        }
    }
}

host.Run();

// Marcador para tipar o ILogger<Program> do bloco de validação acima (top-level program).
public partial class Program { }
