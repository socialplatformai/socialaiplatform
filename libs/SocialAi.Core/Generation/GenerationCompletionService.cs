using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;

namespace SocialAi.Api.Generation;

/// <summary>Slide de um resultado de geração, neutro (sem acoplar ao contrato HTTP do agents).
/// FASE 1 (ADR-0014): RenderHtml removido (B2); LayersJson é o JSON OPACO das camadas de composição
/// (fundo + elementos), persistido verbatim — null quando o pipeline não produziu spec visual.</summary>
public readonly record struct OutcomeSlide(int Index, string? Copy, string? ImageUrl, string? LayersJson);

/// <summary>F5 (Eixo D): uso REAL da geração (tokens + nº de imagens + provider/modelos efetivos),
/// neutro de Core. Vem do contrato agents (api e worker mapeiam dos seus clientes). Null quando o
/// pipeline não reportou uso (mock/sem chave) → o gasto cai no custo fixo por formato (degradado).</summary>
public sealed record GenerationUsage(
    int TextInputTokens, int TextOutputTokens, int ImageCount,
    string? Provider, string? TextModel, string? ImageModel);

/// <summary>
/// Resultado de um job de geração concluído (done), num tipo NEUTRO de Core. A API mapeia disto
/// de AgentsResult; o worker mapeia do seu cliente. Permite que a transição Generating→Draft tenha
/// UM dono (GenerationCompletionService), em vez de duplicada entre poll e reconciliador.
/// </summary>
public sealed record GenerationOutcome(
    string Caption,
    string Cta,
    IReadOnlyList<string> Hashtags,
    int? QualityScore,
    IReadOnlyList<OutcomeSlide> Slides,
    // F5 (Eixo D): uso real p/ custo por token×modelo. Null → custo fixo por formato (mock/degradado).
    GenerationUsage? Usage = null,
    // F6/B3: template escolhido pelo pipeline (reveal no wizard). Null em mock/degradado.
    string? TemplateName = null,
    // AI-native: raciocínio dos agentes serializado em JSON (reveal "por que a IA fez assim"). Null
    // em mock/degradado. Opaco aqui — montado pela API a partir de AgentsResult.Reasoning.
    string? ReasoningJson = null);

/// <summary>
/// B4/D3 (ADR-0009): dono ÚNICO da transição Generating→Draft que persiste o resultado e grava o
/// SpendEntry de geração. Chamado por DOIS caminhos: o poll (ContentController.JobStatus) e o
/// reconciliador no worker (GeneratingReaperJob) — ambos convergem sem duplicar lógica nem custo.
///
/// Atomicidade (preservada da implementação original do poll): ExecuteUpdateAsync condicional
/// (Generating→Draft) garante que só UM caminho vença a corrida (1 linha afetada); o índice único
/// ContentSlide(ContentId,Index) é a rede final contra slides duplicados. O SpendEntry é idempotente
/// pelo índice único filtrado SpendEntry(ContentId,Reason) — poll e reconciliador nunca dobram o gasto.
/// </summary>
public sealed class GenerationCompletionService(GenerationCostService costs, ISlideImageStore? imageStore = null)
{
    /// <summary>
    /// Tenta completar a geração: se o Content ainda está Generating, transiciona p/ Draft, persiste
    /// slides/caption/cta/quality, marca a pauta Done e grava 1 SpendEntry (custo por formato). NÃO
    /// chama SaveChanges — o chamador controla a transação (e trata DbUpdateException da corrida).
    /// Retorna true se ESTE caminho venceu a transição (fez o trabalho); false se outro já venceu.
    /// </summary>
    public async Task<bool> TryCompleteAsync(AppDbContext db, Content content, GenerationOutcome outcome, CancellationToken ct = default)
    {
        // Transição ATÔMICA e condicional + persistência dos campos do resultado NUM ÚNICO
        // ExecuteUpdateAsync (escrita direta, não-rastreada): só prossegue quem mudar Generating→Draft
        // (1 linha). Fazer TODA a atualização do Content por ExecuteUpdate — em vez de mutar a entidade
        // rastreada — evita o conflito de snapshot (ExecuteUpdate não atualiza o change-tracker; mutar a
        // mesma entidade depois geraria um UPDATE de concorrência que afeta 0 linhas → exceção).
        var caption = outcome.Caption;
        var cta = outcome.Cta;
        var hashtags = string.Join(" ", outcome.Hashtags);
        var quality = outcome.QualityScore;
        var templateName = outcome.TemplateName; // F6/B3: template escolhido (reveal no wizard)
        var reasoningJson = outcome.ReasoningJson; // AI-native: raciocínio dos agentes (reveal)
        var agora = DateTimeOffset.UtcNow;
        var ganhou = await db.Contents
            .Where(c => c.Id == content.Id && c.Status == ContentStatus.Generating)
            .ExecuteUpdateAsync(set => set
                .SetProperty(c => c.Status, ContentStatus.Draft)
                .SetProperty(c => c.Caption, caption)
                .SetProperty(c => c.Cta, cta)
                .SetProperty(c => c.Hashtags, hashtags)
                .SetProperty(c => c.QualityScore, quality)
                .SetProperty(c => c.TemplateName, templateName)
                .SetProperty(c => c.ReasoningJson, reasoningJson)
                .SetProperty(c => c.UpdatedAt, agora), ct);
        if (ganhou != 1) return false;

        // Slides são entidades NOVAS (INSERT puro, sem conflito de snapshot). O índice único
        // ContentSlide(ContentId,Index) é a rede final contra duplicação por dois caminhos.
        foreach (var s in outcome.Slides)
        {
            // GARGALO Nº1: materializa a imagem (base64 → MinIO → URL curta) NO MOMENTO da geração,
            // p/ o DTO de /content/{id} ficar leve (URL, não 10MB de blob). Sem store (dev/degradado)
            // → mantém o base64 (StoreAsync devolve o source). A chave segue o esquema do publish.
            var imageUrl = imageStore is null
                ? s.ImageUrl
                : await imageStore.StoreAsync(s.ImageUrl, $"{content.WorkspaceId}/{content.Id}/{s.Index}", ct);

            db.ContentSlides.Add(new ContentSlide
            {
                WorkspaceId = content.WorkspaceId, ContentId = content.Id, Index = s.Index,
                // FASE 1 (ADR-0014): LayersJson (JSON opaco das camadas) substitui RenderHtml.
                Copy = s.Copy, ImageUrl = imageUrl, LayersJson = s.LayersJson,
            });
        }

        // Pauta → Done (via ExecuteUpdate também — não mutar entidade carregada à toa).
        if (content.PautaId is { } pid)
            await db.Pautas
                .Where(p => p.Id == pid && p.BrandId == content.BrandId)
                .ExecuteUpdateAsync(set => set.SetProperty(p => p.Status, PautaStatus.Done), ct);

        await RegistrarGastoAsync(db, content, outcome.Usage, ct);
        return true;
    }

    /// <summary>
    /// B4 + F5 (Eixo D): grava UM SpendEntry da geração (Reason="generate:{format}", ContentId).
    /// Idempotente: se já existe a entry (poll OU reconciliador chegou antes), não grava de novo; o
    /// índice único filtrado (ContentId,Reason) é a rede final. Garante 1 Budget por workspace.
    ///
    /// F5: quando há uso REAL (usage != null), o custo é por token×modelo (GenerationCostEstimator) e
    /// gravamos JobId/Provider/Model/tokens — auditável e correlacionável. SEM uso (mock/sem chave),
    /// cai no custo FIXO por formato (UnitCostUsd) — degradado honesto, sem inventar tokens.
    /// </summary>
    public async Task RegistrarGastoAsync(
        AppDbContext db, Content content, GenerationUsage? usage = null, CancellationToken ct = default)
    {
        var reason = GenerationCostService.ReasonFor(content.Type);
        var jaExiste = await db.SpendEntries.AsNoTracking()
            .AnyAsync(s => s.ContentId == content.Id && s.Reason == reason, ct);
        if (jaExiste) return;

        var budget = await db.Budgets.FirstOrDefaultAsync(b => b.WorkspaceId == content.WorkspaceId, ct);
        if (budget is null)
        {
            budget = new Domain.Budget { WorkspaceId = content.WorkspaceId, MonthlyCapUsd = 0m, AutonomousLoopEnabled = false };
            db.Budgets.Add(budget);
        }

        // F5: custo REAL por token×modelo quando há uso; senão, custo fixo por formato (mock/degradado).
        var amount = usage is not null
            ? GenerationCostEstimator.Estimate(
                usage.TextInputTokens, usage.TextOutputTokens, usage.ImageCount, usage.TextModel, usage.ImageModel)
            : costs.UnitCostUsd(content.Type);

        db.SpendEntries.Add(new SpendEntry
        {
            WorkspaceId = content.WorkspaceId,
            BudgetId = budget.Id,
            BrandId = content.BrandId,
            ContentId = content.Id,
            AmountUsd = amount,
            Reason = reason,
            // F5: correlation id + telemetria de custo real (null quando mock/sem uso).
            JobId = content.JobId,
            Provider = usage?.Provider,
            Model = usage?.TextModel,
            TextInputTokens = usage?.TextInputTokens,
            TextOutputTokens = usage?.TextOutputTokens,
            ImageCount = usage?.ImageCount,
        });
    }
}
