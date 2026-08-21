using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using SocialAi.Api.Data;
using SocialAi.Api.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

// Portabilidade de PaaS (Railway/Render/Fly): se a plataforma injeta PORT, escuta nela.
// Sem PORT (Docker Compose / local), mantém o default do ASPNETCORE_URLS (porta 5080).
// PaaS roteia o tráfego público para a PORT que define — ignorar isto = domínio não responde.
var paasPort = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrWhiteSpace(paasPort))
    builder.WebHost.UseUrls($"http://0.0.0.0:{paasPort}");

// ── Config ───────────────────────────────────────────────────────────────
var cfg = builder.Configuration;
var isProduction = builder.Environment.IsProduction();

// Segredo default usado SÓ em Development (conveniência). Em Production a guarda
// de boot abaixo (A2) recusa subir com este valor ou com chave curta (< 32 bytes).
const string DevInsecureSecret = "dev-insecure-secret-change-me-min-32-bytes!!";
var jwtSecret = cfg["Jwt:Secret"];
if (string.IsNullOrWhiteSpace(jwtSecret)) jwtSecret = DevInsecureSecret;
var jwtIssuer = cfg["Jwt:Issuer"] ?? "social-ai-platform";
var webOrigin = cfg["Cors:WebOrigin"] ?? "http://localhost:3000";
var pgConn = cfg.GetConnectionString("Postgres")
             ?? "Host=localhost;Port=5432;Database=social_ai;Username=social;Password=changeme";
// Portabilidade de PaaS: alguns provedores (Render, Heroku, Fly) dão a connection string no
// formato URI `postgresql://user:pass@host:port/db`. O Npgsql espera o formato key-value
// (`Host=...;Port=...`). Converte quando detecta o esquema URI; caso contrário, usa como está.
pgConn = NormalizePostgresConnString(pgConn);

static string NormalizePostgresConnString(string conn)
{
    if (!conn.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase)
        && !conn.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
        return conn;
    var uri = new Uri(conn);
    var userInfo = uri.UserInfo.Split(':', 2);
    var db = uri.AbsolutePath.TrimStart('/');
    var sb = new System.Text.StringBuilder()
        .Append($"Host={uri.Host};Port={(uri.Port > 0 ? uri.Port : 5432)};Database={db};")
        .Append($"Username={Uri.UnescapeDataString(userInfo[0])};")
        .Append($"Password={Uri.UnescapeDataString(userInfo.Length > 1 ? userInfo[1] : "")}");
    // PaaS gerenciado normalmente exige SSL; o Render aceita Require sem validação de CA.
    if (conn.Contains("sslmode=", StringComparison.OrdinalIgnoreCase) is false)
        sb.Append(";SSL Mode=Require;Trust Server Certificate=true");
    return sb.ToString();
}

// ── A2: Fail-fast de segredos em Production ─────────────────────────────────
// Sem isto, uma env faltante cai no literal público commitado → token forjável e
// segredos cifrados com chave conhecida. Em Production abortamos o boot (melhor não
// subir do que subir inseguro). String vazia conta como ausente (não só null).
if (isProduction)
{
    var bootLog = LoggerFactory.Create(b => b.AddConsole()).CreateLogger("Boot");
    var fatal = false;

    if (string.IsNullOrWhiteSpace(jwtSecret) || jwtSecret == DevInsecureSecret
        || Encoding.UTF8.GetByteCount(jwtSecret) < 32)
    {
        bootLog.LogCritical("Jwt:Secret ausente, default ou < 32 bytes. Defina JWT_SECRET (openssl rand -base64 48).");
        fatal = true;
    }

    // A chave de cifra efetiva é Secrets:EncryptionKey (SEM fallback p/ Jwt:Secret em
    // Production — coerente com SecretProtector). Tem de existir e ser forte.
    var encKey = cfg["Secrets:EncryptionKey"];
    if (string.IsNullOrWhiteSpace(encKey) || encKey == DevInsecureSecret
        || Encoding.UTF8.GetByteCount(encKey) < 32)
    {
        bootLog.LogCritical("Secrets:EncryptionKey ausente ou fraca (< 32 bytes). Defina SECRETS_ENCRYPTION_KEY " +
                            "(openssl rand -base64 48) ANTES do 1º deploy — trocá-la depois invalida segredos já cifrados.");
        fatal = true;
    }

    if (fatal)
        throw new InvalidOperationException(
            "Boot recusado (A2): segredos de produção ausentes ou inseguros. Veja os logs Critical acima.");

    // AGENTS_INTERNAL_TOKEN protege o pipeline interno (a chamada api→agents). Sem ele em
    // Production, qualquer um na rede interna pode disparar o pipeline e queimar o budget Gemini.
    // NÃO é fatal (a rede Docker já é uma barreira, e há deploys que rodam conscientemente sem o
    // token) — mas em Production a ausência é um risco que tem de ser VISÍVEL, não silencioso.
    if (string.IsNullOrWhiteSpace(cfg["Agents:InternalToken"]))
        bootLog.LogWarning("AGENTS_INTERNAL_TOKEN ausente em Production — o pipeline api→agents " +
            "aceita chamadas SEM autenticação. Defina-o (mesmo valor na API e no agents) para " +
            "impedir que terceiros na rede interna disparem a geração e queimem o budget de IA.");
}

// ── Services ─────────────────────────────────────────────────────────────
// Tenant atual resolvido do JWT (T-2.2.2). Scoped: 1 por request.
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentWorkspace, CurrentWorkspace>();
builder.Services.AddScoped<ICurrentBrand, CurrentBrand>();
builder.Services.AddScoped<SocialAi.Api.Features.Brands.BrandResolver>();
// C2 (ADR-0010): dono único da trilha de auditoria (escrita explícita nos pontos sensíveis).
builder.Services.AddScoped<SocialAi.Api.Features.Audit.AuditService>();
builder.Services.AddScoped<SocialAi.Api.Features.Admin.DbBrowserService>();
builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(pgConn));
builder.Services.AddScoped<SocialAi.Api.Features.Auth.TokenService>();
builder.Services.AddScoped<RequireWorkspaceFilter>();
builder.Services.AddSingleton<SecretProtector>();
// Assina/valida URLs públicas e temporárias de imagem de slide (substituto self-hosted do presign
// do MinIO). Usado pela rota pública /public/media e pelo publish quando NÃO há MinIO.
builder.Services.AddSingleton<MediaUrlSigner>();
builder.Services.AddScoped<SocialAi.Api.Features.Learning.PerformanceAnalyzer>();
// A4 (ADR-0009): dono único da regra "último motivo de rejeição" (ContentController + LearningController).
builder.Services.AddScoped<SocialAi.Api.Features.Learning.RejectFeedbackService>();
// B2/B4 (ADR-0009): custo de geração por formato + transição Generating→Draft (dono único,
// compartilhado com o reconciliador do worker). Ambos em Core (SocialAi.Api.Generation).
builder.Services.AddScoped<SocialAi.Api.Generation.GenerationCostService>();
builder.Services.AddScoped<SocialAi.Api.Generation.GenerationCompletionService>();
// Imagem de slide (MinIO): store de imagem de slide (base64 → MinIO → ref estável). SÓ quando há config de
// MinIO — sem ela (dev/degradado) o GenerationCompletionService recebe ISlideImageStore=null e
// mantém o base64 (honesto, sem regressão). Registrado como a impl concreta (p/ proxy/DTO) E como
// a interface (p/ o completion service injetar).
if (SocialAi.Api.Features.Content.MinioImageStore.IsConfigured(cfg))
{
    builder.Services.AddScoped<SocialAi.Api.Features.Content.MinioImageStore>();
    builder.Services.AddScoped<SocialAi.Api.Generation.ISlideImageStore>(
        sp => sp.GetRequiredService<SocialAi.Api.Features.Content.MinioImageStore>());
}
// B3: testador de chave de IA (chamada mínima ao provider). Usa IHttpClientFactory; abstraído
// atrás de interface para ser substituível em teste sem rede.
builder.Services.AddScoped<SocialAi.Api.Features.Settings.IAiKeyTester, SocialAi.Api.Features.Settings.AiKeyTester>();
builder.Services.AddHttpClient(); // IHttpClientFactory p/ OAuth Instagram + teste de IA

// Cliente do microserviço de agentes (typed HttpClient).
var agentsBaseUrl = cfg["Agents:BaseUrl"] ?? "http://localhost:4000";
// Portabilidade de PaaS: alguns provedores expõem o destino como "host:porta" (sem esquema).
// O Uri exige esquema — prefixa http:// (rede interna entre serviços) quando ausente.
if (!agentsBaseUrl.Contains("://", StringComparison.Ordinal))
    agentsBaseUrl = "http://" + agentsBaseUrl;
var agentsInternalToken = cfg["Agents:InternalToken"];
builder.Services.AddHttpClient<SocialAi.Api.Features.Content.AgentsClient>(c =>
{
    c.BaseAddress = new Uri(agentsBaseUrl);
    c.Timeout = TimeSpan.FromMinutes(6); // pipeline longo (5 LLM-steps + imagem)
    // N4/S-29: segredo compartilhado interno. O agents (serviço interno, sem porta pública)
    // exige este header quando AGENTS_INTERNAL_TOKEN está definido — impede que terceiros
    // disparem o pipeline e queimem o budget Gemini. Ausente em dev = agents aceita sem auth.
    if (!string.IsNullOrWhiteSpace(agentsInternalToken))
        c.DefaultRequestHeaders.Add("x-internal-token", agentsInternalToken);
});

// ── Worker-in-API (deploy free-tier sem serviço pago) ────────────────────────────────────────
// Os jobs do worker são BackgroundService com timer próprio (não precisam de scheduler externo).
// Quando RunWorkerInProcess=true, a API os HOSPEDA no mesmo processo — assim "agendar" e "publicar
// agora" funcionam sem um serviço Worker dedicado no Render (que exige plano pago). Em deploy com
// worker dedicado, deixar a flag desligada (default) p/ não rodar os jobs em dobro.
if (cfg.GetValue("RunWorkerInProcess", false))
{
    // Cliente de poll do agents (reconciliador de geração órfã) — espelha o registro do worker.
    builder.Services.AddHttpClient<SocialAi.Worker.Jobs.AgentsPollClient>(c =>
    {
        c.BaseAddress = new Uri(agentsBaseUrl);
        c.Timeout = TimeSpan.FromSeconds(30);
        if (!string.IsNullOrWhiteSpace(agentsInternalToken))
            c.DefaultRequestHeaders.Add("x-internal-token", agentsInternalToken);
    });

    // O ROBÔ precisa DISPARAR geração (Start) e INVENTAR pauta (Invent) — mesmos clientes do worker
    // dedicado. Sem eles registrados, PostingScheduleJob/AutonomousLoopJob quebrariam ao resolver a
    // dependência. Espelham o registro em apps/worker/Program.cs (mesmo baseUrl + x-internal-token).
    // Timeout de 90s (era 30s): no deploy free o robô roda IN-PROCESS aqui e o agents dorme após
    // ~15min ociosos. A 1ª chamada após o sono paga cold-start de ~20s; 30s estourava e o robô
    // pulava o slot (visto em 2026-08-14 14:45). 90s cobre o cold-start — vê apps/worker/Program.cs.
    builder.Services.AddHttpClient<SocialAi.Worker.Jobs.AgentsStartClient>(c =>
    {
        c.BaseAddress = new Uri(agentsBaseUrl);
        c.Timeout = TimeSpan.FromSeconds(90);
        if (!string.IsNullOrWhiteSpace(agentsInternalToken))
            c.DefaultRequestHeaders.Add("x-internal-token", agentsInternalToken);
    });
    builder.Services.AddHttpClient<SocialAi.Worker.Jobs.AgentsInventClient>(c =>
    {
        c.BaseAddress = new Uri(agentsBaseUrl);
        c.Timeout = TimeSpan.FromSeconds(60); // síncrono (aguarda o LLM) — timeout maior que o Start.
        if (!string.IsNullOrWhiteSpace(agentsInternalToken))
            c.DefaultRequestHeaders.Add("x-internal-token", agentsInternalToken);
    });

    // Publishing: versão da Graph API, conversão de mídia, publishers (Mock/Graph).
    builder.Services.AddSingleton<SocialAi.Worker.Publishing.GraphApiConfig>();
    builder.Services.AddScoped<SocialAi.Worker.Publishing.MediaService>();
    builder.Services.AddScoped<SocialAi.Worker.Publishing.MockPublisher>();
    builder.Services.AddHttpClient<SocialAi.Worker.Publishing.InstagramGraphPublisher>();

    // Store de imagem de slide no reaper — só com MinIO (senão mantém base64, igual à API).
    if (SocialAi.Api.Features.Content.MinioImageStore.IsConfigured(cfg))
        builder.Services.AddScoped<SocialAi.Api.Generation.ISlideImageStore, SocialAi.Worker.Publishing.WorkerSlideImageStore>();

    // Jobs 24/7 (mesmos do worker dedicado). HeartbeatService fica de fora: a API já é um web
    // service "vivo"; o keep-alive contra o sleep do free-tier é um ping HTTP externo ao /health.
    builder.Services.AddHostedService<SocialAi.Worker.Jobs.PublishSchedulerJob>();
    builder.Services.AddHostedService<SocialAi.Worker.Jobs.PublishJob>();
    builder.Services.AddHostedService<SocialAi.Worker.Jobs.MetricsCollectorJob>();
    builder.Services.AddHostedService<SocialAi.Worker.Jobs.GeneratingReaperJob>();
    builder.Services.AddHostedService<SocialAi.Worker.Jobs.IgTokenRefreshJob>();
    // O ROBÔ (autonomia governável) roda também no in-process — assim o deploy free-tier (worker-in-API)
    // pode gerar→gate→auto-aprova→agenda→publica e inventar pauta sozinho, sem serviço pago. É SEGURO
    // registrar sempre: os dois jobs são gated pelo FREIO-MESTRE (SystemSetting["Loop:Enabled"], default
    // OFF, controlável por TELA) — não agem até o operador ligar. Blast radius protegido pelo freio.
    // PostingScheduleJob (o ROBÔ): registrado como singleton concreto + HostedService apontando p/ ele,
    // para que o gatilho externo (POST /api/automation/run-tick) resolva a MESMA instância e dispare
    // TickAsync sob demanda — no free-tier o processo dorme e o timer de 60min não roda; o cron externo
    // chama o endpoint no horário. O BackgroundService segue rodando o timer quando o processo está vivo.
    builder.Services.AddSingleton<SocialAi.Worker.Jobs.PostingScheduleJob>();
    builder.Services.AddHostedService(sp => sp.GetRequiredService<SocialAi.Worker.Jobs.PostingScheduleJob>());
    builder.Services.AddHostedService<SocialAi.Worker.Jobs.AutonomousLoopJob>();
}

builder.Services.AddControllers(o =>
{
    // Isolamento por tenant em nível de request (rejeita autenticado sem workspace).
    o.Filters.Add<RequireWorkspaceFilter>();
    // E1: acesso a marca de outro workspace (X-Brand-Id inválido) → 403, não 500.
    o.Filters.Add<BrandAccessExceptionFilter>();
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(o =>
{
    o.SwaggerDoc("v1", new OpenApiInfo { Title = "Social AI Platform API", Version = "v1" });
    o.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "JWT no formato: Bearer {token}"
    });
    o.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
            },
            Array.Empty<string>()
        }
    });
});

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            // D6: valida a audiência explicitamente (defense-in-depth: token emitido p/ outro
            // público não vale aqui). ClockSkew reduzido para 30s (default são 5min de folga).
            ValidateAudience = true,
            ValidAudience = jwtIssuer,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30),
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret))
        };
        // Imagem de slide (MinIO): a imagem do slide é servida por URL (proxy 302→presigned), não mais base64
        // inline. Mas <img>/CSS background-image NÃO mandam o header Authorization (o JWT vive no
        // localStorage). Aceitamos o token via ?access_token= SÓ na rota do proxy de imagem — escopo
        // mínimo: o resto do app continua exigindo o header. O token é o MESMO da sessão (validado
        // igual); a rota só faz 302 → presigned curta (não expõe dado além da própria imagem do tenant).
        o.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var path = ctx.Request.Path;
                if (string.IsNullOrEmpty(ctx.Token)
                    && path.StartsWithSegments("/api/content", StringComparison.OrdinalIgnoreCase)
                    && path.Value!.EndsWith("/image", StringComparison.OrdinalIgnoreCase)
                    && ctx.Request.Query.TryGetValue("access_token", out var qToken))
                {
                    ctx.Token = qToken;
                }
                return Task.CompletedTask;
            }
        };
    });
builder.Services.AddAuthorization();

// ── D4: Rate-limit nos endpoints de auth ────────────────────────────────────
// Mitiga brute-force/credential-stuffing em login/register/refresh. Janela fixa
// por IP; quem estourar recebe 429. A política "auth" é aplicada via [EnableRateLimiting]
// no AuthController. Demais endpoints ficam livres (já exigem JWT).
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("auth", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "desconhecido",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));
});

builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins(webOrigin).AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

// ── Migrations no boot ───────────────────────────────────────────────────
// Deploy self-contained: aplica migrations pendentes ao subir (sem `dotnet ef`
// no host). Postgres já está healthy via depends_on; retry cobre a janela de
// inicialização na primeira subida.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var log = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
    for (var attempt = 1; ; attempt++)
    {
        try
        {
            db.Database.Migrate();
            log.LogInformation("Migrations aplicadas.");
            break;
        }
        catch (Exception ex) when (attempt < 10)
        {
            log.LogWarning("Migrations falharam (tentativa {Attempt}/10): {Msg}. Retentando em 3s…", attempt, ex.Message);
            Thread.Sleep(3000);
        }
        catch (Exception ex)
        {
            // H10: esgotou as 10 tentativas. Loga Critical e relança — subir a API sem schema
            // aplicado seria pior (falharia em runtime de forma opaca). Container reinicia (restart:unless-stopped).
            log.LogCritical(ex, "Migrations falharam após 10 tentativas. Abortando o boot.");
            throw;
        }
    }
}

// ── Pipeline ─────────────────────────────────────────────────────────────
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
else
{
    // H5: em Production exceções não vazam stack trace. Handler genérico responde
    // ProblemDetails neutro (RFC 7807) e o detalhe real fica só no log do servidor.
    app.UseExceptionHandler("/error");
    app.Map("/error", (HttpContext _) =>
        Results.Problem(title: "Erro interno do servidor.", statusCode: StatusCodes.Status500InternalServerError));
}

app.UseRateLimiter();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

// Healthcheck (usado pelo healthcheck do docker-compose).
app.MapGet("/health", () => Results.Ok(new
{
    status = "healthy",
    service = "api",
    deployMode = cfg["DeployMode"] ?? "single",
    timestamp = DateTimeOffset.UtcNow
}));

// WARM-UP (cold-start do Render free): a web chama isto no LOGIN. A própria chamada já acorda a API;
// aqui despertamos o AGENTS em paralelo (fire-and-forget) — assim, no tempo de o operador navegar até
// "Gerar", agents já está vivo e a 1ª geração não toma cold-start. Anônimo e instantâneo (não aguarda
// o ping). Best-effort: se o agents demorar/falhar, o retry do StartAsync ainda cobre. Sem loop/ping
// periódico — é reativo ao login, exatamente quando alguém vai usar.
app.MapGet("/api/warmup", (SocialAi.Api.Features.Content.AgentsClient agents) =>
{
    _ = agents.WarmUpAsync(); // dispara sem aguardar — só acorda o agents
    return Results.Ok(new { warming = true });
});

// GATILHO EXTERNO DO ROBÔ (free-tier: o processo dorme e o PeriodicTimer de 60min não roda). Um cron
// externo confiável (cron-job.org / GitHub Actions) chama isto nos horários agendados; a própria
// requisição acorda a API e dispara UM tick do robô — que reavalia TODOS os gates soberanos
// (freio-mestre, horário local, budget, pauta). Idempotente: fora da janela/gates, não gera nada.
// Protegido por SECRET no header (Loop:RunToken) — anônimo p/ JWT, mas não público. Sem token
// configurado em Production → recusa (não deixa um endpoint que dispara geração aberto por engano).
app.MapPost("/api/automation/run-tick", async (
    HttpContext http,
    SocialAi.Worker.Jobs.PostingScheduleJob robot,
    IConfiguration configuration,
    IWebHostEnvironment environment) =>
{
    var expected = configuration["Loop:RunToken"];
    if (string.IsNullOrWhiteSpace(expected))
    {
        // Sem secret: em Production recusamos (fail-closed — não expor disparo de geração); em Dev libera.
        if (environment.IsProduction())
            return Results.Problem("Loop:RunToken não configurado — gatilho externo desabilitado.", statusCode: 503);
    }
    else
    {
        var provided = http.Request.Headers["x-run-token"].ToString();
        // Comparação de tempo fixo (evita timing attack no secret).
        if (!System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.UTF8.GetBytes(provided), System.Text.Encoding.UTF8.GetBytes(expected)))
            return Results.Unauthorized();
    }

    // Aguarda o tick (o cron externo quer saber se rodou). Erros viram 500 — o robô já loga o detalhe.
    await robot.TickAsync(http.RequestAborted);
    return Results.Ok(new { ticked = true, at = DateTimeOffset.UtcNow });
});

app.MapControllers();

app.Run();
