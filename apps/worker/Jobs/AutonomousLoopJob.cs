using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Worker.Jobs;

/// <summary>
/// Loop autônomo (§2.4) — O CÉREBRO da autonomia: inventa PAUTA quando a fila editorial esvazia.
/// Por workspace, a cada ciclo:
///   SE há pautas na fila  -> NÃO inventa (pautas humanas têm prioridade — §2.4).
///   SE fila vazia E loop habilitado E dentro do budget -> INVENTA uma pauta relevante à marca
///     (AgentsInventClient → LLM, com base no BrandKit + anti-repetição).
///
/// ANTES (stub): criava um IdeaCandidate com texto FIXO ("Ideia autônoma dd/MM") e Rationale que
/// AFIRMAVA usar dados que não lia (fere L4/L5). AGORA: chama o LLM via agents (mesma infra do
/// wizard/robô), lê o BrandKit ("o que a empresa faz") e devolve título+objetivo+contexto REAIS.
///
/// DOIS MODOS (governáveis pela tela Configurações › Automação, sem migração — reusa flags existentes):
///  - SUGERIR (AutonomousLoopEnabled=on, AutoPostEnabled=off): cria um IdeaCandidate com conteúdo
///    real. NÃO publica — espera a promoção humana (rampa de moderação, ADR-0010). Comportamento
///    seguro; agora com ideia relevante em vez de placeholder.
///  - AUTÔNOMO TOTAL (ambas as flags on): cria uma PAUTA direto no Backlog. O PostingScheduleJob
///    (o robô) faz o resto sozinho: gera → gate → auto-aprova (sob nota) → agenda → publica.
///
/// GATES SOBERANOS (inalterados): kill-switch global (Loop:Enabled, default false) → budget cap
/// mensal por workspace → fila vazia. Sem chave de IA → NÃO inventa (degradado honesto).
/// </summary>
public sealed class AutonomousLoopJob(
    IServiceProvider services,
    IConfiguration cfg,
    ILogger<AutonomousLoopJob> logger) : BackgroundService
{
    // Custo estimado por ideia gerada (entra no spend; mantém o budget honesto).
    private readonly decimal _costPerIdea = cfg.GetValue<decimal?>("Loop:CostPerIdeaUsd") ?? 0.25m;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("AutonomousLoopJob iniciado (tick 10min).");
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(10));
        do
        {
            try { await TickAsync(stoppingToken); }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { logger.LogError(ex, "Falha no tick do AutonomousLoopJob."); }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task TickAsync(CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var inventor = scope.ServiceProvider.GetRequiredService<AgentsInventClient>();

        // FREIO-MESTRE global (soberano). Fonte: SystemSetting["Loop:Enabled"] no banco (controlável
        // por TELA) com fallback env. DEFAULT false — autonomia é opt-in explícito (salvaguarda).
        if (!await LoopSwitch.IsEnabledAsync(db, cfg, ct))
        {
            logger.LogInformation("Loop autônomo desligado (freio-mestre OFF — opt-in explícito).");
            return;
        }

        var workspaces = await db.Workspaces.AsNoTracking().ToListAsync(ct);

        // Commit ISOLADO por workspace: uma falha (ex.: concorrência com outro job) não
        // derruba os demais, e o batch fica pequeno.
        foreach (var ws in workspaces)
        {
            try
            {
                if (await RunForWorkspaceAsync(db, inventor, ws, ct))
                    await db.SaveChangesAsync(ct);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Loop falhou no workspace {Ws} — seguindo.", ws.Id);
                db.ChangeTracker.Clear(); // descarta estado sujo antes do próximo workspace
            }
        }
    }

    /// <returns>true se há mudanças a persistir.</returns>
    private async Task<bool> RunForWorkspaceAsync(
        AppDbContext db, AgentsInventClient inventor, Workspace ws, CancellationToken ct)
    {
        // AsNoTracking: só lemos o budget; não marcamos a entidade como modified
        // (evita UPDATE concorrente desnecessário — DbUpdateConcurrencyException).
        var budget = await db.Budgets.AsNoTracking().FirstOrDefaultAsync(b => b.WorkspaceId == ws.Id, ct);

        // Loop precisa estar habilitado no workspace (opt-in — moderação/rampa de confiança).
        if (budget is null || !budget.AutonomousLoopEnabled)
            return false;

        // PAUTAS TÊM PRIORIDADE (§2.4): se há fila (backlog/queued/em andamento), não inventa.
        var hasPautas = await db.Pautas.AnyAsync(
            p => p.WorkspaceId == ws.Id &&
                 (p.Status == PautaStatus.Backlog || p.Status == PautaStatus.Queued || p.Status == PautaStatus.InProgress), ct);
        if (hasPautas) return false;

        // BUDGET CAP por workspace (decisão dia-2/R-7): gasto do mês corrente (agregado no banco).
        var monthStart = new DateTimeOffset(DateTimeOffset.UtcNow.Year, DateTimeOffset.UtcNow.Month, 1, 0, 0, 0, TimeSpan.Zero);
        var spentThisMonth = await db.SpendEntries
            .Where(s => s.BudgetId == budget.Id && s.OccurredAt >= monthStart)
            .SumAsync(s => (decimal?)s.AmountUsd, ct) ?? 0m;
        if (spentThisMonth + _costPerIdea > budget.MonthlyCapUsd)
        {
            logger.LogWarning("Workspace {Ws}: budget cap atingido (gasto {Spent:C} / cap {Cap:C}). Loop pausado.",
                ws.Id, spentThisMonth, budget.MonthlyCapUsd);
            return false;
        }

        // MARCA-ALVO: a mais antiga do workspace (mesma regra do BrandResolver.default). Toda conta
        // tem ≥1 marca (backfill + bloqueio de exclusão da última). Sem marca = estado inválido → pula.
        var brandId = await db.Brands
            .Where(b => b.WorkspaceId == ws.Id)
            .OrderBy(b => b.CreatedAt).ThenBy(b => b.Id)
            .Select(b => (Guid?)b.Id)
            .FirstOrDefaultAsync(ct);
        if (brandId is null)
        {
            logger.LogWarning("Workspace {Ws}: sem marca — loop não inventa (estado inválido).", ws.Id);
            return false;
        }

        // CONTEXTO DA MARCA ("o que a empresa faz") + anti-repetição. Predicados WorkspaceId/BrandId
        // EXPLÍCITOS (o worker roda sem filtro de tenant).
        var kit = await db.BrandKits.AsNoTracking().FirstOrDefaultAsync(k => k.BrandId == brandId.Value, ct);
        var recentTitles = await RecentTitlesAsync(db, ws.Id, ct);
        var aiSecret = await db.Secrets.AsNoTracking()
            .FirstOrDefaultAsync(s => s.WorkspaceId == ws.Id && s.Kind == SecretKind.AiProviderKey, ct);

        // INVENTA (LLM via agents). Sem chave / agents off → null (degradado honesto: não cria lixo).
        var invented = await inventor.InventAsync(kit, recentTitles, desiredType: null, aiSecret, ct);
        if (invented is null)
        {
            logger.LogInformation("Workspace {Ws}: inventor não devolveu pauta (sem chave de IA ou agents off). Aguardando.", ws.Id);
            return false;
        }

        var suggestedType = AgentsInventClient.ParseType(invented.SuggestedType);

        // MODO AUTÔNOMO TOTAL = as duas flags ligadas (sem campo/migração novos). Com AutoPostEnabled,
        // a pauta entra no Backlog e o PostingScheduleJob (o robô) a leva a publicação sozinho, sob a
        // nota mínima. Sem AutoPostEnabled, fica em IdeaCandidate à espera de promoção humana (rampa).
        if (ws.AutoPostEnabled)
        {
            db.Pautas.Add(new Pauta
            {
                WorkspaceId = ws.Id,
                BrandId = brandId.Value,
                Title = invented.Title,
                Objective = invented.Objective,
                Context = invented.Context,
                Category = invented.Category,
                MarketingObjective = invented.MarketingObjective,
                DesiredType = suggestedType,
                Priority = Priority.Medium,
                Status = PautaStatus.Backlog, // o robô a escolhe no próximo tick
            });
            logger.LogInformation("Workspace {Ws}: AUTÔNOMO TOTAL — pauta '{Title}' criada no Backlog (o robô publica).", ws.Id, invented.Title);
        }
        else
        {
            db.IdeaCandidates.Add(new IdeaCandidate
            {
                WorkspaceId = ws.Id,
                BrandId = brandId.Value,
                Title = invented.Title,
                Rationale = invented.Rationale, // HONESTO: descreve o que realmente embasou (não inventa dados).
                SuggestedType = suggestedType,
                Promoted = false, // NÃO publica — espera a promoção humana (moderação).
            });
            logger.LogInformation("Workspace {Ws}: SUGERIR — ideia '{Title}' criada (espera promoção humana).", ws.Id, invented.Title);
        }

        // Contabiliza o gasto via DbSet (FK direta, sem tocar a entidade Budget).
        db.SpendEntries.Add(new SpendEntry
        {
            WorkspaceId = ws.Id, BudgetId = budget.Id, BrandId = brandId.Value,
            AmountUsd = _costPerIdea, Reason = "loop:idea",
        });

        return true;
    }

    /// <summary>Títulos de pautas usadas nos últimos 30 dias (janela anti-repetição do inventor).</summary>
    private static async Task<IReadOnlyList<string>> RecentTitlesAsync(AppDbContext db, Guid wsId, CancellationToken ct)
    {
        var since = DateTimeOffset.UtcNow.AddDays(-30);
        // Títulos de pautas recentes do workspace (a fila está vazia AGORA, mas houve temas antes).
        var fromPautas = await db.Pautas
            .Where(p => p.WorkspaceId == wsId && p.CreatedAt >= since)
            .Select(p => p.Title)
            .ToListAsync(ct);
        // + títulos de ideias já sugeridas (evita o loop repetir a mesma sugestão a cada tick).
        var fromIdeas = await db.IdeaCandidates
            .Where(i => i.WorkspaceId == wsId && i.CreatedAt >= since)
            .Select(i => i.Title)
            .ToListAsync(ct);
        return fromPautas.Concat(fromIdeas).Where(t => !string.IsNullOrWhiteSpace(t)).Distinct().ToList();
    }
}
