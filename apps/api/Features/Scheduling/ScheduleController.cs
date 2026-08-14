using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Features.Settings;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Scheduling;

// A5 (ADR-0010): ScheduledForLocal é a hora de PAREDE local (ex.: "2026-06-20T09:00", sem fuso) —
// o servidor a converte para UTC pelo Workspace.TimeZoneId. Mantém ScheduledFor (instante absoluto)
// p/ compatibilidade: se ScheduledForLocal vier, ele tem precedência. ScheduledFor persistido = UTC.
public record ScheduleRequest(
    Guid ContentId, DateTimeOffset ScheduledFor, Frequency? Frequency, string? ScheduledForLocal = null);
public record ScheduledPostDto(
    Guid Id, Guid ContentId, DateTimeOffset ScheduledFor, Frequency Frequency, bool Dispatched,
    string IdempotencyKey, ContentStatus ContentStatus, bool? OutsideWindow = null);
// "Publicar agora": só o id do conteúdo; o instante é o servidor que define (now).
public record PublishNowRequest(Guid ContentId);

// task 2.7 — editar horário de um agendamento (mesma semântica de fuso do Schedule).
public record RescheduleRequest(
    DateTimeOffset ScheduledFor, Frequency? Frequency = null, string? ScheduledForLocal = null);
// task 2.7 — agendamento em lote: N itens; cada um agenda um Content num instante.
public record BatchScheduleItem(Guid ContentId, DateTimeOffset ScheduledFor, Frequency? Frequency = null);
public record BatchScheduleRequest(IReadOnlyList<BatchScheduleItem> Items);
public record BatchScheduleResult(Guid ContentId, bool Scheduled, Guid? ScheduledPostId, string? Error);

[ApiController]
[Authorize]
[Route("api/schedule")]
public class ScheduleController(AppDbContext db, ICurrentWorkspace current, BrandResolver brands) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;

    // E1: ScheduledPost não carrega BrandId (é downstream de Content); o isolamento de
    // marca aqui é via Content.BrandId == marca atual. Sem isto, agendava/listava/
    // desagendava conteúdo de outra marca no mesmo workspace (furo da auditoria).
    private Task<Guid> CurrentBrandAsync() => brands.ResolveAsync();

    /// <summary>Agenda um post. Gate de moderação humana: só agenda conteúdo aprovado,
    /// exceto quando o modo efetivo (conteúdo > campanha > workspace) for Automatic.</summary>
    [HttpPost]
    public async Task<ActionResult<ScheduledPostDto>> Schedule(ScheduleRequest req)
    {
        var brandId = await CurrentBrandAsync();
        var content = await db.Contents
            .Include(c => c.ScheduledPost)
            .Include(c => c.Campaign)
            .FirstOrDefaultAsync(c => c.Id == req.ContentId && c.BrandId == brandId);
        if (content is null) return NotFound("Conteúdo não encontrado.");
        if (content.Status is ContentStatus.Rejected or ContentStatus.Failed)
            return Problem("Conteúdo rejeitado/falho não pode ser agendado.", statusCode: 400);
        if (content.ScheduledPost is not null)
            return Problem("Conteúdo já agendado.", statusCode: 409);

        var workspace = await db.Workspaces.AsNoTracking().FirstAsync(w => w.Id == Ws);

        // A5: resolve o instante UTC. Se veio a hora LOCAL de parede, converte pelo fuso do
        // workspace (ToUtc); senão usa o instante absoluto recebido. ScheduledFor sempre UTC.
        DateTimeOffset scheduledForUtc;
        if (!string.IsNullOrWhiteSpace(req.ScheduledForLocal))
        {
            if (!DateTime.TryParse(req.ScheduledForLocal, System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None, out var local))
                return Problem("Data/hora local inválida.", statusCode: 400);
            scheduledForUtc = TimeZoneConversion.ToUtc(local, workspace.TimeZoneId);
        }
        else
        {
            // F7: normaliza p/ UTC. O Npgsql só escreve DateTimeOffset com offset 0 em 'timestamptz';
            // um instante absoluto com offset != 0 (cliente que mande hora com fuso) estouraria no
            // SaveChanges. ToUniversalTime() preserva o MESMO instante e é no-op p/ entrada já-UTC
            // (a web manda ISO UTC) — defesa em profundidade, sem mudar comportamento do caminho atual.
            scheduledForUtc = req.ScheduledFor.ToUniversalTime();
        }

        if (scheduledForUtc < DateTimeOffset.UtcNow.AddMinutes(-1))
            return Problem("Data de agendamento no passado.", statusCode: 400);

        // B5: guarda de aprovação server-side. O gate humano não pode ser furado pela
        // API: agendar exige Status==Approved, a menos que o modo efetivo seja Automatic.
        var effectiveMode = Features.Approval.ApprovalController.ResolveMode(content, content.Campaign, workspace);
        if (effectiveMode == ApprovalMode.Manual && content.Status != ContentStatus.Approved)
            return Problem(
                "Conteúdo precisa estar aprovado para ser agendado (modo de aprovação manual).",
                statusCode: 409);

        var post = new ScheduledPost
        {
            WorkspaceId = Ws,
            ContentId = content.Id,
            ScheduledFor = scheduledForUtc,
            // G5 (ADR-0014): recorrência opcional; ausente → None (publica 1×).
            Frequency = req.Frequency ?? Frequency.None,
        };
        db.ScheduledPosts.Add(post);
        content.TransitionTo(ContentStatus.Scheduled); // F4/C1: validado (Approved/Draft/PendingApproval → Scheduled)
        await db.SaveChangesAsync();

        // A5: aviso SOFT (não trava) — o horário local cai fora da janela de publicação configurada?
        var outsideWindow = IsOutsideWindow(scheduledForUtc, workspace);
        return Ok(ToDto(post, content.Status, outsideWindow));
    }

    /// <summary>
    /// "Publicar agora": agenda o conteúdo para o INSTANTE atual, sem o operador escolher data.
    /// É um Schedule com ScheduledFor=now — reusa TODO o pipeline (gate de aprovação, idempotência,
    /// dedup do PublishJob). O worker (dedicado ou embutido na API) o publica no próximo tick do
    /// PublishSchedulerJob (≤60s). NÃO publica de forma síncrona nem cria PublishLog à mão: isso
    /// duplicaria a lógica do scheduler e arriscaria furar a idempotência/dedup.
    /// </summary>
    [HttpPost("publish-now")]
    public async Task<ActionResult<ScheduledPostDto>> PublishNow([FromBody] PublishNowRequest req)
    {
        var brandId = await CurrentBrandAsync();
        var content = await db.Contents
            .Include(c => c.ScheduledPost)
            .Include(c => c.Campaign)
            .FirstOrDefaultAsync(c => c.Id == req.ContentId && c.BrandId == brandId);
        if (content is null) return NotFound("Conteúdo não encontrado.");
        if (content.Status is ContentStatus.Rejected or ContentStatus.Failed)
            return Problem("Conteúdo rejeitado/falho não pode ser publicado.", statusCode: 400);
        if (content.ScheduledPost is not null)
            return Problem("Conteúdo já agendado/publicado.", statusCode: 409);

        var workspace = await db.Workspaces.AsNoTracking().FirstAsync(w => w.Id == Ws);

        // Mesmo gate humano do agendamento: publicar exige Approved, salvo modo efetivo Automatic.
        var effectiveMode = Features.Approval.ApprovalController.ResolveMode(content, content.Campaign, workspace);
        if (effectiveMode == ApprovalMode.Manual && content.Status != ContentStatus.Approved)
            return Problem(
                "Conteúdo precisa estar aprovado para ser publicado (modo de aprovação manual).",
                statusCode: 409);

        var post = new ScheduledPost
        {
            WorkspaceId = Ws,
            ContentId = content.Id,
            ScheduledFor = DateTimeOffset.UtcNow, // agora — o scheduler pega no próximo tick.
            Frequency = Frequency.None,           // publicação imediata é sempre 1×.
        };
        db.ScheduledPosts.Add(post);
        content.TransitionTo(ContentStatus.Scheduled);
        await db.SaveChangesAsync();

        return Ok(ToDto(post, content.Status));
    }

    /// <summary>A5: o instante (UTC) cai fora da janela de publicação local do workspace? null se
    /// não há janela configurada. Aviso suave — o agendamento já foi feito, isto só sinaliza à UI.</summary>
    private static bool? IsOutsideWindow(DateTimeOffset utc, Workspace ws)
    {
        if (ws.PublishWindowStart is not { } start || ws.PublishWindowEnd is not { } end) return null;
        var localTime = TimeOnly.FromDateTime(TimeZoneConversion.ToLocal(utc, ws.TimeZoneId));
        // Janela normal (start<=end) ou que cruza a meia-noite (start>end, ex.: 22:00–06:00).
        var dentro = start <= end
            ? localTime >= start && localTime <= end
            : localTime >= start || localTime <= end;
        return !dentro;
    }

    /// <summary>Calendário editorial: posts agendados num período [from,to].</summary>
    [HttpGet("calendar")]
    public async Task<ActionResult<IEnumerable<ScheduledPostDto>>> Calendar(
        [FromQuery] DateTimeOffset? from, [FromQuery] DateTimeOffset? to)
    {
        var brandId = await CurrentBrandAsync();
        var f = from ?? DateTimeOffset.UtcNow.AddDays(-7);
        var t = to ?? DateTimeOffset.UtcNow.AddDays(30);
        var posts = await db.ScheduledPosts.AsNoTracking().Include(p => p.Content)
            .Where(p => p.Content!.BrandId == brandId)
            .Where(p => p.ScheduledFor >= f && p.ScheduledFor <= t)
            .OrderBy(p => p.ScheduledFor)
            .ToListAsync();
        return Ok(posts.Select(p => ToDto(p, p.Content!.Status)));
    }

    /// <summary>
    /// task 2.7 — EDITAR o horário de um agendamento existente (não-despachado). Reusa a conversão de
    /// fuso e a validação "não no passado". Não muda o Content nem a idempotência — só o instante.
    /// </summary>
    [HttpPut("{id:guid}")]
    public async Task<ActionResult<ScheduledPostDto>> Reschedule(Guid id, RescheduleRequest req)
    {
        var brandId = await CurrentBrandAsync();
        var post = await db.ScheduledPosts.Include(p => p.Content)
            .FirstOrDefaultAsync(p => p.Id == id && p.Content!.BrandId == brandId);
        if (post is null) return NotFound();
        if (post.Dispatched) return Problem("Post já despachado — não pode ser reagendado.", statusCode: 409);

        var workspace = await db.Workspaces.AsNoTracking().FirstAsync(w => w.Id == Ws);
        DateTimeOffset newUtc;
        if (!string.IsNullOrWhiteSpace(req.ScheduledForLocal))
        {
            if (!DateTime.TryParse(req.ScheduledForLocal, System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None, out var local))
                return Problem("Data/hora local inválida.", statusCode: 400);
            newUtc = TimeZoneConversion.ToUtc(local, workspace.TimeZoneId);
        }
        else
        {
            newUtc = req.ScheduledFor.ToUniversalTime();
        }
        if (newUtc < DateTimeOffset.UtcNow.AddMinutes(-1))
            return Problem("Data de agendamento no passado.", statusCode: 400);

        post.ScheduledFor = newUtc;
        if (req.Frequency is { } freq) post.Frequency = freq;
        await db.SaveChangesAsync();
        return Ok(ToDto(post, post.Content!.Status, IsOutsideWindow(newUtc, workspace)));
    }

    /// <summary>
    /// task 2.7 — LOOKAHEAD: os próximos <paramref name="count"/> posts agendados (não-despachados) da
    /// marca atual, a partir de agora. "Quantos posts à frente" — a visão do operador do que vem por aí.
    /// count clampado a [1,50] (default 10).
    /// </summary>
    [HttpGet("lookahead")]
    public async Task<ActionResult<IEnumerable<ScheduledPostDto>>> Lookahead([FromQuery] int count = 10)
    {
        var brandId = await CurrentBrandAsync();
        var take = Math.Clamp(count, 1, 50);
        var now = DateTimeOffset.UtcNow;
        // GOTCHA SQLite: o provider de teste não traduz o filtro DateTimeOffset + join sob o
        // query filter de tenant. Materializa por marca (índice barato) e filtra/ordena em memória —
        // mesmo padrão do PerformanceAnalyzer/Calendar. Em Postgres o custo é o mesmo (poucos posts/marca).
        var candidates = await db.ScheduledPosts.AsNoTracking().Include(p => p.Content)
            .Where(p => p.Content!.BrandId == brandId)
            .ToListAsync();
        var posts = candidates
            .Where(p => !p.Dispatched && p.ScheduledFor >= now)
            .OrderBy(p => p.ScheduledFor)
            .Take(take)
            .ToList();
        return Ok(posts.Select(p => ToDto(p, p.Content!.Status)));
    }

    /// <summary>
    /// task 2.7 — agendamento em LOTE: agenda vários conteúdos de uma vez. Cada item passa pelas MESMAS
    /// guardas do Schedule individual (existe? aprovado? já agendado?). Um item que falha NÃO derruba os
    /// demais — retorna o resultado por item (sucesso + id, ou erro). Isolamento por marca preservado.
    /// </summary>
    [HttpPost("batch")]
    public async Task<ActionResult<IEnumerable<BatchScheduleResult>>> ScheduleBatch(BatchScheduleRequest req)
    {
        var brandId = await CurrentBrandAsync();
        var workspace = await db.Workspaces.AsNoTracking().FirstAsync(w => w.Id == Ws);
        var results = new List<BatchScheduleResult>();

        foreach (var item in req.Items)
        {
            var content = await db.Contents.Include(c => c.ScheduledPost).Include(c => c.Campaign)
                .FirstOrDefaultAsync(c => c.Id == item.ContentId && c.BrandId == brandId);
            if (content is null) { results.Add(new(item.ContentId, false, null, "Conteúdo não encontrado.")); continue; }
            if (content.Status is ContentStatus.Rejected or ContentStatus.Failed) { results.Add(new(item.ContentId, false, null, "Conteúdo rejeitado/falho.")); continue; }
            if (content.ScheduledPost is not null) { results.Add(new(item.ContentId, false, null, "Já agendado.")); continue; }

            var whenUtc = item.ScheduledFor.ToUniversalTime();
            if (whenUtc < DateTimeOffset.UtcNow.AddMinutes(-1)) { results.Add(new(item.ContentId, false, null, "Data no passado.")); continue; }

            var effectiveMode = Features.Approval.ApprovalController.ResolveMode(content, content.Campaign, workspace);
            if (effectiveMode == ApprovalMode.Manual && content.Status != ContentStatus.Approved)
            { results.Add(new(item.ContentId, false, null, "Precisa estar aprovado (modo manual).")); continue; }

            var post = new ScheduledPost { WorkspaceId = Ws, ContentId = content.Id, ScheduledFor = whenUtc, Frequency = item.Frequency ?? Frequency.None };
            db.ScheduledPosts.Add(post);
            content.TransitionTo(ContentStatus.Scheduled);
            results.Add(new(item.ContentId, true, post.Id, null));
        }

        await db.SaveChangesAsync(); // um único commit para o lote inteiro (os que passaram).
        return Ok(results);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Unschedule(Guid id)
    {
        var brandId = await CurrentBrandAsync();
        var post = await db.ScheduledPosts.Include(p => p.Content)
            .FirstOrDefaultAsync(p => p.Id == id && p.Content!.BrandId == brandId);
        if (post is null) return NotFound();
        if (post.Dispatched) return Problem("Post já despachado para publicação.", statusCode: 409);
        if (post.Content is not null) post.Content.TransitionTo(ContentStatus.Approved); // F4/C1: Scheduled → Approved (desagendar)
        db.ScheduledPosts.Remove(post);
        await db.SaveChangesAsync();
        return NoContent();
    }

    private static ScheduledPostDto ToDto(ScheduledPost p, ContentStatus cs, bool? outsideWindow = null) =>
        new(p.Id, p.ContentId, p.ScheduledFor, p.Frequency, p.Dispatched, p.IdempotencyKey, cs, outsideWindow);
}
