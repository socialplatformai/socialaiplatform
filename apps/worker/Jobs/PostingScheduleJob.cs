using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Infrastructure;
using SocialAi.Api.Learning;

namespace SocialAi.Worker.Jobs;

/// <summary>
/// Fase 2 (task 2.3) — O ROBÔ. Peça central da autonomia governável: fecha o circuito que o
/// AutonomousLoopJob só começava (ele gera IdeaCandidate e para). A cada tick (~1h), por workspace
/// com <c>AutoPostEnabled</c>, roda em DUAS FASES (o elo worker→agents fechado em 2026-07-03):
///
///   FASE B (COLHER — sempre, independente do horário): peças que o robô mandou gerar e o
///     GeneratingReaperJob já concluiu (Draft com QualityScore real) passam pelo GATE DE QUALIDADE +
///     AUTO-APROVAÇÃO (task 2.5, ≥ AutoApprovalThreshold) → agenda no SLOT LIVRE (task 2.6) ou deixa
///     em revisão humana. Arte pronta não pode ficar órfã por estar fora da janela.
///
///   FASE A (GERAR — só quando é hora + gates soberanos):
///     1. GATES SOBERANOS: kill-switch global (Loop:Enabled, default false) → AutoPostEnabled →
///        rate-limit de geração/dia (Loop:MaxPostsPerDay) → anti-flood (não empilha geração se já há
///        uma em andamento) → budget cap mensal. Falhar qualquer um = não gera.
///     2. É HORA? CATCH-UP por contagem (PostingSchedule.CountSlotsPassedToday, hora LOCAL do
///        workspace): devido enquanto gerações-de-hoje &lt; min(slots já passados hoje, MaxPostsPerDay).
///        Um tick ATRASADO (free-tier dormiu, cron externo atrasou) ainda recupera o slot no mesmo
///        dia — o horário da tela é honrado sem depender de o tick cair numa janela exata.
///     3. ESCOLHE TEMA (ThemeSelection): prioridade + anti-repetição (2.4) + formato preferido pela
///        régua ponderada do operador (3.4, via WorkspaceLearning).
///     4. DISPARA A GERAÇÃO REAL (AgentsStartClient → POST /generate, MESMA pipeline do wizard) e cria
///        Content{Generating,JobId}. O GeneratingReaperJob reconcilia (slides + QualityScore); a Fase B
///        colhe no tick seguinte. Sem chave de IA (StartAsync=null) → NÃO gera (degradado honesto).
///
///   AUDITA cada passo (AuditEntry direto no DbContext — o worker não referencia o AuditService da API):
///     robot.generating · robot.generation-skipped · robot.scheduled · robot.pending-review · robot.paused.budget.
/// </summary>
public sealed class PostingScheduleJob(
    IServiceProvider services,
    IConfiguration cfg,
    ILogger<PostingScheduleJob> logger) : BackgroundService
{
    // Sistema (não-humano) como autor das entradas de auditoria do robô.
    private static readonly Guid SystemActor = Guid.Empty;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Tick de 5min (era 60): os gates são idempotentes por CONTAGEM (catch-up), então tickar mais
        // não gera em dobro — e a FASE B (colher→publicar) acontece minutos após a geração concluir,
        // dentro da janela em que o free-tier ainda está acordado (dorme ~15min após o último request).
        logger.LogInformation("PostingScheduleJob (robô) iniciado (tick 5min, catch-up por contagem).");
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(5));
        do
        {
            try { await TickAsync(stoppingToken); }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { logger.LogError(ex, "Falha no tick do PostingScheduleJob."); }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    // public: além do timer interno (60min), pode ser disparado sob demanda por um gatilho externo
    // (POST /api/automation/run-tick) — no free-tier o processo dorme e o timer não roda; o cron
    // externo chama isto no horário. Idempotente: os gates soberanos (freio/horário/budget) valem igual.
    public async Task TickAsync(CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var agents = scope.ServiceProvider.GetRequiredService<AgentsStartClient>();

        // GATE 1 — FREIO-MESTRE GLOBAL (soberano). Mesmo freio do AutonomousLoopJob: fonte é
        // SystemSetting["Loop:Enabled"] no banco (controlável por TELA) com fallback env. Sem ele
        // ligado, o robô NÃO age em nenhum workspace. Autonomia é opt-in explícito.
        if (!await LoopSwitch.IsEnabledAsync(db, cfg, ct))
        {
            logger.LogInformation("Robô desligado (freio-mestre OFF — opt-in explícito).");
            return;
        }

        // Só workspaces com o robô ligado (GATE 2 pré-filtrado no banco).
        var workspaces = await db.Workspaces.AsNoTracking()
            .Where(w => w.AutoPostEnabled)
            .ToListAsync(ct);

        foreach (var ws in workspaces)
        {
            try
            {
                if (await RunForWorkspaceAsync(db, agents, ws, ct))
                    await db.SaveChangesAsync(ct);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Robô falhou no workspace {Ws} — seguindo.", ws.Id);
                db.ChangeTracker.Clear();
            }
        }
    }

    /// <summary>
    /// Duas fases por workspace (o elo worker→agents que fechou a task 2.3):
    ///   FASE B (COLHER) — sempre roda: peças que o robô mandou gerar e o GeneratingReaperJob já
    ///     concluiu (Draft com QualityScore real) passam pelo gate → auto-aprova+agenda ou revisão.
    ///   FASE A (GERAR)  — se é hora + dentro do budget/rate: escolhe tema e DISPARA a geração real
    ///     (AgentsStartClient → mesma pipeline do wizard). O reaper reconcilia; a Fase B colhe depois.
    /// A Fase B roda ANTES e INDEPENDENTE do horário — arte já gerada não pode ficar órfã por estar
    /// fora da janela. Sem chave de IA, a Fase A não dispara (StartAsync devolve null): degradado honesto.
    /// </summary>
    /// <returns>true se há mudanças a persistir.</returns>
    private async Task<bool> RunForWorkspaceAsync(
        AppDbContext db, AgentsStartClient agents, Workspace ws, CancellationToken ct)
    {
        var nowLocal = ToLocal(DateTimeOffset.UtcNow, ws.TimeZoneId);

        // ── FASE B (COLHER): gate + agenda das peças que o robô gerou e o reaper já concluiu ──────────
        var changed = await HarvestGeneratedAsync(db, ws, nowLocal, ct);

        // ── FASE A (GERAR): só quando é hora e dentro dos gates soberanos ─────────────────────────────
        // GATE 3 — É HORA? CATCH-UP por contagem (substitui a janela de tolerância de 60min). Devido
        // enquanto gerações-de-hoje < min(slots já passados hoje, MaxPostsPerDay). Um tick atrasado
        // (free-tier dormiu antes do timer; cron do GH Actions atrasa horas) ainda recupera o slot no
        // MESMO DIA — o horário da tela é honrado sem o yml precisar conhecer a agenda. Trade-off
        // declarado: a peça pode nascer/postar mais tarde que o slot; nunca mais silenciosamente NUNCA.
        var slotsPassados = PostingSchedule.CountSlotsPassedToday(
            nowLocal.DateTime, ws.PostingScheduleDays, ws.PostingScheduleTimes);
        if (slotsPassados == 0) return changed;

        // GATE 4 — RATE-LIMIT de geração (task 4.3): teto de GERAÇÕES/dia por workspace (config
        // Loop:MaxPostsPerDay, default 1). Fecha a porta a surpresa de fatura. Conta as peças que o robô
        // FEZ GERAR hoje (Content FromAutonomousLoop criado hoje) — o driver de custo é a geração, não o
        // agendamento (que acontece num tick posterior). O alvo do dia é min(slots passados, teto):
        // com o tick de 5min, é esta CONTAGEM que torna o gate idempotente (N ticks = mesma resposta).
        // Fonte: SystemSetting["Loop:MaxPostsPerDay"] no banco (editável por TELA) → env → 1. Mesma
        // precedência do freio-mestre; sem migração (reusa SystemSetting). Piso de 1 dentro do helper.
        // Vem ANTES do budget: tick já satisfeito não deve re-auditar pausa de budget a cada 5min.
        var maxPerDay = await LoopSwitch.GetMaxPostsPerDayAsync(db, cfg, ct);
        var todayUtcStart = ToUtc(nowLocal.Date, ws.TimeZoneId);
        var generatedToday = await db.Contents
            .CountAsync(c => c.WorkspaceId == ws.Id && c.FromAutonomousLoop
                          && c.CreatedAt >= todayUtcStart && c.CreatedAt < todayUtcStart.AddDays(1), ct);
        var alvoHoje = Math.Min(slotsPassados, maxPerDay);
        if (generatedToday >= alvoHoje)
        {
            // Debug (não Info): com tick de 5min este é o caminho quente o dia todo — logá-lo em Info
            // afogaria o log com "nada a gerar" sem valor operacional.
            logger.LogDebug("Robô: workspace {Ws} com {Gen} geração(ões) hoje >= alvo {Alvo} (slots passados {Slots}, teto {Max}) — nada a gerar.",
                ws.Id, generatedToday, alvoHoje, slotsPassados, maxPerDay);
            return changed;
        }

        // Anti-flood do pipeline: se já há uma geração do robô EM ANDAMENTO (Generating), não empilha
        // outra — espera o reaper concluir (o job store do agents é in-memory; empilhar arrisca órfãos).
        // (Cobre também a geração iniciada ONTEM ainda em curso, que a contagem de hoje não vê.)
        var jaGerando = await db.Contents.AnyAsync(
            c => c.WorkspaceId == ws.Id && c.FromAutonomousLoop && c.Status == ContentStatus.Generating, ct);
        if (jaGerando)
        {
            logger.LogDebug("Robô: workspace {Ws} já tem geração em andamento — aguardando o reaper.", ws.Id);
            return changed;
        }

        // GATE 5 — BUDGET CAP mensal (soberano). Some o gasto do mês; estourar = pausa + auditoria.
        // Auditoria com DEDUP DIÁRIO: o tick agora é de 5min e um workspace estourado ficaria devido o
        // dia todo — sem o dedup seriam ~288 AuditEntries/dia repetindo o mesmo fato.
        var budget = await db.Budgets.AsNoTracking().FirstOrDefaultAsync(b => b.WorkspaceId == ws.Id, ct);
        var costPerPost = cfg.GetValue<decimal?>("Loop:CostPerPostUsd") ?? cfg.GetValue<decimal?>("Loop:CostPerIdeaUsd") ?? 0.25m;
        if (budget is not null)
        {
            var monthStart = new DateTimeOffset(DateTimeOffset.UtcNow.Year, DateTimeOffset.UtcNow.Month, 1, 0, 0, 0, TimeSpan.Zero);
            var spent = await db.SpendEntries
                .Where(s => s.BudgetId == budget.Id && s.OccurredAt >= monthStart)
                .SumAsync(s => (decimal?)s.AmountUsd, ct) ?? 0m;
            if (spent + costPerPost > budget.MonthlyCapUsd)
            {
                var jaAuditadoHoje = await db.AuditEntries.AnyAsync(
                    a => a.WorkspaceId == ws.Id && a.Action == "robot.paused.budget"
                      && a.OccurredAt >= todayUtcStart, ct);
                if (jaAuditadoHoje)
                {
                    logger.LogDebug("Robô: workspace {Ws} segue pausado por budget (já auditado hoje).", ws.Id);
                    return changed;
                }
                logger.LogWarning("Robô: budget cap no workspace {Ws} (gasto {Spent:C}/cap {Cap:C}) — pausado.",
                    ws.Id, spent, budget.MonthlyCapUsd);
                Audit(db, ws.Id, "robot.paused.budget", $"spent={spent};cap={budget.MonthlyCapUsd}");
                return true; // persiste a auditoria
            }
        }

        // PASSO 3 — ESCOLHE TEMA (anti-repetição). Pautas elegíveis do workspace.
        var candidates = await db.Pautas
            .Where(p => p.WorkspaceId == ws.Id && (p.Status == PautaStatus.Backlog || p.Status == PautaStatus.Queued))
            .ToListAsync(ct);
        if (candidates.Count == 0)
        {
            logger.LogDebug("Robô: workspace {Ws} sem pauta elegível — aguardando (não inventa arte).", ws.Id);
            return changed;
        }

        // Títulos publicados nos últimos 30 dias (janela de dedup) — anti-repetição de tema.
        var dedupSince = DateTimeOffset.UtcNow.AddDays(-30);
        var recentTitlesRaw = await db.Contents
            .Where(c => c.WorkspaceId == ws.Id && c.PautaId != null && c.CreatedAt >= dedupSince)
            .Join(db.Pautas, c => c.PautaId, p => p.Id, (c, p) => p.Title)
            .ToListAsync(ct);
        var recentTitles = recentTitlesRaw.Select(ThemeSelection.Normalize).ToHashSet();

        // task 3.4 — FIO robô→analyzer: o formato que pontua alto sob a régua PONDERADA do operador
        // (MetricScoring, via Core) vira preferência de desempate. Null com amostra <3 → sem viés
        // (comportamento 2.4). O worker consulta o mesmo ponto que a API — sem duplicar o score.
        var preferredType = await WorkspaceLearning.PreferredFormatAsync(db, ws.Id, ct);
        var selection = ThemeSelection.Choose(candidates, recentTitles, preferredType);
        if (selection is null) return changed;
        var pauta = selection.Pauta;
        if (!selection.IsFreshTheme)
            logger.LogInformation("Robô: workspace {Ws} sem tema NOVO — reusando '{Title}' (fila só tem repetição recente).", ws.Id, pauta.Title);

        // PASSO 4 — DISPARA A GERAÇÃO REAL (elo worker→agents). Monta o contexto mínimo-mas-honesto e
        // chama a MESMA pipeline do wizard. Sem chave (StartAsync=null) → não cria arte: log + aguarda.
        var kit = await db.BrandKits.AsNoTracking().FirstOrDefaultAsync(k => k.BrandId == pauta.BrandId, ct);
        var handle = await ResolveHandleAsync(db, pauta.BrandId, ct);
        // Learning summary PONDERADO (3.3): reusa o ponto único em Core (mesma régua da API). Null com
        // amostra <3 → sem viés (o agents degrada com graça). Fecha o E2E de aprendizado no braço do robô.
        var learning = await WorkspaceLearning.SummaryAsync(db, ws.Id, ct);
        // Secret da chave de IA do workspace (predicado WorkspaceId EXPLÍCITO — filtro de tenant off).
        var aiSecret = await db.Secrets.AsNoTracking()
            .FirstOrDefaultAsync(s => s.WorkspaceId == ws.Id && s.Kind == SecretKind.AiProviderKey, ct);

        var jobId = await agents.StartAsync(ws, pauta, handle, learning, kit, aiSecret, ct);
        if (jobId is null)
        {
            // A pauta segue Backlog → re-tenta no próximo tick (a própria chamada falha costuma acordar
            // o agents adormecido). Auditoria com dedup diário — sem ele, agents fora do ar o dia todo
            // viraria ~288 AuditEntries repetidas (tick de 5min).
            var skipJaAuditado = await db.AuditEntries.AnyAsync(
                a => a.WorkspaceId == ws.Id && a.Action == "robot.generation-skipped"
                  && a.OccurredAt >= todayUtcStart, ct);
            if (skipJaAuditado)
            {
                logger.LogDebug("Robô: workspace {Ws} — geração de '{Title}' segue sem iniciar (já auditado hoje).", ws.Id, pauta.Title);
                return changed;
            }
            logger.LogInformation("Robô: workspace {Ws} — geração de '{Title}' não iniciou (sem chave de IA ou agents indisponível). Aguardando.", ws.Id, pauta.Title);
            Audit(db, ws.Id, "robot.generation-skipped", $"pauta={pauta.Id};motivo=sem-chave-ou-agents-off", pauta.BrandId);
            return true; // persiste a auditoria
        }

        // Cria o Content em Generating ligado ao job — o GeneratingReaperJob o reconcilia (slides +
        // QualityScore) exatamente como faz para as gerações do navegador. A Fase B (próximo tick) colhe.
        var content = new Content
        {
            WorkspaceId = ws.Id,
            BrandId = pauta.BrandId,
            PautaId = pauta.Id,
            Type = pauta.DesiredType,
            Status = ContentStatus.Generating,
            JobId = jobId,
            FromAutonomousLoop = true,
            Caption = pauta.Context ?? pauta.Title, // base; o reaper sobrescreve com a caption gerada
        };
        db.Contents.Add(content);
        // Marca a pauta InProgress para não ser re-escolhida enquanto a arte roda (o candidato só
        // considera Backlog/Queued). Ao concluir, o GenerationCompletionService a leva a Done.
        pauta.Status = PautaStatus.InProgress;

        Audit(db, ws.Id, "robot.generating",
            $"pauta={pauta.Id};job={jobId};fresh={selection.IsFreshTheme}", pauta.BrandId);
        logger.LogInformation("Robô: workspace {Ws} — geração REAL iniciada para '{Title}' (job {Job}). O reaper conclui; agenda no próximo tick.",
            ws.Id, pauta.Title, jobId);
        return true;
    }

    /// <summary>
    /// FASE B — colhe as peças que o robô GEROU e o reaper já concluiu: Content FromAutonomousLoop em
    /// Draft, ainda SEM aprovação e SEM agendamento. Aplica o gate (task 2.5) sobre a nota REAL agora
    /// disponível; auto-aprova+agenda no slot livre (task 2.6) ou deixa em revisão humana. Contabiliza
    /// o gasto do post (o gasto de GERAÇÃO já foi gravado pelo reaper). Idempotente por tick.
    /// </summary>
    internal async Task<bool> HarvestGeneratedAsync(
        AppDbContext db, Workspace ws, DateTimeOffset nowLocal, CancellationToken ct)
    {
        var changed = await ReclaimStrandedPautasAsync(db, ws, ct);

        // Ordena por CreatedAt EM MEMÓRIA (GOTCHA SQLite: não traduz ORDER BY de DateTimeOffset).
        var prontas = (await db.Contents
            .Where(c => c.WorkspaceId == ws.Id && c.FromAutonomousLoop
                        && c.Status == ContentStatus.Draft
                        && c.Approval == null && c.ScheduledPost == null)
            .ToListAsync(ct))
            .OrderBy(c => c.CreatedAt)
            .ToList();
        if (prontas.Count == 0) return changed; // ainda pode ter reclamado pauta órfã acima

        var budget = await db.Budgets.AsNoTracking().FirstOrDefaultAsync(b => b.WorkspaceId == ws.Id, ct);
        var costPerPost = cfg.GetValue<decimal?>("Loop:CostPerPostUsd") ?? cfg.GetValue<decimal?>("Loop:CostPerIdeaUsd") ?? 0.25m;

        foreach (var content in prontas)
        {
            // GATE DE QUALIDADE + AUTO-APROVAÇÃO (task 2.5). Auto-aprova só se a nota ≥ threshold.
            var (approved, approvalReason) = DecideApproval(content.QualityScore, ws.AutoApprovalThreshold);
            if (!approved)
            {
                content.Status = ContentStatus.PendingApproval;
                Audit(db, ws.Id, "robot.pending-review", $"content={content.Id};{approvalReason}", content.BrandId);
                logger.LogInformation("Robô: workspace {Ws} — peça {Content} → revisão humana ({Reason}).", ws.Id, content.Id, approvalReason);
                changed = true;
                continue;
            }

            // PUBLICAÇÃO IMEDIATA: a peça foi GERADA porque É hora de postar (passou o gate de horário
            // na Fase A). Empurrá-la para o próximo slot da agenda (NextFreeSlot) jogaria a arte recém-
            // -nascida para o próximo dia-da-semana marcado (ex.: +7 dias) — contraintuitivo: o horário
            // define QUANDO publicar, e é AGORA. Então agendamos para AGORA (o PublishSchedulerJob pega
            // ScheduledFor <= now no próximo tick de 60s). A recorrência semanal é responsabilidade do
            // Frequency do ScheduledPost, não deste primeiro agendamento. Anti-flood real já está na
            // Fase A (teto de gerações/dia): sem geração empilhada, não há colisão de slot a evitar aqui.
            var agora = DateTimeOffset.UtcNow;
            var slotUtc = agora;

            content.Status = ContentStatus.Scheduled;
            // FK explícito (ContentId) em vez de navegação: o Content já está rastreado e sendo
            // modificado; setar a navegação 1:1 em cima dele confunde o fixup do EF (UPDATE de 0 linhas).
            db.Approvals.Add(new Approval
            {
                WorkspaceId = ws.Id,
                ContentId = content.Id,
                Mode = ApprovalMode.Automatic,
                Approved = true,
                Reviewer = "robot",
                Comments = approvalReason,
                DecidedAt = DateTimeOffset.UtcNow,
            });
            db.ScheduledPosts.Add(new ScheduledPost
            {
                WorkspaceId = ws.Id,
                ContentId = content.Id,
                ScheduledFor = slotUtc,
                Frequency = Frequency.None,
                Dispatched = false,
            });

            // Gasto do POST (o gasto de GERAÇÃO já foi gravado pelo reaper com uso real).
            if (budget is not null)
                db.SpendEntries.Add(new SpendEntry
                {
                    WorkspaceId = ws.Id, BudgetId = budget.Id, BrandId = content.BrandId,
                    ContentId = content.Id, AmountUsd = costPerPost, Reason = "robot:post",
                });

            Audit(db, ws.Id, "robot.scheduled", $"content={content.Id};slot={slotUtc:o};{approvalReason}", content.BrandId);
            logger.LogInformation("Robô: workspace {Ws} — peça {Content} auto-aprovada e agendada para {Slot:o} ({Reason}).",
                ws.Id, content.Id, slotUtc, approvalReason);
            changed = true;
        }

        return changed;
    }

    /// <summary>
    /// Reconciliação: quando a geração do robô FALHA (o GeneratingReaperJob marca o Content como Failed
    /// mas não toca a pauta), a pauta ficaria presa em InProgress para sempre — o robô nunca a re-tentaria.
    /// Aqui devolvemos essas pautas a Backlog para o robô poder tentar de novo num tick futuro. Casa o
    /// Content Failed do robô com sua pauta InProgress. Idempotente.
    /// </summary>
    private async Task<bool> ReclaimStrandedPautasAsync(AppDbContext db, Workspace ws, CancellationToken ct)
    {
        var falhadas = await db.Contents
            .Where(c => c.WorkspaceId == ws.Id && c.FromAutonomousLoop
                        && c.Status == ContentStatus.Failed && c.PautaId != null)
            .Select(c => c.PautaId!.Value)
            .ToListAsync(ct);
        if (falhadas.Count == 0) return false;

        var presas = await db.Pautas
            .Where(p => p.WorkspaceId == ws.Id && p.Status == PautaStatus.InProgress && falhadas.Contains(p.Id))
            .ToListAsync(ct);
        if (presas.Count == 0) return false;

        foreach (var p in presas)
        {
            p.Status = PautaStatus.Backlog; // volta à fila — o robô re-tenta no próximo tick
            logger.LogInformation("Robô: workspace {Ws} — pauta '{Title}' liberada (geração falhou) → Backlog p/ re-tentar.", ws.Id, p.Title);
        }
        return true;
    }

    /// <summary>Handle IG do tenant (assinatura nos slides). Precedência: principal conectada → 1ª
    /// conectada. Predicado BrandId explícito (worker sem filtro de tenant). Null → agents sem assinatura.</summary>
    private static async Task<string?> ResolveHandleAsync(AppDbContext db, Guid brandId, CancellationToken ct)
    {
        var contas = await db.InstagramAccounts.AsNoTracking()
            .Where(a => a.BrandId == brandId && a.IsConnected)
            .ToListAsync(ct);
        var conta = contas.OrderBy(a => a.CreatedAt).ThenBy(a => a.Id).FirstOrDefault(a => a.IsPrimary)
                    ?? contas.OrderBy(a => a.CreatedAt).ThenBy(a => a.Id).FirstOrDefault();
        var u = conta?.Username;
        if (string.IsNullOrWhiteSpace(u)) return null;
        u = u.Trim();
        return u.StartsWith('@') ? u : "@" + u;
    }

    /// <summary>
    /// task 2.5 — GATE de auto-aprovação (puro). Auto-aprova só se a nota existe E ≥ threshold. Score
    /// null (sem geração/avaliação) → NÃO auto-aprova (conservador: não publica arte não-avaliada).
    /// Retorna (aprovado, motivo auditável). internal p/ teste.
    /// </summary>
    internal static (bool approved, string reason) DecideApproval(int? qualityScore, int threshold)
    {
        if (qualityScore is null)
            return (false, "sem nota de qualidade (não avaliado) → revisão humana");
        if (qualityScore.Value >= threshold)
            return (true, $"nota {qualityScore} >= threshold {threshold} → auto-aprovado");
        return (false, $"nota {qualityScore} < threshold {threshold} → revisão humana");
    }

    private void Audit(AppDbContext db, Guid wsId, string action, string target, Guid? brandId = null)
    {
        db.AuditEntries.Add(new AuditEntry
        {
            WorkspaceId = wsId,
            BrandId = brandId,
            ActorUserId = SystemActor,
            ActorEmail = "robot@system",
            Action = action,
            Target = target,
            OccurredAt = DateTimeOffset.UtcNow,
        });
    }

    // ── Fuso: UTC↔local do workspace. .NET 8 aceita IDs IANA via ICU. Fallback seguro (UTC) se o ID
    //    for inválido — o robô nunca quebra por fuso mal configurado, só perde precisão de horário.
    private DateTimeOffset ToLocal(DateTimeOffset utc, string tzId)
    {
        try
        {
            var tz = TimeZoneInfo.FindSystemTimeZoneById(tzId);
            return TimeZoneInfo.ConvertTime(utc, tz);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Fuso '{Tz}' inválido — usando UTC (robô perde precisão de horário).", tzId);
            return utc;
        }
    }

    private DateTimeOffset ToUtc(DateTime local, string tzId)
    {
        try
        {
            var tz = TimeZoneInfo.FindSystemTimeZoneById(tzId);
            // local é "unspecified" vindo de .Date/.DateTime — trata como hora de parede no fuso do ws.
            var unspecified = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
            return new DateTimeOffset(unspecified, tz.GetUtcOffset(unspecified)).ToUniversalTime();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Fuso '{Tz}' inválido — assumindo UTC.", tzId);
            return new DateTimeOffset(DateTime.SpecifyKind(local, DateTimeKind.Utc));
        }
    }
}
