using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Content;

// FASE 1 (ADR-0014): Layers é o JSON OPACO das camadas de composição (fundo + elementos posicionados),
// reemitido verbatim do ContentSlide.LayersJson. null = slide sem camadas (a UI cai no preview só-imagem).
// JsonElement serializa como o objeto JSON cru (não como string escapada). O `<SlideCanvas>` (F2) o renderiza.
public record ContentSlideDto(int Index, string? Copy, string? ImageUrl, System.Text.Json.JsonElement? Layers = null);
public record ContentDto(
    Guid Id, Guid? PautaId, ContentType Type, ContentStatus Status,
    string? Caption, string? Cta, string? Hashtags, IEnumerable<ContentSlideDto> Slides,
    int? QualityScore, // C3: nota de qualidade p/ a UI exibir aviso quando baixa (< 70).
    Guid? TargetInstagramAccountId = null, // A3: conta-alvo override (null = principal da marca).
    string? TemplateName = null, // F6/B3: template escolhido (reveal no wizard).
    // AI-native: raciocínio dos agentes (objeto JSON cru, como Layers). null em mock/degradado/
    // gerações antigas → a UI omite o painel "Raciocínio da IA".
    System.Text.Json.JsonElement? Reasoning = null,
    // G4 (A/B barato): opções de headline/CTA que a IA já gerou — re-extraídas do envelope
    // ReasoningJson. null quando o pipeline não as produziu → o editor omite a faixa "Alternativas".
    ContentAlternativesDto? Alternatives = null);

// G4: alternativas A/B expostas à web (headlines + ctas). Espelha Content.alternatives em
// apps/web/lib/content.ts. Re-extraídas do envelope ReasoningJson no GET (não são coluna própria).
public record ContentAlternativesDto(IEnumerable<string> Headlines, IEnumerable<string> Ctas);

// E11.3 (ADR-0006): edição do texto gerado. Copy por slide + caption/cta/hashtags do conteúdo.
// F3 (ADR-0014): SlideTextEdit ganha Layers (JSON opaco editado no editor visual) — opcional;
// ausente → só o Copy muda (compat com o editor de texto). JsonElement serializa/desserializa cru.
public record SlideTextEdit(int Index, string? Copy, System.Text.Json.JsonElement? Layers = null);
public record ContentTextUpdate(string? Caption, string? Cta, string? Hashtags, IEnumerable<SlideTextEdit> Slides);

[ApiController]
[Authorize]
[Route("api/content")]
public class ContentController(
    AppDbContext db, ICurrentWorkspace current, AgentsClient agents,
    SocialAi.Api.Features.Learning.PerformanceAnalyzer analyzer, BrandResolver brands,
    SecretProtector protector, SocialAi.Api.Generation.GenerationCostService costs,
    SocialAi.Api.Generation.GenerationCompletionService completion,
    SocialAi.Api.Features.Learning.RejectFeedbackService rejectFeedback,
    // Imagem de slide (MinIO): opcional (só registrado com MinIO). Quando presente, reescreve as referências
    // minio: dos slides → URL do proxy no DTO, deixando o JSON leve. Null (degradado) → base64 verbatim.
    MinioImageStore? imageStore = null,
    // Opcional p/ não exigir mudança nos testes que instanciam o controller direto; em runtime o DI injeta.
    ILogger<ContentController>? logger = null)
    : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;

    [HttpGet]
    public async Task<ActionResult<IEnumerable<ContentDto>>> List([FromQuery] Guid? pautaId)
    {
        // E1: filtra pela marca atual (X-Brand-Id) além do isolamento por workspace.
        var brandId = await brands.ResolveAsync();
        var q = db.Contents.AsNoTracking().Include(c => c.Slides)
            .Where(c => c.BrandId == brandId)
            // A6 (ADR-0009): exemplos de "testar marca" (IsSample) ficam FORA da listagem normal.
            .Where(c => !c.IsSample);
        // A5 (ADR-0009): ?pautaId= devolve as variações daquela pauta (comparação lado a lado).
        if (pautaId is { } pid) q = q.Where(c => c.PautaId == pid);
        // GOTCHA: SQLite não traduz ORDER BY DateTimeOffset — materializa e ordena em memória.
        var list = (await q.ToListAsync()).OrderByDescending(c => c.CreatedAt).ToList();
        return Ok(list.Select(ToDto));
    }

    // ── Geração ASYNC (progresso real dos agentes no wizard) ──────────────────
    // H3: o caminho SÍNCRONO de geração foi removido (S-22) — era órfão (zero call sites)
    // e contradizia o contrato "geração nunca é síncrona" (pipeline de 60-120s estoura
    // timeout de proxy). Toda geração passa por generate/async + poll.
    // F6/B1+B3: TemplateKey opcional — quando o operador escolhe um template na galeria do wizard,
    // ele força aquele template (precede a seleção automática do pipeline). null/ausente = a IA
    // escolhe (comportamento atual; não-regressão). É a Key estável (ex.: "product-launch"), não Guid.
    public record GenerateAsyncRequest(Guid? PautaId, string? Theme, ContentType Format, string? TemplateKey = null,
        // Toggle do wizard "usar identidade do logo": estampa o logo da marca nos slides. Só tem
        // efeito quando há logo cadastrado (a API ignora true sem LogoUrl). Default false.
        bool UseLogoIdentity = false,
        // FASE 0 (auditoria — fundação de input criativo): direção criativa por-geração do operador
        // (referência/fundo via URL + CTA + subtítulo). Tudo opcional → ausente = comportamento atual.
        CreativeInputDto? CreativeInput = null);

    // FASE 0: direção criativa que o operador digita no wizard. URL de referência/fundo (Fase 0 =
    // por link; upload de arquivo é evolução do Pilar I) + CTA + subtítulo. Todos opcionais.
    public record CreativeInputDto(string? ReferenceUrl, string? BackgroundUrl, string? Cta, string? Subtitle);
    public record GenerateAsyncResponse(Guid ContentId, string JobId);
    public record JobStatusDto(Guid ContentId, string Status, int Progress, string? Step, string? Error);

    /// <summary>Inicia a geração e retorna { contentId, jobId } na hora (não aguarda o pipeline).</summary>
    [HttpPost("generate/async")]
    public async Task<ActionResult<GenerateAsyncResponse>> GenerateAsyncStart(GenerateAsyncRequest req)
    {
        // E1: a marca atual (X-Brand-Id) define o escopo da geração. Resolvida cedo
        // para impedir gerar a partir de pauta de OUTRA marca no mesmo workspace.
        var currentBrand = await brands.ResolveAsync();

        Domain.Pauta? pauta = null;
        if (req.PautaId is { } pid)
        {
            // E3.4: inclui os anexos — viram referenceContext no payload ao agents.
            pauta = await db.Pautas.Include(p => p.Attachments)
                .FirstOrDefaultAsync(p => p.Id == pid && p.BrandId == currentBrand);
            if (pauta is null) return NotFound("Pauta não encontrada.");

            // C4: geração concorrente da MESMA pauta (ex.: 2 abas) → 409. Evita 2 Contents
            // em Generating para uma pauta só (e o desperdício de 2 pipelines de LLM).
            var jaGerando = await db.Contents.AnyAsync(c =>
                c.PautaId == pid && c.Status == ContentStatus.Generating);
            if (jaGerando)
                return Problem("Esta pauta já está gerando conteúdo.", statusCode: 409);
        }
        else if (string.IsNullOrWhiteSpace(req.Theme))
        {
            return Problem("Informe uma pauta ou um tema.", statusCode: 400);
        }

        // F5 (Eixo D): TETO também na geração MANUAL (antes só o loop autônomo respeitava).
        // Só bloqueia quando o operador definiu um teto (MonthlyCapUsd > 0); cap=0 = sem orçamento
        // configurado = geração livre. A estimativa pré-geração é o custo fixo por formato (B2/B3 —
        // os tokens reais só existem após gerar); o custo REAL gravado depois pode ser menor.
        var (capStatus, capMsg) = await VerificarTetoMensalAsync(req.Format, HttpContext.RequestAborted);
        if (capStatus is not null) return Problem(capMsg, statusCode: capStatus.Value);

        // A marca do conteúdo é a marca atual (a pauta, quando há, já foi validada como
        // pertencente a ela acima). Escopo do contexto do pipeline (brand kit/concorrentes/
        // IG) à marca certa, sem vazar de outra.
        var brandId = currentBrand;
        // E9.5: o Pauta.Id do payload é parametrizado (antes era Guid.NewGuid() interno no
        // caminho tema). Aqui o caminho de GERAÇÃO REAL passa pauta?.Id (ou um Guid novo quando
        // não há pauta), preservando o payload byte-a-byte do comportamento anterior.
        var agentReq = await BuildAgentRequestAsync(
            pauta, req.Theme, req.Format, brandId,
            pauta?.Id.ToString() ?? Guid.NewGuid().ToString(),
            forcedTemplateKey: req.TemplateKey, // F6/B1: força o template escolhido na galeria (se houver)
            useLogoIdentity: req.UseLogoIdentity, // toggle: estampar o logo da marca nos slides
            creativeInput: req.CreativeInput); // FASE 0: direção criativa por-geração (ref/fundo/cta/subtítulo)

        // C2: o jobId é obtido ANTES de persistir o Content, para que o registro nasça já
        // correlacionado ao job (o reaper e o JobStatus dependem disso). Se o agents falhar
        // ao iniciar, nada é persistido (sem Content órfão preso em Generating).
        string jobId;
        try
        {
            jobId = await agents.StartAsync(agentReq, HttpContext.RequestAborted);
        }
        catch (AgentsUnavailableException ex)
        {
            // O agents/provedor de IA recusou (rate-limit, credencial, indisponível). Traduz a
            // categoria num ProblemDetails com mensagem PT-BR — a UI mostra o detail no toast, não
            // um "500". O corpo bruto do upstream vai só p/ o log (diagnóstico), nunca pro operador.
            logger?.LogWarning("Geração recusada pelo agents ({Kind}): {Detail}", ex.Kind, ex.UpstreamDetail);
            var statusCode = ex.Kind switch
            {
                AgentsErrorKind.RateLimited => StatusCodes.Status429TooManyRequests,
                AgentsErrorKind.BadCredential => StatusCodes.Status502BadGateway,
                AgentsErrorKind.Unavailable => StatusCodes.Status503ServiceUnavailable,
                _ => StatusCodes.Status502BadGateway,
            };
            return Problem(ex.UserMessage, statusCode: statusCode);
        }

        var content = new Domain.Content
        {
            WorkspaceId = Ws,
            BrandId = brandId,
            PautaId = pauta?.Id,
            Type = req.Format,
            Status = ContentStatus.Generating,
            JobId = jobId,
        };
        db.Contents.Add(content);
        // C4: pauta entra em InProgress enquanto gera (o estado reflete a realidade).
        if (pauta is not null) pauta.Status = PautaStatus.InProgress;
        await db.SaveChangesAsync();

        return Ok(new GenerateAsyncResponse(content.Id, jobId));
    }

    /// <summary>Repassa o estado do job (status/progress/step) do microserviço. Persiste ao concluir.</summary>
    [HttpGet("jobs/{jobId}")]
    public async Task<ActionResult<JobStatusDto>> JobStatus(string jobId, [FromQuery] Guid contentId)
    {
        // E1: o poll só enxerga conteúdo da marca atual (evita ler/mutar status de
        // conteúdo de outra marca conhecendo o contentId).
        var brandId = await brands.ResolveAsync();
        var content = await db.Contents.Include(c => c.Slides)
            .FirstOrDefaultAsync(c => c.Id == contentId && c.BrandId == brandId);
        if (content is null) return NotFound("Content não encontrado.");

        var job = await agents.GetJobAsync(jobId, HttpContext.RequestAborted);
        if (job is null)
        {
            // C2: o agents perdeu o job (restart — store em memória) e o Content segue preso em
            // Generating. Se já passou da janela tolerável, marca Failed e devolve 'error' (em vez
            // de 404), destravando a pauta. Dentro da janela, devolve o último estado conhecido.
            if (content.Status == ContentStatus.Generating
                && content.CreatedAt < DateTimeOffset.UtcNow.AddMinutes(-10))
            {
                content.Status = ContentStatus.Failed;
                await db.SaveChangesAsync();
                return Ok(new JobStatusDto(contentId, "error", 100, null,
                    "A geração foi perdida (serviço reiniciado). Tente novamente."));
            }
            return Ok(new JobStatusDto(contentId, content.Status == ContentStatus.Failed ? "error" : "running",
                0, null, content.Status == ContentStatus.Failed ? "Geração falhou." : null));
        }

        if (job.Status == "done" && job.Result is not null && content.Status == ContentStatus.Generating)
        {
            // B4/D3 (ADR-0009): a transição Generating→Draft + SpendEntry vive num dono ÚNICO
            // (GenerationCompletionService), reusado pelo reconciliador do worker. Aqui mapeamos
            // o AgentsResult → GenerationOutcome neutro e delegamos. Atomicidade/dedupe no serviço.
            var outcome = ToOutcome(job.Result);
            try
            {
                if (await completion.TryCompleteAsync(db, content, outcome, HttpContext.RequestAborted))
                    await db.SaveChangesAsync();
            }
            catch (DbUpdateException) // corrida: índice único de slide/spend pegou — já persistido.
            {
                db.ChangeTracker.Clear();
            }
        }
        else if (job.Status == "error" && content.Status == ContentStatus.Generating)
        {
            content.Status = ContentStatus.Failed;
            await db.SaveChangesAsync();
            logger?.LogWarning("Geração {ContentId} falhou no pipeline: {Raw}", contentId, job.Error);
        }

        // O job.Error vem CRU do provedor de IA (inglês, técnico). Quando há erro, traduz p/ PT-BR
        // amigável antes de devolver à UI — mesma política do disparo (nunca código/stack cru ao operador).
        var clientError = job.Status == "error" ? AgentsClient.FriendlyJobError(job.Error) : job.Error;
        return Ok(new JobStatusDto(contentId, job.Status, job.Progress, job.Step, clientError));
    }

    private async Task<AgentsGenerateRequest> BuildAgentRequestAsync(
        Domain.Pauta? pauta, string? theme, ContentType format, Guid brandId, string pautaId,
        string? regenerationInstruction = null, string? forcedTemplateKey = null,
        bool useLogoIdentity = false, CreativeInputDto? creativeInput = null)
    {
        // E1: o contexto da geração é da MARCA atual. Sem o filtro por BrandId, o pipeline
        // da marca A recebia brand kit, concorrentes, referências e handle do IG da marca B
        // (vazamento de dados de marca alheia — furo pego na auditoria).
        var kit = await db.BrandKits.AsNoTracking().FirstOrDefaultAsync(k => k.BrandId == brandId);
        var competitors = await db.Competitors.AsNoTracking().Where(c => c.BrandId == brandId).Select(c => c.Handle).ToListAsync();
        var refs = await db.VisualReferences.AsNoTracking().Where(v => v.BrandKit!.BrandId == brandId).Select(v => v.Url).ToListAsync();
        var learning = await analyzer.BuildLearningSummaryAsync(Ws, HttpContext.RequestAborted);
        // Sinal TIPADO de aprendizado (formato vencedor por engajamento) — vai como enum
        // serializado p/ o brand-strategist enviesar a escolha de template. Null com amostra <3 → o
        // viés some e o comportamento atual é preservado. Complementa (não substitui) o learning textual.
        var bestFormat = await analyzer.BuildBestFormatAsync(Ws, HttpContext.RequestAborted);
        // I1/S-12: o handle do tenant (assinatura nos slides) vem da conta IG conectada.
        // Sem conta conectada, fica null → o agents renderiza sem assinatura (nunca a de terceiro).
        // A1 (multi-IG): com N contas/marca, usa a PRINCIPAL conectada (mesma precedência do worker)
        // p/ a assinatura ser estável — não uma conta arbitrária.
        var igAccount = (await db.InstagramAccounts.AsNoTracking()
                .Where(a => a.BrandId == brandId)
                .ToListAsync())
            .OrderBy(a => a.CreatedAt).ThenBy(a => a.Id)
            .FirstOrDefault(a => a.IsPrimary && a.IsConnected)
            ?? (await db.InstagramAccounts.AsNoTracking()
                .Where(a => a.BrandId == brandId && a.IsConnected)
                .ToListAsync())
            .OrderBy(a => a.CreatedAt).ThenBy(a => a.Id)
            .FirstOrDefault();
        var handle = NormalizeHandle(igAccount?.Username);

        // D4 (ADR-0008): templates ATIVOS da marca → request. Ativo = built-in SEM linha de
        // curadoria que o desabilite, OU curadoria com Enabled=true. Sem nenhum template (caso
        // impossível após o seed, mas honesto) → null e o agents cai no registry built-in.
        var (templateNodes, forcedKey) = await BuildTemplatePayloadAsync(brandId, pauta?.ForcedTemplateId, forcedTemplateKey);

        // E2 (ADR-0008): hashtags da biblioteca da marca → brandContext.hashtags (a engine as
        // injeta na caption). Examples já vão por CopyExamples; references por attachments/refs.
        // GOTCHA: ordena em memória (SQLite não traduz DateTimeOffset em ORDER BY); set pequeno.
        var hashtags = (await db.BrandLibraryItems.AsNoTracking()
            .Where(x => x.BrandId == brandId && x.Kind == LibraryItemKind.Hashtag)
            .Select(x => new { x.Value, x.CreatedAt })
            .ToListAsync())
            .OrderBy(x => x.CreatedAt)
            .Select(x => x.Value)
            .ToList();

        var title = pauta?.Title ?? theme ?? "Conteúdo";
        // E2 (ADR-0005): identidade visual + texto de marca → engine. Campos vazios ficam
        // null e o input-adapter cai no preset/default APEX (degradado honesto).
        var visual = BuildVisualIdentity(kit);
        // B4 (ADR-0008): injeta provider/modelo/chave do workspace. Sem Secret → null (omitido
        // no JSON) e o agents cai no .env. A chave decifrada vai no payload interno (rede Docker,
        // autenticada por x-internal-token) — nunca volta em GET nem entra em log da API.
        var aiOverride = await BuildAiOverrideAsync();
        // ADR-0013: overrides de system-prompt por agente (AgentKey→PromptText). Null quando o
        // workspace não tem nenhum → campo omitido (byte-equivalência). Emitido incondicional.
        var promptOverrides = await BuildPromptOverridesAsync();

        // A4 (ADR-0009): feedback de rejeição anterior desta pauta vira nota de regeneração. Combina
        // com a instrução do usuário (A1): ambos entram em additionalNotes pela mesma porta (verbatim).
        var instrucaoEfetiva = await CombinarInstrucaoComFeedbackAsync(regenerationInstruction, pauta?.Id, brandId);

        // FASE 0: direção criativa do operador → AgentsCreativeInput, montado SÓ quando ao menos um
        // campo tem valor (senão null → omitido do JSON → payload byte-equivalente ao atual). O agents
        // roteia: referência/fundo → referenceContext; cta/subtítulo → direção de copy (additionalNotes).
        var creative = BuildCreativeInput(creativeInput);

        return new AgentsGenerateRequest(
            new AgentsBrandContext(Ws.ToString(), kit?.Branding, kit?.Tone,
                kit?.EditorialGuidelines, competitors, refs, learning, handle,
                kit?.PositioningRules, kit?.DesiredContentTypes,
                visual, kit?.TargetAudience, ParseCopyExamples(kit?.CopyExamples),
                // E2: hashtags da biblioteca; vazio → null (sem objeto vazio no payload).
                hashtags.Count > 0 ? hashtags : null,
                // ADR-0013: overrides de prompt; null → omitido do JSON.
                promptOverrides,
                // Formato vencedor TIPADO (lowercase, igual ao `format`: post/carousel/story).
                // Null com amostra <3 → omitido (WhenWritingNull) → payload byte-equivalente ao atual.
                BestFormat: bestFormat?.ToString().ToLowerInvariant()),
            new AgentsPauta(
                pautaId,
                title, pauta?.Objective ?? theme, pauta?.Context,
                // E3.5/E3.4/E3.2: categoria, anexos (URLs) e objetivo de marketing → engine.
                pauta?.Category,
                pauta?.Attachments.Select(a => a.Url).ToList(),
                pauta?.MarketingObjective),
            format.ToString().ToLowerInvariant(),
            aiOverride,
            // D4: templates ativos (SpecJson parseado) + id do forçado (Key). Omitidos quando null.
            templateNodes,
            forcedKey,
            // A1/A4 (ADR-0009): instrução de regeneração (+ feedback de rejeição). Null → omitido.
            instrucaoEfetiva,
            // Toggle "usar identidade do logo": só envia true quando o operador o ligou E há logo
            // cadastrado (sem LogoUrl não há o que estampar). Senão null → omitido (payload atual).
            UseLogoIdentity: useLogoIdentity && !string.IsNullOrWhiteSpace(kit?.LogoUrl) ? true : null,
            // FASE 0: direção criativa por-geração (null quando o operador não preencheu → omitido).
            CreativeInput: creative);
    }

    /// <summary>
    /// FASE 0: traduz o CreativeInputDto (entrada do wizard) → AgentsCreativeInput (contrato agents),
    /// aparando cada campo e retornando null quando TODOS estão vazios — assim o objeto é omitido do
    /// JSON (WhenWritingNull) e o payload fica byte-equivalente ao atual quando não há direção criativa.
    /// Pura/testável. A entrada por URL é a Fase 0; upload de arquivo (MinIO) é evolução do Pilar I.
    /// </summary>
    private static AgentsCreativeInput? BuildCreativeInput(CreativeInputDto? dto)
    {
        if (dto is null) return null;
        var refUrl = string.IsNullOrWhiteSpace(dto.ReferenceUrl) ? null : dto.ReferenceUrl.Trim();
        var bgUrl = string.IsNullOrWhiteSpace(dto.BackgroundUrl) ? null : dto.BackgroundUrl.Trim();
        var cta = string.IsNullOrWhiteSpace(dto.Cta) ? null : dto.Cta.Trim();
        var subtitle = string.IsNullOrWhiteSpace(dto.Subtitle) ? null : dto.Subtitle.Trim();
        if (refUrl is null && bgUrl is null && cta is null && subtitle is null) return null;
        return new AgentsCreativeInput(refUrl, bgUrl, cta, subtitle);
    }

    /// <summary>
    /// A4 (ADR-0009): combina a instrução de regeneração do usuário (A1) com o ÚLTIMO motivo de
    /// rejeição da pauta (Approval.Comments do último Content rejeitado dela). Ambos são notas de
    /// regeneração e entram juntos no briefing. null se não há instrução nem feedback.
    /// </summary>
    private async Task<string?> CombinarInstrucaoComFeedbackAsync(string? instruction, Guid? pautaId, Guid brandId)
    {
        var partes = new List<string>();
        if (!string.IsNullOrWhiteSpace(instruction)) partes.Add(instruction.Trim());

        if (pautaId is { } pid)
        {
            // A4: dono único da regra (RejectFeedbackService), reusado pelo GET /api/learning/reject-feedback.
            var feedback = await rejectFeedback.UltimoMotivoAsync(pid, brandId);
            if (!string.IsNullOrWhiteSpace(feedback))
                partes.Add($"Feedback de rejeição anterior: {feedback.Trim()}");
        }
        return partes.Count > 0 ? string.Join(" ", partes) : null;
    }

    /// <summary>
    /// D4 (ADR-0008): monta o payload de templates p/ o agents — a lista de CarouselTemplate
    /// ATIVOS da marca (SpecJson parseado em JsonNode, fiel ao shape que o agents valida em D5)
    /// e o id (Key) do template FORÇADO pela pauta, se houver.
    ///
    /// "Ativo" = built-in não-desabilitado por curadoria OU template com BrandTemplate.Enabled=true.
    /// Regra (KISS): parte dos Templates do workspace; uma linha BrandTemplate(brand,template) com
    /// Enabled=false REMOVE o template do pool da marca; sem linha → ativo por padrão (o built-in
    /// vale p/ todas as marcas até alguém desativá-lo). Sem nenhum ativo → (null, ...) e o agents
    /// cai no registry built-in (degradado honesto, D4).
    ///
    /// forcedKey: traduz Pauta.ForcedTemplateId (Guid, FK Template) → Template.Key (o id no fio).
    /// Template forçado inexistente/de outra marca → null (a pauta perde o force; seleção normal).
    /// </summary>
    private async Task<(IEnumerable<System.Text.Json.Nodes.JsonNode>? Templates, string? ForcedKey)>
        BuildTemplatePayloadAsync(Guid brandId, Guid? forcedTemplateId, string? forcedTemplateKey = null)
    {
        var all = await db.Templates.AsNoTracking()
            .Select(t => new { t.Id, t.Key, t.SpecJson })
            .ToListAsync();
        if (all.Count == 0) return (null, null);

        // Curadoria desta marca: Templates explicitamente DESABILITADOS (Enabled=false).
        var disabled = await db.BrandTemplates.AsNoTracking()
            .Where(bt => bt.BrandId == brandId && !bt.Enabled)
            .Select(bt => bt.TemplateId)
            .ToListAsync();
        var disabledSet = disabled.ToHashSet();

        var active = all.Where(t => !disabledSet.Contains(t.Id)).ToList();
        // Fallback honesto: se a marca desativou TUDO, não mande lista vazia (o agents cairia no
        // built-in de qualquer forma) — manda null p/ deixar explícito "use o registry".
        if (active.Count == 0) return (null, null);

        var nodes = new List<System.Text.Json.Nodes.JsonNode>(active.Count);
        foreach (var t in active)
        {
            // SpecJson é JSON canônico (gerado da fonte do agents); parse sem reserializar.
            var node = System.Text.Json.Nodes.JsonNode.Parse(t.SpecJson);
            if (node is not null) nodes.Add(node);
        }

        // F6/B1: precedência do force — a Key escolhida na galeria do wizard VENCE a da pauta.
        // Só vale se o template existe E está ativo p/ a marca (key inválida/desativada → ignora).
        string? forcedKey = null;
        if (!string.IsNullOrWhiteSpace(forcedTemplateKey))
        {
            forcedKey = active.FirstOrDefault(t =>
                string.Equals(t.Key, forcedTemplateKey, StringComparison.OrdinalIgnoreCase))?.Key;
        }
        // Fallback: ForcedTemplateId da pauta (Guid) → Key, quando a galeria não forçou nada.
        if (forcedKey is null && forcedTemplateId is { } fid)
        {
            forcedKey = active.FirstOrDefault(t => t.Id == fid)?.Key;
        }

        return (nodes.Count > 0 ? nodes : null, forcedKey);
    }

    // Espelha o Stored cifrado de AiConfigController (provider/textModel/imageModel/apiKey).
    private record StoredAi(string Provider, string? TextModel, string? ImageModel, string ApiKey);

    /// <summary>
    /// B4: decifra o Secret{AiProviderKey} do workspace atual e o mapeia p/ AgentsAiOverride.
    /// Sem Secret (ou sem chave) → null: o agents usa a config do .env (degradado honesto).
    /// 🔴 A chave decifrada SÓ é colocada no payload ao agents; nunca é logada nem retornada.
    /// </summary>
    private async Task<AgentsAiOverride?> BuildAiOverrideAsync()
    {
        var secret = await db.Secrets.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Kind == SecretKind.AiProviderKey);
        if (secret is null || string.IsNullOrEmpty(secret.EncryptedValue)) return null;

        // Case-insensitive: o registro é gravado por AiConfigController.Stored (PascalCase),
        // mas tolerar casing diferente blinda contra divergência entre os dois records.
        var stored = System.Text.Json.JsonSerializer.Deserialize<StoredAi>(
            protector.Decrypt(secret.EncryptedValue),
            new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        if (stored is null || string.IsNullOrWhiteSpace(stored.ApiKey)) return null;
        return new AgentsAiOverride(stored.Provider, stored.TextModel, stored.ImageModel, stored.ApiKey);
    }

    /// <summary>
    /// ADR-0013: lê os overrides de system-prompt do workspace atual (PromptOverride) e os
    /// mapeia p/ um dicionário AgentKey→PromptText. Espelha BuildAiOverrideAsync: AsNoTracking,
    /// isolamento pelo query filter global, e **null quando vazio** (degradado honesto) — assim o
    /// campo é OMITIDO do JSON (WhenWritingNull) e o payload fica byte-equivalente ao atual.
    /// A emissão é INCONDICIONAL: quem decide aplicar (ou cair no prompt-base) é o agents, atrás da
    /// flag PROMPT_OVERRIDES_ENABLED. Entradas com texto vazio são ignoradas (não viram override).
    /// </summary>
    private async Task<IReadOnlyDictionary<string, string>?> BuildPromptOverridesAsync()
    {
        var rows = await db.PromptOverrides.AsNoTracking()
            .Select(p => new { p.AgentKey, p.PromptText })
            .ToListAsync();
        var map = rows
            .Where(r => !string.IsNullOrWhiteSpace(r.AgentKey) && !string.IsNullOrWhiteSpace(r.PromptText))
            .ToDictionary(r => r.AgentKey, r => r.PromptText);
        return map.Count > 0 ? map : null;
    }

    /// <summary>
    /// Mapeia o AgentsResult (contrato HTTP) → GenerationOutcome (tipo neutro de Core) consumido
    /// pelo GenerationCompletionService. Mantém a fronteira: o serviço de Core não conhece os DTOs
    /// Agents* (que vivem em apps/api); a API traduz aqui (o worker traduz do seu próprio cliente).
    /// </summary>
    private static SocialAi.Api.Generation.GenerationOutcome ToOutcome(AgentsResult r) =>
        new(
            r.Caption,
            r.Cta,
            r.Hashtags.ToList(),
            r.Quality?.Score,
            r.Slides.Select(s => new SocialAi.Api.Generation.OutcomeSlide(
                // FASE 1 (ADR-0014): camadas como JSON opaco — serializa o JsonElement verbatim p/ a
                // coluna LayersJson (string). Ausente → null (slide sem camadas). RenderHtml removido.
                s.Index, s.Copy, s.ImageUrl,
                s.Layers is { } el ? el.GetRawText() : null)).ToList(),
            // F5 (Eixo D): uso real (tokens + nº de imagens + provider/modelos) → custo por modelo no
            // SpendEntry. Ausente em mock/sem chave → null (o serviço cai no custo fixo por formato).
            r.Usage is { } u
                ? new SocialAi.Api.Generation.GenerationUsage(
                    u.TextInputTokens, u.TextOutputTokens, u.ImageCount, u.Provider, u.TextModel, u.ImageModel)
                : null,
            // F6/B3: template escolhido pelo pipeline → persistido p/ o reveal no wizard.
            r.TemplateName,
            // AI-native + G4: serializa raciocínio E alternativas no MESMO envelope JSON (camelCase
            // web) p/ Content.ReasoningJson — sem coluna/migração nova (decisão do operador). Os dois
            // são metadados de IA desta geração; o GET re-separa (ToDto) p/ campos distintos no DTO.
            // Null quando NENHUM dos dois veio (mock/degradado) → coluna null → a UI omite os painéis.
            BuildReasoningEnvelope(r.Reasoning, r.Alternatives));

    /// <summary>
    /// Serializa os tipos fortes da API (AgentsReasoning/AgentsAlternatives) p/ JSON e delega ao
    /// ponto único de montagem do envelope (ReasoningEnvelope em Core), que o worker (reaper) também
    /// usa. O envelope co-localiza raciocínio + `alternatives` numa coluna text (sem migração); o GET
    /// (SplitReasoningEnvelope) re-separa p/ campos distintos do DTO. Null quando ambos ausentes.
    /// </summary>
    private static readonly System.Text.Json.JsonSerializerOptions EnvelopeJson =
        new(System.Text.Json.JsonSerializerDefaults.Web);
    private static string? BuildReasoningEnvelope(AgentsReasoning? reasoning, AgentsAlternatives? alternatives) =>
        SocialAi.Api.Generation.ReasoningEnvelope.Build(
            reasoning is { } rr ? System.Text.Json.JsonSerializer.Serialize(rr, EnvelopeJson) : null,
            alternatives is { } a ? System.Text.Json.JsonSerializer.Serialize(a, EnvelopeJson) : null);

    /// <summary>
    /// F5 (Eixo D): aplica o teto mensal de orçamento à geração MANUAL. Espelha a regra do
    /// AutonomousLoopJob (gasto do mês corrente vs Budget.MonthlyCapUsd), mas só BLOQUEIA quando o
    /// operador configurou um teto (&gt; 0) — cap=0 = sem orçamento = geração livre (não regressão:
    /// hoje a geração manual nunca bloqueia). Retorna (statusCode, msg) p/ bloquear, ou (null, null)
    /// p/ liberar. A estimativa pré-geração é o custo fixo por formato (os tokens só existem após gerar).
    /// </summary>
    private async Task<(int? Status, string? Msg)> VerificarTetoMensalAsync(ContentType format, CancellationToken ct)
    {
        var budget = await db.Budgets.AsNoTracking().FirstOrDefaultAsync(b => b.WorkspaceId == Ws, ct);
        var cap = budget?.MonthlyCapUsd ?? 0m;
        if (cap <= 0m) return (null, null); // sem teto configurado → geração livre (comportamento atual)

        // Gasto do mês corrente (mesma regra do loop e do painel de uso). Materializa e soma em
        // memória (GOTCHA conhecido: SUM(decimal) + filtro de tenant não traduz no SQLite dos testes).
        var monthStart = new DateTimeOffset(
            DateTimeOffset.UtcNow.Year, DateTimeOffset.UtcNow.Month, 1, 0, 0, 0, TimeSpan.Zero);
        var spentThisMonth = (await db.SpendEntries.AsNoTracking()
                .Select(s => new { s.AmountUsd, s.OccurredAt }).ToListAsync(ct))
            .Where(s => s.OccurredAt >= monthStart).Sum(s => s.AmountUsd);

        var estimativa = costs.UnitCostUsd(format);
        if (spentThisMonth + estimativa > cap)
            return (402, // 402 Payment Required: o teto de orçamento foi (ou seria) ultrapassado.
                $"Teto mensal de orçamento atingido (gasto {spentThisMonth:0.00} USD + estimativa " +
                $"{estimativa:0.00} USD > teto {cap:0.00} USD). Ajuste o teto em Configurações para gerar.");
        return (null, null);
    }

    // ── E9.5 (ADR-0007): preview do briefing (read-only) ─────────────────────────
    /// <summary>
    /// Retorna o MESMO AgentsGenerateRequest que a geração montaria, SEM chamar agents nem
    /// criar Content/job. Transparência: a UI mostra "o que a IA vai receber" antes de gerar.
    /// Reusa BrandResolver/isolamento (pauta de outra marca → 404). No caminho de TEMA o
    /// Pauta.Id é um placeholder fixo ("preview"), não persistido — por design (sem pauta).
    /// Funciona em modo degradado: sem kit/IG/<3 métricas, visualIdentity/handle/learningSummary
    /// vêm null (espelha o degradado honesto do pipeline, sem inventar dados).
    /// </summary>
    [HttpGet("briefing/preview")]
    public async Task<ActionResult<AgentsGenerateRequest>> BriefingPreview(
        [FromQuery] Guid? pautaId, [FromQuery] string? theme, [FromQuery] ContentType format)
    {
        // E1: a marca atual (X-Brand-Id) define o escopo — idêntico a GenerateAsyncStart.
        var brandId = await brands.ResolveAsync();

        Domain.Pauta? pauta = null;
        if (pautaId is { } pid)
        {
            // Mesmo isolamento da geração: pauta de OUTRA marca → 404 (não vaza).
            pauta = await db.Pautas.AsNoTracking().Include(p => p.Attachments)
                .FirstOrDefaultAsync(p => p.Id == pid && p.BrandId == brandId);
            if (pauta is null) return NotFound("Pauta não encontrada.");
        }
        else if (string.IsNullOrWhiteSpace(theme))
        {
            return Problem("Informe uma pauta ou um tema.", statusCode: 400);
        }

        // Caminho PAUTA: id = pauta.Id (byte-equivalente ao payload da geração). Caminho TEMA:
        // placeholder fixo "preview" (sem pauta persistida) — reproduzível para o teste de contrato.
        var pautaIdStr = pauta?.Id.ToString() ?? "preview";
        var agentReq = await BuildAgentRequestAsync(pauta, theme, format, brandId, pautaIdStr);
        return Ok(agentReq);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ContentDto>> Get(Guid id)
    {
        // E1: restringe à marca atual (além do workspace) — conteúdo de outra marca → 404.
        var brandId = await brands.ResolveAsync();
        var c = await db.Contents.AsNoTracking().Include(x => x.Slides)
            .FirstOrDefaultAsync(x => x.Id == id && x.BrandId == brandId);
        return c is null ? NotFound() : Ok(ToDto(c));
    }

    // A2/A3 (ADR-0009): body opcional da regeneração. instruction = instrução livre do usuário;
    // slideIndex = "refaz priorizando o slide N" (regen do conteúdo INTEIRO com instrução dirigida —
    // NÃO regen isolada in-place; ver D2, honestidade sobre o limite).
    public record RegenerateRequest(string? Instruction = null, int? SlideIndex = null);

    // ── E11.1 + A2/A3 (ADR-0009): Regenerar (nova geração da MESMA pauta; novo Content) ──
    [HttpPost("{id:guid}/regenerate")]
    public async Task<ActionResult<GenerateAsyncResponse>> Regenerate(Guid id, [FromBody] RegenerateRequest? body = null)
    {
        var brandId = await brands.ResolveAsync();
        var origem = await db.Contents.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id && c.BrandId == brandId);
        if (origem is null) return NotFound();
        if (origem.PautaId is not { } pautaId)
            return Problem("Este conteúdo não tem pauta associada — não há o que regenerar.", statusCode: 400);

        var pauta = await db.Pautas.Include(p => p.Attachments)
            .FirstOrDefaultAsync(p => p.Id == pautaId && p.BrandId == brandId);
        if (pauta is null) return NotFound();

        // C4: concorrência da mesma pauta em Generating → 409 (reusa a regra do generate/async).
        var jaGerando = await db.Contents.AnyAsync(c => c.PautaId == pautaId && c.Status == ContentStatus.Generating);
        if (jaGerando) return Problem("Esta pauta já está gerando conteúdo.", statusCode: 409);

        // A2/A3: monta a instrução efetiva (instrução livre + frase de slide dirigido, se houver).
        var instrucao = MontarInstrucaoRegeneracao(body?.Instruction, body?.SlideIndex);
        var agentReq = await BuildAgentRequestAsync(pauta, null, origem.Type, brandId, pauta.Id.ToString(), instrucao);
        var jobId = await agents.StartAsync(agentReq, HttpContext.RequestAborted);
        var content = new Domain.Content
        {
            WorkspaceId = Ws, BrandId = brandId, PautaId = pautaId,
            Type = origem.Type, Status = ContentStatus.Generating, JobId = jobId,
        };
        db.Contents.Add(content);
        pauta.Status = PautaStatus.InProgress; // reusa a transição existente (volta a Done ao concluir)
        await db.SaveChangesAsync();
        return Ok(new GenerateAsyncResponse(content.Id, jobId));
    }

    /// <summary>
    /// A3/D2 (ADR-0009): combina a instrução livre com a frase de slide dirigido. slideIndex é
    /// 0-based no contrato; a frase usa N+1 (1-based, como o usuário enxerga). null/vazio → null.
    /// NÃO promete regen isolada in-place (seria mentira — o pipeline roda o carrossel inteiro).
    /// </summary>
    private static string? MontarInstrucaoRegeneracao(string? instruction, int? slideIndex)
    {
        var partes = new List<string>();
        if (!string.IsNullOrWhiteSpace(instruction)) partes.Add(instruction.Trim());
        if (slideIndex is { } idx && idx >= 0)
            partes.Add($"Refaça apenas o slide {idx + 1}, preservando os demais.");
        return partes.Count > 0 ? string.Join(" ", partes) : null;
    }

    // ── B2 (ADR-0009): estimativa de custo ANTES de gerar (tabela por formato, fail-safe) ──
    public record EstimateDto(decimal UnitCostUsd, int Count, decimal TotalCostUsd, string Currency, bool IsEstimate);

    [HttpGet("estimate")]
    public ActionResult<EstimateDto> Estimate([FromQuery] ContentType format, [FromQuery] int count = 1)
    {
        // count clampado a [1, MaxVariations]; custo unitário com fail-safe não-zero (B2).
        var clamped = costs.ClampCount(count);
        var unit = costs.UnitCostUsd(format);
        return Ok(new EstimateDto(unit, clamped, unit * clamped, "USD", true));
    }

    // ── B3 (ADR-0009): gerar N variações com TETO (count + saldo) e confirmação ──
    public record VariationsRequest(Guid PautaId, ContentType Format, int Count, bool Confirm);

    [HttpPost("variations")]
    public async Task<ActionResult<IEnumerable<GenerateAsyncResponse>>> Variations(VariationsRequest req)
    {
        var brandId = await brands.ResolveAsync();

        // Gate 1 (B3): confirmação obrigatória.
        if (!req.Confirm) return Problem("Confirmação obrigatória para gerar variações.", statusCode: 400);
        // Gate 2 (B3): count dentro do teto (não clampa silenciosamente — recusa explícita).
        if (req.Count < 1 || req.Count > costs.MaxVariations)
            return Problem($"Quantidade inválida: informe de 1 a {costs.MaxVariations} variações.", statusCode: 400);

        var pauta = await db.Pautas.Include(p => p.Attachments)
            .FirstOrDefaultAsync(p => p.Id == req.PautaId && p.BrandId == brandId);
        if (pauta is null) return NotFound("Pauta não encontrada.");

        // Gate 3 (B3): saldo. totalCost (B2, fail-safe) <= remainingUsd (B1) — senão 402.
        var total = costs.TotalCostUsd(req.Format, req.Count);
        var saldo = await SaldoRestanteDoMesAsync();
        if (total > saldo)
            return Problem($"Saldo insuficiente: custo estimado {total:0.00} USD excede o restante {saldo:0.00} USD.", statusCode: 402);

        // Dispara N jobs (mesma pauta). Cada conclusão grava 1 SpendEntry (B4, dedupe por ContentId+Reason).
        var results = new List<GenerateAsyncResponse>(req.Count);
        for (var i = 0; i < req.Count; i++)
        {
            var agentReq = await BuildAgentRequestAsync(pauta, null, req.Format, brandId, pauta.Id.ToString());
            var jobId = await agents.StartAsync(agentReq, HttpContext.RequestAborted);
            var content = new Domain.Content
            {
                WorkspaceId = Ws, BrandId = brandId, PautaId = pauta.Id,
                Type = req.Format, Status = ContentStatus.Generating, JobId = jobId,
            };
            db.Contents.Add(content);
            await db.SaveChangesAsync();
            results.Add(new GenerateAsyncResponse(content.Id, jobId));
        }
        pauta.Status = PautaStatus.InProgress;
        await db.SaveChangesAsync();
        return Ok(results);
    }

    /// <summary>B1/B3: saldo restante do mês corrente (cap - gasto do mês). Sem Budget → 0 (não 500).
    /// Soma em memória (GOTCHA: SQLite não agrega decimal sob filtro de tenant no SQL).</summary>
    private async Task<decimal> SaldoRestanteDoMesAsync()
    {
        var budget = await db.Budgets.AsNoTracking().FirstOrDefaultAsync(b => b.WorkspaceId == Ws);
        var cap = budget?.MonthlyCapUsd ?? 0m;
        var now = DateTimeOffset.UtcNow;
        var inicioMes = new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, TimeSpan.Zero);
        // GOTCHA 4: SQLite não traduz comparação de DateTimeOffset sob o filtro global de tenant —
        // materializa (valor + data) e filtra/soma em memória (mesmo padrão de PerformanceAnalyzer/
        // NotificationsController). Postgres traduziria; mantemos um único caminho portável.
        var entries = await db.SpendEntries.AsNoTracking()
            .Select(s => new { s.AmountUsd, s.OccurredAt })
            .ToListAsync();
        var gasto = entries.Where(s => s.OccurredAt >= inicioMes).Sum(s => s.AmountUsd);
        var restante = cap - gasto;
        return restante > 0m ? restante : 0m;
    }

    // ── A6 (ADR-0009): "testar marca" — gera 1 exemplo (single-post) sem pauta real ──
    // Rota ABSOLUTA (/api/brand/...) por aderência ao ADR; reusa a maquinaria do ContentController
    // (BuildAgentRequestAsync) em vez de duplicá-la no BrandController. O Content nasce IsSample=true
    // → não aparece em GET /api/content. Sem chave de IA → o job falha com a msg clara (degradado honesto).
    [HttpPost("/api/brand/test-sample")]
    public async Task<ActionResult<GenerateAsyncResponse>> TestSample()
    {
        var brandId = await brands.ResolveAsync();
        // Tema sintético — sem pauta persistida; pautaId placeholder "sample".
        const string tema = "Exemplo de demonstração da identidade da marca";
        var agentReq = await BuildAgentRequestAsync(null, tema, ContentType.Post, brandId, "sample");
        var jobId = await agents.StartAsync(agentReq, HttpContext.RequestAborted);
        var content = new Domain.Content
        {
            WorkspaceId = Ws, BrandId = brandId, PautaId = null,
            Type = ContentType.Post, Status = ContentStatus.Generating, JobId = jobId,
            IsSample = true, // A6: fora da listagem normal
        };
        db.Contents.Add(content);
        await db.SaveChangesAsync();
        return Ok(new GenerateAsyncResponse(content.Id, jobId));
    }

    // ── A5 (ADR-0009): escolher uma variação (promove a escolhida, arquiva as irmãs) ──
    [HttpPost("{id:guid}/choose")]
    public async Task<IActionResult> Choose(Guid id)
    {
        var brandId = await brands.ResolveAsync();
        var escolhida = await db.Contents
            .Include(c => c.Campaign)
            .FirstOrDefaultAsync(c => c.Id == id && c.BrandId == brandId);
        if (escolhida is null) return NotFound();

        // Idempotência (A5): se já está Approved (escolha em modo Automatic já efetivada) → no-op 204.
        // Estados que NÃO podem ser escolhidos (já saíram do funil de decisão) → 409.
        if (escolhida.Status == ContentStatus.Approved) return NoContent();
        if (escolhida.Status is not (ContentStatus.Draft or ContentStatus.PendingApproval))
            return Problem($"Conteúdo em '{escolhida.Status}' não pode ser escolhido (só rascunho/aguardando aprovação).", statusCode: 409);

        // QA race (CHOOSE-duplo): se uma IRMÃ da mesma pauta JÁ está MID-FUNNEL desta decisão
        // (Approved ou Scheduled) — ex.: o operador escolheu outra variação numa 2ª aba —, recusar com
        // 409 em vez de promover uma 2ª vencedora ativa (2 posts quase-idênticos rumo ao IG). Escopo
        // PRECISO: só Approved/Scheduled (a decisão corrente, ainda não terminal). NÃO inclui
        // Published/EphemeralPublished — esses são RODADAS ANTERIORES já encerradas; escolher uma nova
        // variação após uma publicação passada é legítimo (não regride o fluxo A5 existente). Fecha a
        // janela SEQUENCIAL (caso dominante: cliques não-simultâneos / 2 abas). A janela verdadeiramente
        // CONCORRENTE (ambos leem antes de qualquer commit) só fecha com índice único filtrado por
        // pauta — escalado como proposta [NÚCLEO] (migration), não decidida aqui.
        if (escolhida.PautaId is { } pidGuard)
        {
            var irmaNoFunil = await db.Contents.AnyAsync(c =>
                c.PautaId == pidGuard && c.BrandId == brandId && c.Id != escolhida.Id
                && (c.Status == ContentStatus.Approved || c.Status == ContentStatus.Scheduled));
            if (irmaNoFunil)
                return Problem(
                    "Outra variação desta pauta já foi escolhida e está em aprovação/agenda. Atualize a "
                    + "comparação para ver o estado atual.", statusCode: 409);
        }

        var ws = await db.Workspaces.FirstAsync(w => w.Id == Ws);
        var modo = SocialAi.Api.Features.Approval.ApprovalController.ResolveMode(escolhida, escolhida.Campaign, ws);
        // A escolhida: Approved se o modo efetivo é Automatic, senão PendingApproval (F4/C1: validado).
        escolhida.TransitionTo(modo == ApprovalMode.Automatic ? ContentStatus.Approved : ContentStatus.PendingApproval);

        // Todas as DEMAIS variações da MESMA pauta em estado decidível → Rejected (arquiva).
        // Já Published/Scheduled/Failed/Generating são IGNORADAS (não regridem). Sem pauta → não há irmãs.
        if (escolhida.PautaId is { } pid)
        {
            var irmas = await db.Contents
                .Where(c => c.PautaId == pid && c.BrandId == brandId && c.Id != escolhida.Id
                            && (c.Status == ContentStatus.Draft || c.Status == ContentStatus.PendingApproval))
                .ToListAsync();
            foreach (var irma in irmas)
            {
                irma.TransitionTo(ContentStatus.Rejected); // F4/C1: Draft/PendingApproval → Rejected (arquiva irmãs)
                var ap = await db.Approvals.FirstOrDefaultAsync(a => a.ContentId == irma.Id);
                if (ap is null)
                {
                    ap = new Domain.Approval { WorkspaceId = Ws, ContentId = irma.Id };
                    db.Approvals.Add(ap);
                }
                ap.Approved = false;
                ap.Comments = "Não escolhida na comparação";
                ap.DecidedAt = DateTimeOffset.UtcNow;
            }
        }

        await db.SaveChangesAsync();
        return NoContent();
    }

    // ── E11.3: Editar o texto gerado (Copy por slide + caption/cta/hashtags) ──────
    [HttpPut("{id:guid}/slides")]
    public async Task<IActionResult> UpdateText(Guid id, ContentTextUpdate body)
    {
        var brandId = await brands.ResolveAsync();
        var c = await db.Contents.Include(x => x.Slides).FirstOrDefaultAsync(x => x.Id == id && x.BrandId == brandId);
        if (c is null) return NotFound();
        // Conjunto-permitido EXPLÍCITO (ADR-0006 D2): só Draft/PendingApproval; resto → 409.
        if (c.Status is not (ContentStatus.Draft or ContentStatus.PendingApproval))
            return Problem($"Conteúdo em '{c.Status}' não pode ser editado (só rascunho ou aguardando aprovação).", statusCode: 409);

        c.Caption = body.Caption;
        c.Cta = body.Cta;
        c.Hashtags = body.Hashtags;
        foreach (var edit in body.Slides ?? [])
        {
            var slide = c.Slides.FirstOrDefault(s => s.Index == edit.Index);
            if (slide is null) continue;
            slide.Copy = edit.Copy;
            // F3 (ADR-0014): persiste as camadas editadas (JSON opaco) quando o editor visual as envia.
            // Ausente (editor só-texto) → preserva o LayersJson atual (não apaga a composição da geração).
            if (edit.Layers is not { } el) continue;
            slide.LayersJson = el.GetRawText();

            // F3 (ADR-0014 §4e): rasteriza a composição editada → PNG → ImageUrl, p/ o publish postar
            // o slide COMPOSTO (não só o fundo) e o preview==publicado. Falha (fonte/agents) → mantém
            // o ImageUrl atual (degradado honesto): a edição é salva de qualquer forma. Síncrono (~1s/slide).
            var node = System.Text.Json.Nodes.JsonNode.Parse(el.GetRawText());
            if (node is not null)
            {
                // A imagem ATUAL vira o fundo do rasterize. Se for ref minio:, resolve p/ presigned
                // (o agents baixa por URL); senão passa o valor atual (base64/http legado).
                var current = imageStore is not null && MinioImageStore.IsRef(slide.ImageUrl)
                    ? await imageStore.PresignAsync(MinioImageStore.KeyOf(slide.ImageUrl)!, HttpContext.RequestAborted)
                    : slide.ImageUrl;
                var png = await agents.RasterizeAsync(node, current, HttpContext.RequestAborted);
                if (!string.IsNullOrEmpty(png))
                    // Imagem de slide (MinIO): re-materializa a composição editada (ref estável), não 10MB
                    // de base64 de volta na coluna. Sem store (degradado) → mantém base64.
                    slide.ImageUrl = imageStore is null
                        ? png
                        : await imageStore.StoreAsync(png, $"{c.WorkspaceId}/{c.Id}/{slide.Index}", HttpContext.RequestAborted);
            }
        }
        await db.SaveChangesAsync();
        return NoContent();
    }

    // ── A3 (ADR-0010): conta-alvo (override por pauta/conteúdo) ───────────────────
    public record SetTargetAccountRequest(Guid? TargetInstagramAccountId);

    /// <summary>
    /// A3: define (ou limpa) a conta IG-alvo do conteúdo. null = volta ao default (principal da
    /// marca → 1ª conectada, resolvido no worker). Uma conta de OUTRA marca é rejeitada aqui (400),
    /// antes de chegar ao worker — o override nunca cruza marca. Brand-scoped: conteúdo de outra
    /// marca → 404.
    /// </summary>
    [HttpPut("{id:guid}/target-account")]
    public async Task<IActionResult> SetTargetAccount(Guid id, SetTargetAccountRequest body)
    {
        var brandId = await brands.ResolveAsync();
        var content = await db.Contents.FirstOrDefaultAsync(c => c.Id == id && c.BrandId == brandId);
        if (content is null) return NotFound();

        if (body.TargetInstagramAccountId is { } accountId)
        {
            // A conta-alvo TEM de pertencer à mesma marca do conteúdo — senão publicaria por conta
            // alheia. Filtro global (workspace) + predicado de marca garantem o isolamento.
            var pertence = await db.InstagramAccounts
                .AnyAsync(a => a.Id == accountId && a.BrandId == brandId);
            if (!pertence)
                return Problem("A conta-alvo não pertence a esta marca.", statusCode: 400);
        }

        content.TargetInstagramAccountId = body.TargetInstagramAccountId;
        await db.SaveChangesAsync();
        return NoContent();
    }

    // ── E11.5: Exportar (ZIP: imagens JPEG + legenda.txt) ─────────────────────────
    [HttpGet("{id:guid}/export.zip")]
    public async Task<IActionResult> Export(Guid id)
    {
        var brandId = await brands.ResolveAsync();
        var c = await db.Contents.AsNoTracking().Include(x => x.Slides)
            .FirstOrDefaultAsync(x => x.Id == id && x.BrandId == brandId);
        if (c is null) return NotFound();

        // Imagem de slide (MinIO): resolve refs minio: → presigned (quando há store). Sem store → null (degradado).
        Func<string, CancellationToken, Task<string>>? resolve =
            imageStore is null ? null : (key, c2) => imageStore.PresignAsync(key, c2);
        var bytes = await ContentExporter.BuildZipAsync(c, resolve, HttpContext.RequestAborted);
        return File(bytes, "application/zip", $"conteudo-{id}.zip");
    }

    /// <summary>Normaliza o handle do IG para exibição: garante o "@" inicial; null se vazio.</summary>
    private static string? NormalizeHandle(string? username)
    {
        if (string.IsNullOrWhiteSpace(username)) return null;
        var u = username.Trim();
        return u.StartsWith('@') ? u : $"@{u}";
    }

    /// <summary>Monta a identidade visual (E2) a partir do BrandKit. Retorna null se o kit
    /// não tem NENHUM campo visual — assim o adapter cai 100% no preset/default (sem objeto vazio).</summary>
    private static AgentsVisualIdentity? BuildVisualIdentity(Domain.BrandKit? kit)
    {
        if (kit is null) return null;
        var hasColor = kit.PrimaryColorHex is not null || kit.SecondaryColorHex is not null
            || kit.AccentColorHex is not null || kit.BackgroundColorHex is not null || kit.TextColorHex is not null;
        var hasAny = hasColor || kit.VisualPreset is not null || kit.HeadingFont is not null
            || kit.BodyFont is not null || kit.LogoUrl is not null;
        if (!hasAny) return null;
        var colors = hasColor
            ? new AgentsBrandColors(kit.PrimaryColorHex, kit.SecondaryColorHex, kit.AccentColorHex,
                kit.BackgroundColorHex, kit.TextColorHex)
            : null;
        return new AgentsVisualIdentity(kit.VisualPreset, colors, kit.HeadingFont, kit.BodyFont, kit.LogoUrl);
    }

    /// <summary>Desserializa CopyExamples (JSON array de string) p/ a engine. Tolerante:
    /// nulo/vazio/JSON inválido → null (o adapter trata como []).</summary>
    private static IEnumerable<string>? ParseCopyExamples(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var list = System.Text.Json.JsonSerializer.Deserialize<List<string>>(json);
            return list is { Count: > 0 } ? list : null;
        }
        catch (System.Text.Json.JsonException)
        {
            return null; // JSON malformado — degrada p/ sem exemplos, nunca quebra a geração.
        }
    }

    // Instância (não-static): usa o imageStore opcional p/ reescrever as referências minio: dos slides
    // → URL leve do proxy. Sem store (degradado) ou geração antiga (base64/http) → ImageUrl verbatim.
    private ContentDto ToDto(Domain.Content c)
    {
        // G4: o envelope ReasoningJson carrega raciocínio E `alternatives` (chave-irmã). Separa os dois
        // p/ campos distintos no DTO: o raciocínio SEM `alternatives` (painel limpo) + Alternatives próprio.
        var (reasoning, alternatives) = SplitReasoningEnvelope(c.ReasoningJson);
        // Imagem de slide (MinIO): o token da sessão atual vai na query da URL do proxy (o browser carrega <img>/CSS
        // sem header Authorization). Mesmo token, escopo mínimo (só a rota /image o aceita na query).
        var token = imageStore is null ? null : BearerOf(HttpContext);
        return new(
            c.Id, c.PautaId, c.Type, c.Status, c.Caption, c.Cta, c.Hashtags,
            c.Slides.OrderBy(s => s.Index).Select(s => new ContentSlideDto(
                // FASE 1 (ADR-0014): reemite LayersJson como JSON cru (JsonElement), não string escapada.
                // Imagem de slide (MinIO): minio:{key} → URL do proxy (JSON leve); legado base64/http passa verbatim.
                s.Index, s.Copy,
                imageStore is null ? s.ImageUrl : imageStore.ToProxyUrl(c.Id, s.Index, s.ImageUrl, token),
                // Imagem de slide (MinIO) — duplicata no layer: a imagem DUPLICADA dentro do LayersJson (background.value /
                // elements[].content) vira a MESMA URL do proxy — corta o último blob base64 do DTO.
                imageStore is null
                    ? ParseLayers(s.LayersJson)
                    : MinioImageStore.RewriteLayersImages(ParseLayers(s.LayersJson), imageStore.ProxyUrlOf(c.Id, s.Index, token)))),
            c.QualityScore, c.TargetInstagramAccountId, c.TemplateName,
            reasoning, alternatives);
    }

    /// <summary>Extrai o token Bearer do request atual (header Authorization) p/ reanexá-lo na query da
    /// URL do proxy de imagem. Null se ausente/malformado (URL sai sem token — degradado).</summary>
    private static string? BearerOf(HttpContext? http)
    {
        var auth = http?.Request.Headers.Authorization.ToString();
        return !string.IsNullOrEmpty(auth) && auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
            ? auth["Bearer ".Length..].Trim()
            : null;
    }

    /// <summary>
    /// G4: separa o envelope ReasoningJson em (raciocínio-sem-alternatives, alternatives). Defensivo:
    /// null/malformado → (null, null). Geração antiga (envelope só com raciocínio, sem a chave) →
    /// (raciocínio, null). A chave `alternatives` é REMOVIDA do objeto de raciocínio devolvido — assim
    /// o painel "Raciocínio da IA" da web nunca a vê (separação de responsabilidades no contrato).
    /// </summary>
    private static (System.Text.Json.JsonElement? Reasoning, ContentAlternativesDto? Alternatives)
        SplitReasoningEnvelope(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return (null, null);
        try
        {
            var node = System.Text.Json.Nodes.JsonNode.Parse(json)?.AsObject();
            if (node is null) return (ParseJson(json), null);

            ContentAlternativesDto? alternatives = null;
            if (node["alternatives"] is System.Text.Json.Nodes.JsonObject alt)
            {
                var headlines = ReadStringArray(alt["headlines"]);
                var ctas = ReadStringArray(alt["ctas"]);
                // Só expõe a faixa quando há ao menos uma opção real (espelha o filtro do agents).
                if (headlines.Count > 0 || ctas.Count > 0)
                    alternatives = new ContentAlternativesDto(headlines, ctas);
            }
            // Remove a chave-irmã do raciocínio (painel limpo). Se sobrar objeto vazio → null.
            node.Remove("alternatives");
            System.Text.Json.JsonElement? reasoning = node.Count > 0
                ? System.Text.Json.JsonSerializer.SerializeToElement(node)
                : null;
            return (reasoning, alternatives);
        }
        catch (System.Text.Json.JsonException)
        {
            return (null, null); // envelope malformado → omite os dois painéis, nunca quebra o GET.
        }
    }

    /// <summary>
    /// Lê um JsonNode array de strings → List&lt;string&gt; tolerante. Itens não-string (número, bool,
    /// objeto, null) são IGNORADOS — nunca lançam. ⚠️ Cuidado: `GetValue&lt;string&gt;()`
    /// sobre um número/bool/objeto lança InvalidOperationException (NÃO JsonException), que escaparia do
    /// catch do SplitReasoningEnvelope → GET 500. O caminho worker grava o JSON CRU dos agents (sem tipo
    /// forte no fio), então um `headlines:[null,123]` é alcançável. `TryGetValue` é a leitura segura.
    /// </summary>
    private static List<string> ReadStringArray(System.Text.Json.Nodes.JsonNode? node)
    {
        var list = new List<string>();
        if (node is System.Text.Json.Nodes.JsonArray arr)
            foreach (var item in arr)
            {
                if (item is System.Text.Json.Nodes.JsonValue v
                    && v.TryGetValue<string>(out var s)
                    && !string.IsNullOrWhiteSpace(s))
                    list.Add(s);
            }
        return list;
    }

    /// <summary>
    /// FASE 1 (ADR-0014): desserializa o LayersJson (JSON opaco persistido) p/ JsonElement, devolvido
    /// verbatim no DTO. JSON malformado/null → null (degrada p/ preview só-imagem, nunca quebra o GET).
    /// Espelha o padrão defensivo de ParseCopyExamples (JsonException → null).
    /// </summary>
    private static System.Text.Json.JsonElement? ParseLayers(string? layersJson) => ParseJson(layersJson);

    /// <summary>Parser defensivo de JSON-string opaco → JsonElement? (reusado por Layers e Reasoning).
    /// null/vazio/malformado → null (nunca quebra o GET).</summary>
    private static System.Text.Json.JsonElement? ParseJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            // Clona p/ desacoplar o JsonElement do JsonDocument (que seria descartado pelo using).
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            return doc.RootElement.Clone();
        }
        catch (System.Text.Json.JsonException)
        {
            return null;
        }
    }
}
