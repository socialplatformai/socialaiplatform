/**
 * Chaves dos agentes de LLM cujo system prompt é asset versionado e overridável (ADR-0011).
 *
 * FONTE ÚNICA (L8 — determinismo > duplicação): o array `as const` é a verdade; a união de tipo
 * é DERIVADA dele (`typeof PROMPT_AGENT_KEYS[number]`). Assim adicionar/renomear um agente é UMA
 * edição — o tipo e a lista runtime não podem divergir (o array de 4 não "satisfaz" 5 silenciosamente).
 *
 * É um tipo de DOMÍNIO (quais agentes existem), não um detalhe de I/O — por isso mora em `types/`,
 * e o loader de prompts + o adapter IMPORTAM daqui (a seta de dependência aponta para o domínio).
 * Os determinísticos (image-generator, render-engine) NÃO entram aqui (sem LLM de texto).
 */
export const PROMPT_AGENT_KEYS = [
  'brand-strategist',
  'story-architect',
  'copywriter',
  'visual-compositor',
  'quality-validator',
] as const

export type PromptAgentKey = (typeof PROMPT_AGENT_KEYS)[number]
