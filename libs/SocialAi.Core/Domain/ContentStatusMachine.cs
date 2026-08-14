namespace SocialAi.Api.Domain;

/// <summary>
/// F4/C1 (ADR-0014) — Máquina de estado EXPLÍCITA do ciclo de vida de um Content.
///
/// Antes, as transições de <see cref="ContentStatus"/> viviam como <c>if</c>s espalhados por vários
/// controllers (Approval, Schedule, Publishing, Content). Não havia um lugar ÚNICO que dissesse
/// "de X só se pode ir para Y/Z" — então uma transição inválida (ex.: Published→Draft) passaria
/// silenciosa. Esta classe é a fonte ÚNICA da verdade: o mapa de transições válidas + um guard.
///
/// Uso: em vez de <c>content.Status = ContentStatus.Approved</c> direto, chamar
/// <c>content.TransitionTo(ContentStatus.Approved)</c> (extensão abaixo) — que VALIDA contra o mapa
/// e lança <see cref="InvalidContentTransitionException"/> se a transição não existir. O comportamento
/// observável dos fluxos atuais NÃO muda (todas as transições hoje usadas são válidas no mapa); o que
/// muda é que transições inválidas passam a falhar cedo, com mensagem clara — rede para o próximo dev.
///
/// O mapa foi derivado dos fluxos REAIS (verificados em código), não de suposições:
///   Generating → Draft (conclusão) | Failed (erro/reaper)
///   Draft/PendingApproval → Approved | Rejected | PendingApproval | Scheduled (modo Automatic)
///   Approved → Scheduled | Published | EphemeralPublished | Failed | Rejected
///   Scheduled → Approved (desagendar) | Published | EphemeralPublished | Failed
///   Failed → Approved (re-tentativa de publish, PublishingController)
///   Published/EphemeralPublished/Rejected → terminais (regenerar cria um NOVO Content, não transiciona)
/// Idempotência: transicionar para o MESMO estado é sempre permitido (no-op seguro).
/// </summary>
public static class ContentStatusMachine
{
    // Mapa imutável: estado → conjunto de estados-destino permitidos. Único ponto a editar quando
    // o ciclo de vida mudar (e o teste de transições inválidas pega qualquer divergência).
    private static readonly IReadOnlyDictionary<ContentStatus, IReadOnlySet<ContentStatus>> Allowed =
        new Dictionary<ContentStatus, IReadOnlySet<ContentStatus>>
        {
            [ContentStatus.Generating] = Set(ContentStatus.Draft, ContentStatus.Failed),
            [ContentStatus.Draft] = Set(
                ContentStatus.PendingApproval, ContentStatus.Approved, ContentStatus.Rejected,
                ContentStatus.Scheduled, ContentStatus.Failed),
            [ContentStatus.PendingApproval] = Set(
                ContentStatus.Approved, ContentStatus.Rejected, ContentStatus.Scheduled),
            [ContentStatus.Approved] = Set(
                ContentStatus.Scheduled, ContentStatus.Published, ContentStatus.EphemeralPublished,
                ContentStatus.Failed, ContentStatus.Rejected),
            [ContentStatus.Scheduled] = Set(
                ContentStatus.Approved, ContentStatus.Published, ContentStatus.EphemeralPublished,
                ContentStatus.Failed),
            [ContentStatus.Failed] = Set(ContentStatus.Approved),
            // Terminais — sem transições de saída (regenerar gera um NOVO Content).
            [ContentStatus.Published] = Set(),
            [ContentStatus.EphemeralPublished] = Set(),
            [ContentStatus.Rejected] = Set(),
        };

    private static IReadOnlySet<ContentStatus> Set(params ContentStatus[] s) => new HashSet<ContentStatus>(s);

    /// <summary>true se a transição from→to é válida (ou um no-op from==to).</summary>
    public static bool CanTransition(ContentStatus from, ContentStatus to)
        => from == to || (Allowed.TryGetValue(from, out var set) && set.Contains(to));

    /// <summary>Valida from→to; lança InvalidContentTransitionException se inválida. No-op se from==to.</summary>
    public static void EnsureTransition(ContentStatus from, ContentStatus to)
    {
        if (!CanTransition(from, to))
            throw new InvalidContentTransitionException(from, to);
    }
}

/// <summary>Açúcar: <c>content.TransitionTo(novo)</c> valida e aplica a transição (ou no-op se igual).</summary>
public static class ContentStatusTransitions
{
    public static void TransitionTo(this Content content, ContentStatus to)
    {
        ContentStatusMachine.EnsureTransition(content.Status, to);
        if (content.Status == to) return; // no-op idempotente — não mexe em UpdatedAt à toa.
        content.Status = to;
        content.UpdatedAt = DateTimeOffset.UtcNow;
    }
}

/// <summary>F4/C1: transição de estado inválida (rede contra regressão de fluxo).</summary>
public sealed class InvalidContentTransitionException(ContentStatus from, ContentStatus to)
    : Exception($"Transição de status inválida: {from} → {to}.")
{
    public ContentStatus From { get; } = from;
    public ContentStatus To { get; } = to;
}
