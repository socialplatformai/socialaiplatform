/**
 * Inventor de PAUTA autônoma (o cérebro do loop autônomo, ADR-0010/§2.4).
 *
 * O que resolve: quando a fila editorial esvazia, o robô (worker) precisa de uma pauta NOVA e
 * RELEVANTE ao que a empresa faz — não um placeholder. Este módulo recebe o BrandKit (identidade,
 * tom, diretrizes, público, tipos de conteúdo desejados) + o histórico recente de títulos (anti-
 * repetição) e devolve UMA pauta pronta para a fila: título + objetivo + contexto + categoria.
 *
 * Por que aqui (agents) e não no worker: o worker NÃO fala com LLM — delega ao agents por HTTP,
 * exatamente como faz para gerar arte (AgentsStartClient → /generate). Este é o análogo textual:
 * AgentsInventClient → /invent-pauta. Reusa a MESMA infra de provider (resolveTextProvider) e a
 * MESMA resolução de chave por workspace (aiOverride). Sem chave → erro diagnosticável (o worker
 * trata como "não inventou": degradado honesto, o robô não cria pauta-lixo sem IA).
 *
 * Fronteira honesta (L4/L5): o Rationale devolvido descreve o que REALMENTE embasou a ideia (a
 * identidade + as diretrizes da marca), corrigindo a desonestidade do stub anterior (que afirmava
 * usar dados que não lia).
 */

import type { AiConfig } from '../config.js'
import { aiToGeminiConfig } from '../config.js'
import { getGeminiClient } from '../gemini/client.js'
import { resolveTextProvider } from '../text/textProvider.js'

/** Contexto da marca — o "o que a empresa faz". Todos opcionais: ausência é estado válido. */
export interface InventBrandContext {
  branding?: string
  tone?: string
  guidelines?: string
  positioningRules?: string
  targetAudience?: string
  desiredContentTypes?: string
  /** Objetivo de marketing padrão da marca (awareness|consideration|conversion), se houver. */
  marketingObjective?: string
}

/** O request que chega do worker (via /invent-pauta). */
export interface InventPautaRequest {
  brand: InventBrandContext
  /** Títulos publicados recentemente (janela anti-repetição) — o modelo evita repeti-los. */
  recentTitles?: string[]
  /** Formato desejado, se o operador fixou uma preferência; senão o modelo escolhe. */
  desiredFormat?: 'post' | 'carousel' | 'story'
}

/** A pauta inventada — shape estável consumido pelo worker (camelCase). */
export interface InventedPauta {
  title: string
  objective: string
  context: string
  category: string
  /** Objetivo de marketing normalizado (o input-adapter já sabe mapear). */
  marketingObjective: 'awareness' | 'consideration' | 'conversion'
  suggestedType: 'post' | 'carousel' | 'story'
  /** Justificativa HONESTA do que embasou a ideia (não afirma dados que não usou). */
  rationale: string
}

const SYSTEM_PROMPT = `Você é um estrategista de conteúdo sênior de uma agência brasileira. Sua tarefa
é INVENTAR UMA pauta de post para Instagram para uma marca específica, quando a fila editorial dela
está vazia. A pauta precisa ser RELEVANTE ao que a marca faz, fiel ao tom dela, e útil ao público — não
genérica. Escreva em português brasileiro.

Regras:
- Fidelidade à marca: use a identidade, o tom e as diretrizes fornecidas. Se faltarem, seja conservador
  e neutro — NUNCA invente fatos sobre a marca (produtos, números, promoções) que não foram informados.
- Anti-repetição: não repita nenhum tema da lista de títulos recentes.
- Acionável: o objetivo e o contexto devem dar ao time de criação o suficiente para produzir a arte.
- Honestidade: o "rationale" descreve o que você REALMENTE usou para decidir (identidade/tom/diretrizes),
  sem afirmar dados de performance que não recebeu.

Responda APENAS com um objeto JSON com exatamente estas chaves:
{
  "title": "título curto e chamativo da pauta",
  "objective": "1 frase — o que este post deve alcançar",
  "context": "2-4 frases — o briefing para quem vai criar a arte (ângulo, mensagem-chave, tom)",
  "category": "categoria curta (ex.: educativo, bastidores, prova social, oferta, dica)",
  "marketingObjective": "awareness | consideration | conversion",
  "suggestedType": "post | carousel | story",
  "rationale": "1 frase honesta sobre o que embasou a ideia"
}`

function buildUserPrompt(req: InventPautaRequest): string {
  const b = req.brand
  const lines: string[] = []
  lines.push('## A MARCA (o que a empresa faz)')
  lines.push(b.branding ? `Identidade: ${b.branding}` : 'Identidade: (não informada)')
  lines.push(b.tone ? `Tom de voz: ${b.tone}` : 'Tom de voz: (não informado)')
  if (b.guidelines) lines.push(`Diretrizes editoriais: ${b.guidelines}`)
  if (b.positioningRules) lines.push(`Posicionamento/linguagem: ${b.positioningRules}`)
  if (b.targetAudience) lines.push(`Público-alvo: ${b.targetAudience}`)
  if (b.desiredContentTypes) lines.push(`Tipos de conteúdo desejados: ${b.desiredContentTypes}`)
  if (b.marketingObjective) lines.push(`Objetivo de marketing padrão: ${b.marketingObjective}`)

  const recent = (req.recentTitles ?? []).filter(t => t && t.trim()).slice(0, 30)
  lines.push('')
  lines.push('## TÍTULOS RECENTES (NÃO repita estes temas)')
  lines.push(recent.length ? recent.map(t => `- ${t}`).join('\n') : '(nenhum — a marca está começando)')

  if (req.desiredFormat) {
    lines.push('')
    lines.push(`## FORMATO PREFERIDO PELO OPERADOR: ${req.desiredFormat} (use-o em suggestedType).`)
  }

  lines.push('')
  lines.push('Invente UMA pauta nova, relevante e fiel à marca. Responda só com o JSON.')
  return lines.join('\n')
}

const VALID_FORMATS = new Set(['post', 'carousel', 'story'])
const VALID_MKT = new Set(['awareness', 'consideration', 'conversion'])

/**
 * Inventa uma pauta a partir do contexto da marca, usando o provider de texto efetivo (o mesmo do
 * pipeline de arte). Lança erro diagnosticável em falha (sem chave, provider fora do ar, JSON
 * inválido) — o chamador (endpoint) traduz para HTTP; o worker trata como "não inventou".
 */
export async function inventPauta(req: InventPautaRequest, ai: AiConfig): Promise<InventedPauta> {
  const provider = resolveTextProvider(ai, getGeminiClient(aiToGeminiConfig(ai)))

  const raw = await provider.completeJSON<Partial<InventedPauta>>(
    SYSTEM_PROMPT,
    buildUserPrompt(req),
    { temperature: ai.temperature, maxTokens: ai.maxTokens },
  )

  return normalize(raw, req.desiredFormat)
}

/**
 * Saneia a saída do modelo em um shape garantido — o worker persiste isto direto na Pauta, então
 * campos vazios/inválidos viram defaults seguros (nunca undefined que geraria pauta quebrada).
 */
export function normalize(raw: Partial<InventedPauta>, desiredFormat?: string): InventedPauta {
  const title = (raw.title ?? '').trim()
  if (!title) {
    // Sem título não há pauta — falha honesta (o modelo não cumpriu o contrato).
    throw new Error('Inventor de pauta: o modelo não devolveu um título — pauta descartada (não gera lixo).')
  }
  const fmt = (desiredFormat && VALID_FORMATS.has(desiredFormat) ? desiredFormat : raw.suggestedType) ?? 'post'
  const suggestedType = (VALID_FORMATS.has(fmt) ? fmt : 'post') as InventedPauta['suggestedType']
  const mkt = raw.marketingObjective ?? 'awareness'
  const marketingObjective = (VALID_MKT.has(mkt) ? mkt : 'awareness') as InventedPauta['marketingObjective']

  return {
    title,
    objective: (raw.objective ?? '').trim() || 'Aumentar o engajamento da marca com um conteúdo relevante.',
    context: (raw.context ?? '').trim() || title,
    category: (raw.category ?? '').trim() || 'geral',
    marketingObjective,
    suggestedType,
    rationale:
      (raw.rationale ?? '').trim() ||
      'Baseada na identidade e nas diretrizes da marca (fila editorial vazia).',
  }
}
