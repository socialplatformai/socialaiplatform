using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Generation;

namespace SocialAi.Worker.Jobs;

/// <summary>
/// C2/S-11 + B4/D3 (ADR-0009): reconciliador + reaper de geração. O pipeline de agents é
/// fire-and-forget com job store em memória; a transição Generating→Draft (que persiste o
/// resultado e grava o SpendEntry) vivia SÓ no poll do navegador (ContentController.JobStatus).
/// Se o cliente fecha a aba antes do 'done', o gasto nunca seria registrado e o teto vazaria.
///
/// A cada tick (1min — mais responsivo que os 5min do antigo reaper), para CADA Content preso em
/// Generating consultamos o agents:
///   - done  → completa via GenerationCompletionService (MESMO dono do poll; dedupe por índice
///             único garante que poll + reconciliador nunca dobrem o gasto).
///   - sumiu (404/restart) E há >10min  → Failed (destrava a pauta; o usuário re-tenta).
///   - ainda running/queued  → deixa quieto (geração leva 60-120s).
/// Job sistêmico: SystemWorkspace (WorkspaceId=null) bypassa o filtro de tenant — varre todos.
/// </summary>
public sealed class GeneratingReaperJob(
    IServiceProvider services,
    AgentsPollClient agentsPoll,
    ILogger<GeneratingReaperJob> logger) : BackgroundService
{
    private static readonly TimeSpan MaxIdade = TimeSpan.FromMinutes(10);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("GeneratingReaperJob iniciado (tick 1min, reconcilia + reaper).");
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        do
        {
            try { await ReapAsync(stoppingToken); }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { logger.LogError(ex, "Falha no tick do GeneratingReaperJob."); }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task ReapAsync(CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var completion = scope.ServiceProvider.GetRequiredService<GenerationCompletionService>();

        // TODOS os Generating (não só os >10min) — para reconciliar gerações recém-concluídas
        // cujo cliente parou de pollar. Include(Slides) p/ a transição adicionar slides.
        var emGeracao = await db.Contents.Include(c => c.Slides)
            .Where(c => c.Status == ContentStatus.Generating)
            .ToListAsync(ct);
        if (emGeracao.Count == 0) return;

        var limite = DateTimeOffset.UtcNow - MaxIdade;
        int reconciliados = 0, falhados = 0;

        foreach (var content in emGeracao)
        {
            if (string.IsNullOrEmpty(content.JobId))
            {
                // Sem JobId não há como consultar — só reaping por idade.
                if (content.CreatedAt < limite) { content.Status = ContentStatus.Failed; falhados++; }
                continue;
            }

            var (status, outcome) = await agentsPoll.PollAsync(content.JobId, ct);

            if (status == "done" && outcome is not null)
            {
                // B4: completa pelo dono ÚNICO (idempotente; se o poll já completou, TryComplete devolve false).
                try
                {
                    if (await completion.TryCompleteAsync(db, content, outcome, ct))
                    {
                        await db.SaveChangesAsync(ct);
                        reconciliados++;
                    }
                }
                catch (DbUpdateException) { db.ChangeTracker.Clear(); } // corrida c/ o poll — já persistido
            }
            else if (status is null && content.CreatedAt < limite)
            {
                // Job sumiu (agents reiniciou) e estourou a janela → Failed.
                content.Status = ContentStatus.Failed;
                falhados++;
            }
            else if (status == "error" && content.CreatedAt < limite)
            {
                content.Status = ContentStatus.Failed;
                falhados++;
            }
            // running/queued, ou dentro da janela sem job → deixa para o próximo tick.
        }

        if (falhados > 0) await db.SaveChangesAsync(ct);
        if (reconciliados > 0 || falhados > 0)
            logger.LogInformation("Reaper: {Rec} geração(ões) reconciliada(s) (gasto gravado), {Fail} marcada(s) como Failed.",
                reconciliados, falhados);
    }
}
