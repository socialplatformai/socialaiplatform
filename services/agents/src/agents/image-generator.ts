/**
 * Image Generator Agent v2.0
 * Social AI Platform — portado do branding-os.
 *
 * O QUINTO agente do pipeline (agora antes do Quality Validator).
 * Gera imagens reais usando Gemini 3 Pro based no prompt visual.
 */

import type {
    PipelineInput,
    VisualSpecification,
    SlideVisualSpec,
    CreativeDirection,
    SlideCreativeDirection,
} from '@/types/pipeline'
import { BaseAgent } from '../agents/base'
import { getGeminiClient } from '@/services/gemini'
import { resolveImageProvider, type IImageProvider, type ImageOptions } from '../image/imageProvider.js'
import type { AiConfig } from '@/config'
import { aiToGeminiConfig } from '@/config'
import type { BrandDesignSpec } from '../brand/design-spec.js'

interface ImageGeneratorInput {
    pipelineInput: PipelineInput
    visual: VisualSpecification
    // ADR-0012: spec canônico p/ derivar paleta/mood/estética do prompt de imagem (consumido no PR4).
    designSpec?: BrandDesignSpec
    // task 1.1: estratégia visual por slide (Creative Director). Hoje só `generative-photo` tem
    // provider real; estratégias deferidas (stock/gráfico) executam via foto e são LOGADAS como
    // tal (fronteira honesta). Ausente → comportamento atual (tudo foto generativa, sem log de rota).
    creativeDirection?: CreativeDirection
}

/**
 * FASE 1 (ADR-0014): teto de imagens geradas em paralelo. Default 3 (equilíbrio entre velocidade e
 * rate-limit do provider de imagem). Trocável por IMAGE_GEN_CONCURRENCY no .env (config, não código).
 * Clampado a [1, 6] — nunca 0 (travaria) nem absurdo (estoura o rate-limit). Lido por execução.
 */
function imageGenConcurrency(): number {
    const raw = Number.parseInt(process.env.IMAGE_GEN_CONCURRENCY ?? '', 10)
    if (!Number.isFinite(raw) || raw < 1) return 3
    return Math.min(raw, 6)
}

/**
 * Roda `fn` sobre `items` com no máximo `limit` execuções concorrentes (semáforo simples por janela
 * deslizante). Sem dependência externa (KISS) — N pequeno (≤6 slides). Erros propagam (mas aqui o
 * caller embrulha cada item em try/catch no processSlide, então uma falha não derruba o lote).
 */
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0
    const worker = async (): Promise<void> => {
        while (cursor < items.length) {
            const i = cursor++
            await fn(items[i])
        }
    }
    const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
    await Promise.all(workers)
}

/**
 * Converte um gradiente CSS de marca (`linear-gradient(...)`) num
 * data-URI SVG renderizável. Usado como fallback quando a geração de um ELEMENTO de imagem falha:
 * o elemento vira o gradiente iridescente da APEX (mesma intenção do fallback de background), nunca
 * uma URL externa de terceiros (um placeholder que estampava "Image Gen Failed"). O render-engine só trata como
 * imagem válida o que começa com `http`/`data:` — um data-URI satisfaz isso e renderiza no HTML e
 * no rasterizer (Satori aceita <linearGradient>). Sem dependência externa, sempre renderizável.
 *
 * Parseia `linear-gradient(<ângulo>deg, <cor> <pos%>, ...)`. Se o parse falhar (formato inesperado),
 * cai num gradiente APEX fixo de 2 cores — nunca lança, nunca devolve URL externa.
 */
/**
 * Task 1.3 — Contexto da pauta → prompt de imagem (injeção DETERMINÍSTICA, caminho B).
 *
 * O prompt-texto que vai ao provider (`slide.background.value` / `element.content`) é gerado pelo
 * LLM do visual-compositor a partir da copy do slide — o ASSUNTO chega só INDIRETAMENTE e não é
 * garantido. Aqui ancoramos, de forma verificável, o produto/tema/mensagem REAL da pauta ao prompt,
 * análogo a como `options.style` já ancora a estética (cor/mood da marca).
 *
 * Fecha o "nada de imagem genérica": o brand-locking do Flux (1.2) passa a ter *assunto* certo, não
 * só *cor* certa.
 *
 * NÃO-REGRESSÃO (invariante): sem contexto (mock/degradado, ou todos os campos vazios) o prompt fica
 * BYTE-EQUIVALENTE ao atual — a função devolve `basePrompt` intocado. Função PURA, testável.
 */
function buildImagePrompt(basePrompt: string, context?: PipelineInput['context']): string {
    if (!context) return basePrompt
    // Só campos preenchidos entram (trim); vazios são ignorados p/ não injetar ruído nem quebrar
    // a não-regressão. Ordem: assunto (produto) → descrição → benefício-chave (o mais relevante p/
    // a imagem). targetAudience/USP ficam de fora do prompt de imagem (pertencem à copy, não à cena).
    const subject = context.productName?.trim()
    const description = context.productDescription?.trim()
    const benefit = context.keyBenefits?.find((b) => b?.trim())?.trim()
    const parts: string[] = []
    if (subject) parts.push(`Assunto: ${subject}`)
    if (description) parts.push(description)
    if (benefit) parts.push(`Destaque: ${benefit}`)
    if (parts.length === 0) return basePrompt // contexto presente mas todo vazio → não-regressão
    // O prompt-base (cena derivada da copy do slide) vem PRIMEIRO — preserva a composição pensada
    // pelo visual-compositor; o assunto ancora o conteúdo. Separador explícito p/ o provider ler ambos.
    return `${basePrompt}. Contexto da marca — ${parts.join('; ')}.`
}

function gradientCssToSvgDataUri(css: string, width = 800, height = 600): string {
    // Extrai os color stops: "#RRGGBB 12%" (a posição é opcional).
    const stopRe = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s*(\d+(?:\.\d+)?%)?/g
    const stops: Array<{ color: string; offset: string }> = []
    let m: RegExpExecArray | null
    while ((m = stopRe.exec(css)) !== null) {
        stops.push({ color: m[1], offset: m[2] ?? '' })
    }
    // Sem stops reconhecíveis → gradiente APEX fixo (defensivo: nunca quebra).
    const safeStops = stops.length >= 2
        ? stops
        : [{ color: '#C8E0FF', offset: '0%' }, { color: '#FFC6F0', offset: '100%' }]
    // Distribui offsets ausentes uniformemente entre 0% e 100%.
    const n = safeStops.length
    const stopEls = safeStops
        .map((s, i) => {
            const offset = s.offset || `${Math.round((i / (n - 1)) * 100)}%`
            return `<stop offset="${offset}" stop-color="${s.color}"/>`
        })
        .join('')
    // Ângulo do CSS (default 120deg, como o gradiente APEX) traduzido para x1/y1→x2/y2.
    const angleMatch = css.match(/(\d+(?:\.\d+)?)deg/)
    const angle = angleMatch ? Number(angleMatch[1]) : 120
    const rad = ((angle - 90) * Math.PI) / 180
    const x1 = (50 - Math.cos(rad) * 50).toFixed(2)
    const y1 = (50 - Math.sin(rad) * 50).toFixed(2)
    const x2 = (50 + Math.cos(rad) * 50).toFixed(2)
    const y2 = (50 + Math.sin(rad) * 50).toFixed(2)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
        + `<defs><linearGradient id="g" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">${stopEls}</linearGradient></defs>`
        + `<rect width="${width}" height="${height}" fill="url(#g)"/></svg>`
    return `data:image/svg+xml,${encodeURIComponent(svg.trim())}`
}

export class ImageGeneratorAgent extends BaseAgent<ImageGeneratorInput, VisualSpecification> {
    // ADR-0011/E10.2: determinístico (sem LLM de texto) → NÃO participa de override de prompt.
    protected readonly overrideKey = null
    // Este agente é determinístico em texto, mas usa o client concreto p/ gerar
    // IMAGEM (via IImageProvider). O BaseAgent só expõe o provider de texto (E5.1),
    // então guardamos a AiConfig efetiva p/ resolver o provider de imagem localmente.
    private readonly ai: AiConfig

    constructor(ai: AiConfig) {
        super(ai, 'visual-director') // Reusing visual-director role or creating new one? Using base config.
        this.ai = ai
    }

    // This agent doesn't use a standard system/user prompt flow for text generation.
    // Instead, it iterates over slides and calls the image generation endpoint.

    get systemPrompt(): string {
        return ''
    }

    buildUserPrompt(_input: ImageGeneratorInput): string {
        return ''
    }

    async execute(input: ImageGeneratorInput): Promise<VisualSpecification> {
        const { visual, designSpec, creativeDirection } = input
        // task 1.3: contexto da pauta (produto/tema/mensagem) p/ ancorar o ASSUNTO no prompt de imagem
        // de forma determinística. Ausente (mock/degradado) → prompts byte-equivalentes ao atual.
        const context = input.pipelineInput?.context
        // task 1.1: índice slide.index → direção criativa, p/ o gerador RESPEITAR a estratégia por
        // slide (hoje: logar a rota; foto generativa é a única executável). Mapa O(1), fail-safe a vazio.
        const directionByIndex = new Map<number, SlideCreativeDirection>(
            (creativeDirection?.perSlide ?? []).map((d) => [d.index, d]),
        )
        // Provider de imagem escolhido a partir da AiConfig efetiva (ai.imageProvider),
        // não de env (Z/ADR-0008). O client concreto vem do cache por config efetiva.
        const provider = resolveImageProvider(this.ai, getGeminiClient(aiToGeminiConfig(this.ai)))
        const newVisual = JSON.parse(JSON.stringify(visual)) as VisualSpecification

        const slides = newVisual.slides
        const totalSlides = slides.length

        // FASE 1 (ADR-0014 §86, decisão 1): gera imagem para TODOS os slides (era só cover+last).
        // Visual rico de cara — cada slide do carrossel tem fundo, não só o 1º e o último.
        // Em PARALELO com teto de concorrência (rate-limit do provider): corta o wall-clock vs
        // sequencial sem disparar 429. Teto trocável por env (IMAGE_GEN_CONCURRENCY, default 3) —
        // config, não código. processSlide muta cada slide IN-PLACE; como cada objeto é distinto
        // (deep-copy em newVisual), rodar em paralelo é seguro (sem estado compartilhado).
        const concurrency = imageGenConcurrency()
        console.log(`[ImageGenerator] Processing ${totalSlides} slides for images (concurrency=${concurrency})`)

        // Por-slide: true se ALGUMA imagem do slide caiu no fallback (após retry). Indexado por slide.index
        // p/ mensagem clara. Só ESCREVEMOS true no closure (idempotente) → seguro sob concorrência.
        const fallbackSlides: number[] = []
        await mapWithConcurrency(slides, concurrency, async (slide) => {
            console.log(`[ImageGenerator] Generating image for slide ${slide.index} (${slide.layoutId})`)
            // processSlide já re-tenta cada imagem (recupera 429 transitório) e cai no gradiente de marca
            // só se esgotar. Retorna true nesse caso — agregamos p/ a política de não publicar degradado.
            const usedFallback = await this.processSlide(slide, provider, designSpec, directionByIndex.get(slide.index), context)
            if (usedFallback) fallbackSlides.push(slide.index)
        })

        console.log(`[ImageGenerator] All ${totalSlides} slides processed.`)

        // POLÍTICA (decisão do operador): se QUALQUER imagem ficou em fallback de gradiente após o retry,
        // FALHA a geração inteira — nunca entrega/publica mídia degradada (gradiente fora-da-marca no IG).
        // O 429 transitório já foi mitigado pelo retry por-imagem acima; chegar aqui = falha persistente
        // (cota esgotada, safety block, etc.). O erro propaga pelo pipeline → job 'error' → UI mostra msg.
        if (fallbackSlides.length > 0) {
            const lista = [...new Set(fallbackSlides)].sort((a, b) => a - b).join(', ')
            throw new Error(
                `Geração de imagem falhou em ${fallbackSlides.length} slide(s) [${lista}] mesmo após retry ` +
                `(provável cota do provedor de IA esgotada). Conteúdo não entregue para não publicar imagem ` +
                `fora da marca — tente gerar novamente em instantes.`,
            )
        }
        return newVisual
    }

    /**
     * Gera uma imagem com RETRY (a geração de imagem do client NÃO re-tenta sozinha, ao contrário
     * do caminho de texto). 1 tentativa + 2 retries com backoff (1s, 2s) — recupera o 429 transitório
     * sob cota apertada sem entregar fallback. Esgotado, RELANÇA o último erro (o caller decide o
     * fallback E marca que houve falha, p/ a política "não publicar imagem degradada").
     */
    private async generateWithRetry(
        provider: IImageProvider,
        prompt: string,
        opts: ImageOptions,
        label: string,
    ): Promise<string> {
        const maxAttempts = 3 // 1 + 2 retries
        let lastErr: unknown
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (attempt > 0) {
                const waitMs = attempt * 1000 // 1s, 2s
                console.log(`[ImageGenerator] Retry ${attempt}/${maxAttempts - 1} de ${label} em ${waitMs}ms...`)
                await new Promise((r) => setTimeout(r, waitMs))
            }
            try {
                return await provider.generate(prompt, opts)
            } catch (err) {
                lastErr = err
            }
        }
        throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
    }

    /**
     * Processa um slide. Retorna `true` se ALGUMA imagem do slide caiu no fallback de gradiente
     * (Gemini falhou mesmo após retry) — sinal p/ o pipeline FALHAR a geração em vez de publicar
     * mídia degradada (política: nunca postar fallback no IG). `false` = todas as imagens reais.
     */
    private async processSlide(
        slide: SlideVisualSpec,
        provider: IImageProvider,
        designSpec?: BrandDesignSpec,
        direction?: SlideCreativeDirection,
        context?: PipelineInput['context'],
    ): Promise<boolean> {
        let usedFallback = false
        console.log(`[ImageGenerator] Processing Slide ${slide.index}. Layout: ${slide.layoutId}`)

        // task 1.1: RESPEITA a estratégia do Creative Director. Hoje só `generative-photo` tem
        // provider real — quando a estratégia ideal é stock/gráfico, ela está roteada (auditável no
        // job) mas EXECUTA via foto generativa (deferred=true). Logamos a rota para a fronteira ser
        // visível, nunca mascarada — o resultado visual real de banco/gráfico vem em 1.2/1.3.
        if (direction) {
            console.log(
                `[ImageGenerator] Slide ${slide.index} — estratégia '${direction.strategy}'` +
                (direction.deferred
                    ? ` (sem provider real ainda; executa via '${direction.effectiveStrategy}' até 1.2/1.3): ${direction.reason}`
                    : `: ${direction.reason}`),
            )
        }

        // ADR-0012 PR4: a estética da imagem deriva do spec canônico (paleta/mood/style da marca)
        // p/ a imagem CASAR com o layout — não mais um style cravado. Sem spec → defaults atuais.
        const aesthetics = designSpec?.imageAesthetics
        const bgStyle = aesthetics
            ? `${aesthetics.style}, paleta: ${aesthetics.palette.join(', ')}, ${aesthetics.mood}`
            : 'cinematic, professional, high quality, 8k, minimalistic'
        // Fallback determinístico: o gradiente vem do spec (fonte única, AM-4/R-2) ou do default APEX.
        const gradientFallback = aesthetics?.gradientFallback
            ?? 'linear-gradient(120deg, #C8E0FF 0%, #D7C6FF 30%, #FFC6F0 55%, #FFD7C6 75%, #B6F0FF 100%)'

        // 1. Check for background image
        // Log what we found
        if (slide.background) {
            console.log(`[ImageGenerator] Slide ${slide.index} has background:`, slide.background)
        }

        if (slide.background && slide.background.type === 'image' && slide.background.value && !slide.background.value.startsWith('http') && !slide.background.value.startsWith('data:')) {
            try {
                console.log(`[ImageGenerator] Generating background for slide ${slide.index}. Prompt: "${slide.background.value}"`)
                // task 1.3: ancora o assunto da pauta no prompt (determinístico). Sem contexto → prompt intocado.
                const prompt = buildImagePrompt(slide.background.value, context)
                // Estilo derivado do spec (paleta/mood da marca) — a imagem casa com o layout.
                // Retry: recupera 429 transitório (o caminho de imagem do client não re-tenta sozinho).
                const imageUrl = await this.generateWithRetry(provider, prompt, {
                    aspectRatio: '4:5', // Portrait for background
                    style: bgStyle
                }, `background slide ${slide.index}`)
                console.log(`[ImageGenerator] Background generated successfully for slide ${slide.index}`)
                slide.background.value = imageUrl
            } catch (error) {
                // FIX (AM-4/R-2): antes caía em '#1A1A1A' = a "imagem preta".
                // Agora: log diagnosticável + fallback determinístico = gradiente de
                // marca (iridescente APEX via spec), nunca preto sólido. Mídia sempre renderizável.
                // usedFallback=true: o pipeline FALHA a geração (não publica gradiente no IG).
                console.error(`[ImageGenerator] Falha ao gerar imagem do slide ${slide.index} (após retry) — gradiente de marca. Causa:`, error)
                slide.background = {
                    type: 'gradient',
                    value: gradientFallback,
                }
                usedFallback = true
            }
        }

        // 2. Check for image elements
        if (slide.elements) {
            console.log(`[ImageGenerator] Slide ${slide.index} elements:`, slide.elements.map(e => ({ role: e.role, type: e.type, contentShort: e.content?.substring(0, 20) })))

            for (const element of slide.elements) {
                // Check if element needs image generation
                const needsGeneration = (element.type === 'image' || element.role === 'image' || element.role === 'background') &&
                    element.content &&
                    !element.content.startsWith('http') &&
                    !element.content.startsWith('data:')

                if (needsGeneration) {
                    try {
                        console.log(`[ImageGenerator] Generating element image for slide ${slide.index} (${element.role}). Prompt: "${element.content}"`)
                        // task 1.3: mesmo ancoramento de assunto do background. Sem contexto → prompt intocado.
                        const prompt = buildImagePrompt(element.content, context)
                        // ADR-0012 PR4: estética derivada do spec (consistente com o background);
                        // sem spec → default fotorrealista atual.
                        const elementStyle = aesthetics
                            ? `${aesthetics.style}, paleta: ${aesthetics.palette.join(', ')}, ${aesthetics.mood}`
                            : 'photorealistic, professional, clean studio lighting'
                        const imageUrl = await this.generateWithRetry(provider, prompt, {
                            aspectRatio: '16:9', // Usually elements are landscape-ish or square. Defaulting to 16:9 for body images
                            style: elementStyle
                        }, `elemento '${element.role}' slide ${slide.index}`)
                        console.log(`[ImageGenerator] Element image generated successfully for slide ${slide.index} (${element.role})`)
                        // Update the content with the generated URL
                        element.content = imageUrl

                    } catch (error) {
                        // Antes caía numa URL de placeholder de terceiros que estampava
                        // "Image Gen Failed" para o cliente. Agora: log diagnosticável +
                        // gradiente de marca (iridescente APEX via spec) como data-URI SVG — mesmo
                        // fallback do background, nunca URL externa. usedFallback=true → o pipeline falha
                        // a geração (não publica gradiente no IG).
                        console.error(`[ImageGenerator] Falha ao gerar imagem do elemento '${element.role}' no slide ${slide.index} (após retry) — gradiente de marca. Causa:`, error)
                        element.content = gradientCssToSvgDataUri(gradientFallback)
                        usedFallback = true
                    }
                }
            }
        }
        return usedFallback
    }

    parseOutput(_response: string): VisualSpecification {
        // Determinístico por design (E10.2/ADR-0011): este agente itera sobre slides e chama o
        // provider de imagem; não há resposta de texto de LLM para parsear. Inalcançável no fluxo.
        throw new Error('ImageGeneratorAgent.parseOutput não é suportado por design (agente determinístico, sem fluxo de texto LLM).')
    }
}
