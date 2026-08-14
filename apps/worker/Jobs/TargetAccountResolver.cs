using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;

namespace SocialAi.Worker.Jobs;

/// <summary>
/// A3 (ADR-0010/DEC-8): resolve a conta IG-alvo de um conteúdo por PRECEDÊNCIA explícita:
///   1. Content.TargetInstagramAccountId (override por pauta)
///   2. conta principal da marca (IsPrimary)
///   3. 1ª conta CONECTADA da marca (fallback, tolera 0 principais)
///
/// DONO ÚNICO da seleção de conta no worker (PublishJob + MetricsCollectorJob) — cardinalidade
/// 1→2 chamadores = extrair (reflexo sênior, não duplicar). SEMPRE com predicado explícito
/// `BrandId == content.BrandId && WorkspaceId == content.WorkspaceId`: o isolamento no worker vem
/// dos predicados (SystemWorkspace=null desliga o filtro global por design — invariante 8).
/// </summary>
public static class TargetAccountResolver
{
    public static async Task<InstagramAccount?> ResolveAsync(AppDbContext db, Content content, CancellationToken ct)
    {
        // Predicado base: nunca cruza marca nem workspace (isolamento explícito do worker).
        // O override também é validado contra a marca/workspace do conteúdo — uma conta-alvo de
        // outra marca (caso o estado fique inconsistente) NÃO é usada (cai no fallback).
        if (content.TargetInstagramAccountId is { } targetId)
        {
            var overrideAcct = await db.InstagramAccounts.FirstOrDefaultAsync(
                a => a.Id == targetId
                     && a.BrandId == content.BrandId
                     && a.WorkspaceId == content.WorkspaceId, ct);
            // SÓ honra o override se a conta ainda está CONECTADA. Se a conta-alvo foi
            // desconectada (IsConnected=false; o /disconnect mantém a linha, então o FK SetNull
            // não dispara), o override morto CAI na precedência connected-aware abaixo — evita
            // degradar Graph→Mock silenciosamente quando há outra conta viva na marca. Simetria
            // com o endurecimento já feito no fallback (mesma auditoria adversarial).
            if (overrideAcct is { IsConnected: true }) return overrideAcct;
        }

        // Contas da marca (materializadas: a marca tem poucas contas e o desempate por CreatedAt
        // em memória é portável — não depende de ordenação de DateTimeOffset no provider).
        var doBrand = (await db.InstagramAccounts
                .Where(a => a.BrandId == content.BrandId && a.WorkspaceId == content.WorkspaceId)
                .ToListAsync(ct))
            .OrderBy(a => a.CreatedAt).ThenBy(a => a.Id)
            .ToList();

        // Precedência: principal CONECTADA → 1ª conta conectada → principal (mesmo desconectada) →
        // 1ª conta. Preferir a principal CONECTADA evita publicar em Mock quando a principal foi
        // desconectada mas há outra conta viva na marca (furo pego na auditoria adversarial).
        return doBrand.FirstOrDefault(a => a.IsPrimary && a.IsConnected)
            ?? doBrand.FirstOrDefault(a => a.IsConnected)
            ?? doBrand.FirstOrDefault(a => a.IsPrimary)
            ?? doBrand.FirstOrDefault();
    }
}
