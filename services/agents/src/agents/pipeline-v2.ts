/**
 * Pipeline Orchestrator v2.0
 * Social AI Platform — portado do branding-os.
 *
 * Orquestra a execução de todos os 6 agentes em sequência.
 * Cada agente recebe o output dos anteriores, criando SINERGIA total.
 */

import type { AiConfig } from '@/config'
import { aiToGeminiConfig } from '@/config'
import { getGeminiClient } from '@/services/gemini'
import type { GeminiAPIClient } from '@/services/gemini'
import type {
  PipelineInput,
  PipelineResult,
  StrategyBlueprint,
  StoryStructure,
  CreativeDirection,
  ImageStrategy,
  CopyOutput,
  VisualSpecification,
  QualityReport,
  RenderOutput,
} from '@/types/pipeline'
import { BrandStrategistAgent } from './brand-strategist'
import { StoryArchitectAgent } from './story-architect'
import { CopywriterAgentV2 } from './copywriter'
import { VisualCompositorAgent } from './visual-compositor'
import { QualityValidatorAgent } from './quality-validator'
import { renderEngine, RenderEngine } from './render-engine'
import { compileBrandDesignSpec, applySpecPaletteToTokens, type BrandDesignSpec } from '../brand/design-spec.js'
import { decideCreativeDirection, strategyServedBy, alternativeStrategy } from './creative-director.js'
import { getTemplateById } from '../templates/index.js'
import type { PromptAgentKey } from '@/prompts/loader'

// ============================================
// PIPELINE CALLBACKS
// ============================================

export type PipelineAgentId =
  | 'brand-strategist'
  | 'story-architect'
  | 'creative-director'
  | 'copywriter'
  | 'visual-compositor'
  | 'image-generator'
  | 'quality-validator'
  | 'render-engine'

export interface PipelineV2Callbacks {
  onAgentStart: (agentId: PipelineAgentId) => void
  onAgentComplete: (agentId: PipelineAgentId, output: unknown, duration: number) => void
  onAgentError: (agentId: PipelineAgentId, error: Error) => void
  onProgress: (progress: number, message: string) => void
  // ADR-0011/E10.2/D4: um override de prompt foi REJEITADO e o agente caiu no base. Não-silencioso
  // (DEC-5 em espírito): a observabilidade/UI sabe que o prompt customizado falhou. Opcional.
  onPromptFallback?: (agentKey: PromptAgentKey, reason: string) => void
}

// ============================================
// PIPELINE ORCHESTRATOR
// ============================================

import { ImageGeneratorAgent } from './image-generator'

export class PipelineOrchestratorV2 {
  private callbacks: PipelineV2Callbacks
  private aborted: boolean = false

  // Agent instances
  private brandStrategist: BrandStrategistAgent
  private storyArchitect: StoryArchitectAgent
  private copywriter: CopywriterAgentV2
  private visualCompositor: VisualCompositorAgent
  private imageGenerator: ImageGeneratorAgent
  private qualityValidator: QualityValidatorAgent
  private renderer: RenderEngine

  // C (ADR-0008): referência ao MESMO client Gemini que os agentes usam (cache por config
  // efetiva — todos os agentes deste job compartilham a instância). Lemos o uso acumulado
  // dele ao fim p/ preencher result.usage. Resolvido aqui via aiToGeminiConfig(ai), idêntico
  // ao que cada agente/factory faz internamente — logo, a MESMA instância cacheada.
  private geminiClient: GeminiAPIClient

  // task 1.2: estratégia visual que o provider de imagem do job atende (flux/gemini/openai →
  // generative-photo; stock → stock-photo). O Creative Director usa isto p/ marcar deferred por slide.
  private servedStrategy: ImageStrategy

  // A AiConfig efetiva (Z/ADR-0008) é o objeto rico que percorre toda a cadeia:
  // orquestrador → cada agente → factories. Substitui o antigo GeminiAPIConfig nesta
  // assinatura; o client concreto é derivado dela dentro de cada agente.
  constructor(ai: AiConfig, callbacks: PipelineV2Callbacks) {
    this.callbacks = callbacks
    // Resolve o client compartilhado e zera o acumulador de uso deste job (não soma entre
    // gerações — o cache é por config, mas a instância é reusada entre jobs com a mesma config).
    this.geminiClient = getGeminiClient(aiToGeminiConfig(ai))
    this.geminiClient.resetUsage()
    this.servedStrategy = strategyServedBy(ai.imageProvider)

    // Initialize agents
    this.brandStrategist = new BrandStrategistAgent(ai)
    this.storyArchitect = new StoryArchitectAgent(ai)
    this.copywriter = new CopywriterAgentV2(ai)
    this.visualCompositor = new VisualCompositorAgent(ai)
    this.imageGenerator = new ImageGeneratorAgent(ai)
    this.qualityValidator = new QualityValidatorAgent(ai)
    this.renderer = renderEngine
  }

  abort(): void {
    this.aborted = true
  }

  /**
   * task 1.4 — funde os checks do EIXO VISUAL no QualityReport e recalcula passed/summary. Mantém a
   * regra de aprovação existente (sem críticos, sem erros, score ≥ 70): um erro visual (imagem em
   * fallback após o retro-teto) DERRUBA `passed` — o conteúdo não é auto-aprovável com foto degradada.
   * O `score` numérico é preservado (o eixo visual é gate booleano, não re-pontua a nota qualitativa).
   * Puro sobre cópias; não muta o report de entrada.
   */
  private mergeVisualIntoQuality(report: QualityReport, visualChecks: QualityReport['checks']): QualityReport {
    const checks = [...report.checks, ...visualChecks]
    const visualErrors = visualChecks.filter((c) => (c.severity === 'error' || c.severity === 'critical') && !c.passed)
    const errors = report.summary.errors + visualChecks.filter((c) => c.severity === 'error' && !c.passed).length
    const criticalIssues = report.summary.criticalIssues + visualChecks.filter((c) => c.severity === 'critical' && !c.passed).length
    const warnings = report.summary.warnings + visualChecks.filter((c) => c.severity === 'warning' && !c.passed).length
    const passed = report.passed && visualErrors.length === 0
    return {
      ...report,
      passed,
      checks,
      summary: {
        totalChecks: checks.length,
        passedChecks: checks.filter((c) => c.passed).length,
        warnings,
        errors,
        criticalIssues,
      },
      requiredFixes: visualErrors.length > 0
        ? [
            ...(report.requiredFixes ?? []),
            ...visualErrors.map((c) => ({
              slideIndex: Number.parseInt(c.rule.match(/slide-(\d+)/)?.[1] ?? '0', 10),
              element: c.rule,
              issue: c.details,
              suggestion: 'Imagem em fallback após retry de estratégia — verificar provider/chave de imagem.',
            })),
          ]
        : report.requiredFixes,
    }
  }

  async execute(inputArg: PipelineInput): Promise<PipelineResult> {
    const startTime = Date.now()
    const agentDurations: Record<string, number> = {}

    // ADR-0011/E10.2: faz o BRIDGE do sink de fallback de prompt para o callback do pipeline.
    // O sink viaja no input (por run) até cada agente, sem acoplar BaseAgent ao orquestrador.
    // Cópia rasa: não mutamos o objeto do chamador. Se já houver um sink no input, preserva-se.
    const input: PipelineInput = this.callbacks.onPromptFallback
      ? { ...inputArg, onPromptFallback: inputArg.onPromptFallback ?? this.callbacks.onPromptFallback }
      : inputArg

    this.aborted = false

    // Initialize result structure
    let strategy: StrategyBlueprint | null = null
    let story: StoryStructure | null = null
    let creativeDirection: CreativeDirection | null = null
    let copy: CopyOutput | null = null
    let visual: VisualSpecification | null = null
    let quality: QualityReport | null = null
    let render: RenderOutput | null = null

    try {
      // ============================================
      // AGENT 1: BRAND STRATEGIST (0-15%)
      // ============================================
      if (this.aborted) throw new Error('Pipeline aborted')

      this.callbacks.onAgentStart('brand-strategist')
      this.callbacks.onProgress(5, 'Analyzing brief and selecting strategy...')

      const strategistStart = Date.now()
      strategy = await this.brandStrategist.execute({ pipelineInput: input })
      agentDurations['brand-strategist'] = Date.now() - strategistStart

      this.callbacks.onAgentComplete('brand-strategist', strategy, agentDurations['brand-strategist'])
      this.callbacks.onProgress(15, `Strategy: ${strategy.templateName} with ${strategy.narrativeAngle} angle`)

      // ============================================
      // AGENT 2: STORY ARCHITECT (15-30%)
      // ============================================
      if (this.aborted) throw new Error('Pipeline aborted')

      this.callbacks.onAgentStart('story-architect')
      this.callbacks.onProgress(18, 'Building narrative structure...')

      const storyStart = Date.now()
      story = await this.storyArchitect.execute({
        pipelineInput: input,
        strategy
      })
      agentDurations['story-architect'] = Date.now() - storyStart

      this.callbacks.onAgentComplete('story-architect', story, agentDurations['story-architect'])
      this.callbacks.onProgress(30, `Structure: ${story.totalSlides} slides planned`)

      // ============================================
      // AGENT 2.5: CREATIVE DIRECTOR (30-32%) — Pilar I · task 1.1
      // ============================================
      // Roteamento de estratégia visual por slide (foto generativa / banco / composição gráfica).
      // DETERMINÍSTICO (sem LLM): a regra é uma tabela da auditoria sobre tipo+beat — lookup, não
      // julgamento (L8). Não toca o client, não gasta token, não pode falhar (fail-safe). Decisão
      // auditável no output do job. O image-generator a respeita no que já tem provider (foto
      // generativa hoje); banco/gráfico são roteados e executam via foto até 1.2/1.3 (deferred).
      if (this.aborted) throw new Error('Pipeline aborted')

      this.callbacks.onAgentStart('creative-director')
      const directorStart = Date.now()
      creativeDirection = decideCreativeDirection(story, strategy, this.servedStrategy)
      agentDurations['creative-director'] = Date.now() - directorStart

      this.callbacks.onAgentComplete('creative-director', creativeDirection, agentDurations['creative-director'])
      this.callbacks.onProgress(32, `Creative direction: ${creativeDirection.primaryStrategy}`)

      // ============================================
      // AGENT 3: COPYWRITER (32-50%)
      // ============================================
      if (this.aborted) throw new Error('Pipeline aborted')

      this.callbacks.onAgentStart('copywriter')
      this.callbacks.onProgress(35, 'Writing copy for each slide...')

      const copyStart = Date.now()
      copy = await this.copywriter.execute({
        pipelineInput: input,
        strategy,
        story
      })
      agentDurations['copywriter'] = Date.now() - copyStart

      this.callbacks.onAgentComplete('copywriter', copy, agentDurations['copywriter'])
      this.callbacks.onProgress(50, `Copy: ${copy.slides.length} slides written`)

      // ============================================
      // AGENT 4: VISUAL COMPOSITOR (50-70%)
      // ============================================
      if (this.aborted) throw new Error('Pipeline aborted')

      this.callbacks.onAgentStart('visual-compositor')
      this.callbacks.onProgress(55, 'Creating visual specifications...')

      const visualStart = Date.now()
      visual = await this.visualCompositor.execute({
        pipelineInput: input,
        strategy,
        story,
        copy
      })
      agentDurations['visual-compositor'] = Date.now() - visualStart
      console.log(' [Pipeline] Visual Spec Created:', JSON.stringify(visual, null, 2))

      this.callbacks.onAgentComplete('visual-compositor', visual, agentDurations['visual-compositor'])
      this.callbacks.onProgress(65, `Visual: ${visual.slides.length} slides designed`)

      // ============================================
      // DESIGN COMPILER (ADR-0012): compila o Brand Design Spec canônico UMA vez.
      // Funde a marca (já mesclada em input.brandConfig) + o template escolhido pela estratégia
      // num spec rico do qual derivam render (CSS vars --bd-*) e prompt de imagem (paleta/mood).
      // Função pura, determinística, fail-safe. R3/AC13: sobrescrevemos visual.tokens.colors com
      // a palette do spec p/ que os defaults do visual-compositor (#1A1A1A/#C9B298) não divirjam
      // do spec — uma fonte única de cor a partir daqui.
      // ============================================
      // D4 (ADR-0008): resolve o template escolhido no POOL EFETIVO do job (request curado,
      // se houver) e só então cai no registry built-in — assim o Design Compiler usa o
      // template REALMENTE escolhido, não um homônimo built-in.
      // strategy já foi atribuído (AGENT 1) e o pipeline teria lançado se abortado — non-null aqui.
      const chosenTemplate =
        input.preferences?.availableTemplates?.find((t) => t.id === strategy!.templateId)
        ?? getTemplateById(strategy!.templateId)
        ?? undefined
      const designSpec: BrandDesignSpec = compileBrandDesignSpec(
        input.brandConfig,
        undefined, // presetId: o mood APEX é default honesto; propagar o preset é refinamento futuro
        chosenTemplate,
        // Toggle por-geração: estampar o logo da marca nos slides (default false → render atual).
        input.preferences?.useLogoIdentity,
      )
      // R3/AC13: uma fonte única de cor a partir daqui (sobrescreve os defaults do compositor).
      visual = applySpecPaletteToTokens(visual, designSpec)

      // ============================================
      // AGENTS 4.5 + 5: IMAGE GENERATOR ‖ QUALITY VALIDATOR (70-90%)
      // ============================================
      // Otimização de latência: image-generator (~22s) e quality-validator (~11s) ambos
      // dependem SÓ do visual-compositor — e o validator é TÉCNICO sobre copy+spec (headlines, brand,
      // spacing/visualHarmony da layout), NÃO lê imagem (provado: nenhum imageUrl/background no fonte).
      // Logo são independentes entre si → rodam em PARALELO, tirando o validator (11s) do caminho
      // crítico. O validator recebe o visual PRÉ-imagem (a spec); image-gen produz o visual COM imagem.
      // Ordem serial preservada onde há dependência real (ambos após o compositor; render após ambos).
      if (this.aborted) throw new Error('Pipeline aborted')

      this.callbacks.onAgentStart('image-generator')
      this.callbacks.onProgress(70, 'Generating AI images for slides...')

      const visualSpecForValidation = visual // spec pré-imagem (o que o validator técnico avalia)
      const imageStart = Date.now()
      console.log(' [Pipeline] Starting Image Generation ‖ Quality Validation...')

      const qualityStart = Date.now()
      const [visualWithImages, qualityResult] = await Promise.all([
        // Mutates visual object or returns new one. designSpec injetado (ADR-0012 PR4 o consome).
        // creativeDirection (task 1.1): o image-generator respeita a estratégia por slide.
        this.imageGenerator.execute({ pipelineInput: input, visual, designSpec, creativeDirection }),
        this.qualityValidator.execute({ pipelineInput: input, copy, visual: visualSpecForValidation }),
      ])

      visual = visualWithImages // Update visual with images
      agentDurations['image-generator'] = Date.now() - imageStart
      this.callbacks.onAgentComplete('image-generator', visual, agentDurations['image-generator'])
      this.callbacks.onProgress(80, `Images: AI Assets generated`)

      if (this.aborted) throw new Error('Pipeline aborted')
      quality = qualityResult
      agentDurations['quality-validator'] = Date.now() - qualityStart

      // ============================================
      // EIXO VISUAL + RETRY DE ESTRATÉGIA (task 1.4) — 88-90%
      // ============================================
      // O `execute` do validador roda em PARALELO sobre a spec PRÉ-imagem (otimização preservada),
      // então NÃO vê a imagem. Aqui, com a imagem já gerada, rodamos o EIXO VISUAL determinístico
      // (detecta fallback de gradiente = "não é foto real"). Se algum slide-foto reprova, tentamos a
      // ESTRATÉGIA ALTERNATIVA (stock↔generative) e RE-GERAMOS a imagem — UMA vez só (teto anti-loop).
      // Os checks visuais entram no relatório de qualidade (auditável), independentemente do retry.
      let visualChecks = this.qualityValidator.runVisualChecks(visual, creativeDirection ?? undefined)
      let visualFailed = visualChecks.filter((c) => c.severity === 'error' && !c.passed)
      const MAX_VISUAL_RETRIES = 1 // teto rígido: nunca mais de 1 re-geração (custo/latência controlados)
      for (let attempt = 0; attempt < MAX_VISUAL_RETRIES && visualFailed.length > 0 && creativeDirection; attempt++) {
        // Re-roteia SÓ os slides reprovados para a estratégia alternativa (determinístico, finito).
        const failedIdx = new Set(
          visualFailed.map((c) => Number.parseInt(c.rule.match(/slide-(\d+)/)?.[1] ?? '0', 10)),
        )
        const retried: CreativeDirection = {
          ...creativeDirection,
          perSlide: creativeDirection.perSlide.map((d) => {
            if (!failedIdx.has(d.index)) return d
            const alt = alternativeStrategy(d.strategy)
            if (!alt) return d
            return { ...d, strategy: alt, effectiveStrategy: alt, deferred: false, reason: `retry visual: ${d.strategy} → ${alt}` }
          }),
        }
        this.callbacks.onProgress(85, `Retry visual (${attempt + 1}/${MAX_VISUAL_RETRIES}): mudando estratégia dos slides ${[...failedIdx].join(', ')}`)
        // Re-gera a imagem a partir da spec de layout (visual PRÉ-imagem), com a direção alternativa.
        try {
          visual = await this.imageGenerator.execute({ pipelineInput: input, visual: visualSpecForValidation, designSpec, creativeDirection: retried })
          creativeDirection = retried
          visualChecks = this.qualityValidator.runVisualChecks(visual, retried)
          visualFailed = visualChecks.filter((c) => c.severity === 'error' && !c.passed)
        } catch (retryErr) {
          // O image-gen lança quando o fallback persiste (política de não publicar degradado). Nesse
          // caso o retry não recupera — deixamos o erro propagar (comportamento honesto atual).
          throw retryErr
        }
      }
      // Anexa os checks visuais ao relatório e recalcula passed/summary (o eixo visual pode reprovar).
      quality = this.mergeVisualIntoQuality(quality, visualChecks)

      this.callbacks.onAgentComplete('quality-validator', quality, agentDurations['quality-validator'])
      this.callbacks.onProgress(90, `Quality: ${quality.score}/100`)

      // ============================================
      // AGENT 6: RENDER ENGINE (90-100%)
      // ============================================
      if (this.aborted) throw new Error('Pipeline aborted')

      this.callbacks.onAgentStart('render-engine')
      this.callbacks.onProgress(95, 'Rendering final assets...')

      const renderStart = Date.now()
      // S-12: injeta a assinatura/handle do tenant no visual antes de renderizar.
      // O render engine usa esse campo como cabeçalho de cada slide.
      // String vazia quando não configurado — nunca um handle de terceiro.
      // ADR-0012: o designSpec acompanha o visual no render → os templates resolvem as CSS vars
      // --bd-* p/ as cores/fontes da marca (em vez do fallback Figma).
      const visualWithSignature = { ...visual, signature: input.brandConfig.handle ?? '', designSpec }
      render = this.renderer.render(visualWithSignature)
      agentDurations['render-engine'] = Date.now() - renderStart

      this.callbacks.onAgentComplete('render-engine', render, agentDurations['render-engine'])
      this.callbacks.onProgress(100, 'Generation complete!')

      // ============================================
      // BUILD FINAL RESULT
      // ============================================
      const totalDuration = Date.now() - startTime

      // S-14: success=true significa que o pipeline executou sem exceção — o artefato
      // está disponível. quality.passed=false indica score abaixo do limiar (< 70),
      // mas o conteúdo ainda é entregue; a API/worker decide o que fazer com ele.
      return {
        success: true,
        metadata: {
          pipelineId: crypto.randomUUID(),
          version: '2.0.0',
          generatedAt: new Date(),
          duration: totalDuration,
          agentDurations
        },
        strategy,
        story,
        copy,
        visual,
        quality,
        render,
        // task 1.1: decisão de estratégia visual por slide (auditável). null → omitido (opcional).
        creativeDirection: creativeDirection ?? undefined,
        summary: {
          template: strategy.templateName,
          slideCount: copy.slides.length,
          qualityScore: quality.score,
          mainCTA: copy.microcopy?.ctaButton || 'Saiba Mais'
        },
        // C (ADR-0008): uso acumulado pelo client Gemini durante este job (tokens de texto
        // + nº de imagens reais). Em mock/sem chave, os contadores ficam em 0 (custo 0 na API).
        usage: this.geminiClient.getUsage()
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      // Determine which agent failed
      if (!strategy) {
        this.callbacks.onAgentError('brand-strategist', error as Error)
      } else if (!story) {
        this.callbacks.onAgentError('story-architect', error as Error)
      } else if (!copy) {
        this.callbacks.onAgentError('copywriter', error as Error)
      } else if (!visual) {
        // If it failed here, it might be compositor or generator (if visual was set but generator failed, we need to know)
        // Actually if visual IS set, it means compositor finished.
        // If imageGenerator fails, visual might still be set (from compositor), so we need to check if we are in generator phase?
        // But for simplicity, we can assume if visual is set and we are here, it might be generator or next.
        // Let's rely on the callbacks order.

        // Wait, if ImageGenerator fails, 'visual' is PREVIOUSLY set by Compositor.
        // So checking "else if (!visual)" is tricky. 
        // We need a better error tracking or just assume sequence.

        this.callbacks.onAgentError('visual-compositor', error as Error) // Fallback
      } else if (!quality) {
        // Could be image generator or quality validator
        // We can't distinct easily without state. 
        // But since we are catching error, we can try to guess or just report generic.
        // Let's assume if visual exists but quality doesn't, it MIGHT be image generator.
        this.callbacks.onAgentError('image-generator', error as Error)
      } else {
        this.callbacks.onAgentError('render-engine', error as Error)
      }


      // Return partial result with error
      return {
        success: false,
        error: errorMessage,
        metadata: {
          pipelineId: crypto.randomUUID(),
          version: '2.0.0',
          generatedAt: new Date(),
          duration: Date.now() - startTime,
          agentDurations
        },
        strategy: strategy!,
        story: story!,
        creativeDirection: creativeDirection ?? undefined,
        copy: copy!,
        visual: visual!,
        quality: quality!,
        render: render!,
        summary: {
          template: strategy?.templateName || 'unknown',
          slideCount: copy?.slides.length || 0,
          qualityScore: quality?.score || 0,
          mainCTA: copy?.microcopy?.ctaButton || ''
        }
      }
    }
  }
}

// ============================================
// CONVENIENCE FUNCTION
// ============================================

export async function runPipelineV2(
  ai: AiConfig,
  input: PipelineInput,
  callbacks: PipelineV2Callbacks
): Promise<PipelineResult> {
  const orchestrator = new PipelineOrchestratorV2(ai, callbacks)
  return orchestrator.execute(input)
}
