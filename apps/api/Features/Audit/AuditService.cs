using Microsoft.Extensions.Logging;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;

namespace SocialAi.Api.Features.Audit;

/// <summary>
/// C2 (D5/ADR-0010): dono único da escrita da trilha de auditoria. Append-only — grava um
/// AuditEntry no ponto de cada ação sensível (lista fechada do aceite C2): conectar/desconectar
/// conta, mudar App Meta, aprovar/rejeitar conteúdo, convidar/remover usuário, promover ideia.
///
/// Escrita EXPLÍCITA (não interceptor): o interceptor não sabe "quem" sem reler o JWT (camada
/// errada) e auditaria tudo (ruído). O autor vem do claim do controller chamador.
///
/// Persiste no MESMO DbContext do request (entra na transação do SaveChanges do handler quando
/// chamado antes; ou comita sozinho quando chamado depois). Nunca derruba a ação principal:
/// a auditoria é registro, não gate.
/// </summary>
public sealed class AuditService(AppDbContext db, ILogger<AuditService> logger)
{
    /// <summary>Registra uma ação. workspaceId/actor explícitos (o callback OAuth é anônimo e
    /// passa os dados derivados do state). Comita imediatamente (SaveChanges próprio).
    ///
    /// A trilha é REGISTRO, não gate: como é chamada DEPOIS do commit da ação principal, uma falha
    /// aqui NÃO pode derrubar uma ação já efetivada (retornaria 500 enganoso). Por isso engolimos a
    /// exceção e logamos — a auditoria pode perder uma linha, a ação não regride.</summary>
    public async Task LogAsync(
        Guid workspaceId, Guid actorUserId, string actorEmail,
        string action, string target, Guid? brandId = null, CancellationToken ct = default)
    {
        try
        {
            db.AuditEntries.Add(new AuditEntry
            {
                WorkspaceId = workspaceId,
                BrandId = brandId,
                ActorUserId = actorUserId,
                ActorEmail = actorEmail,
                Action = action,
                Target = target,
                OccurredAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Falha ao gravar AuditEntry (ação={Action}, ws={Ws}) — ação principal preservada.",
                action, workspaceId);
        }
    }
}
