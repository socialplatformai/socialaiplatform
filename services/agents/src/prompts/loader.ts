/**
 * Prompt Loader — FONTE ÚNICA da leitura de prompt-base (ADR-0011 / E10.1).
 *
 * Os 5 system prompts dos agentes de LLM saíram dos template literals embutidos em
 * cada `agents/*.ts` e passaram a morar em `prompts/<agentKey>.md` — git é a verdade.
 * Editar o `.md` muda o comportamento do agente sem recompilar TypeScript (efeito por
 * rebuild/restart; o cache é lido UMA vez por processo — NÃO é hot-reload).
 *
 * Espírito de `config.ts` (ADR-0004): uma fonte única, lida do ambiente uma vez,
 * default == comportamento atual. Aqui a "fonte" é o arquivo; o cache evita reler o
 * disco a cada chamada de `systemPrompt`.
 *
 * Resolução de caminho (ESM, `type: module`, sem `__dirname`): o `.md` fica SEMPRE ao
 * lado deste módulo. `import.meta.url` aponta para `src/prompts/loader.ts` em dev/teste
 * (tsx/vitest leem `src/`) e para `dist/prompts/loader.js` em produção — e o passo
 * `copy:prompts` do build (E10.1.c) garante que os `.md` acompanhem o loader em `dist/`.
 * Logo `new URL('./<key>.md', import.meta.url)` resolve nos dois mundos sem ramificação.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// A fonte única das chaves é o tipo de DOMÍNIO (types/agent-keys); o loader (I/O) importa dela.
import type { PromptAgentKey } from '@/types/agent-keys'

export type { PromptAgentKey } // re-export por conveniência dos consumidores do loader

/** Cache por processo: leitura única do disco por agentKey (espírito de config.ts). */
const cache = new Map<PromptAgentKey, string>()

/**
 * Carrega o prompt-base do agente a partir de `prompts/<key>.md`, cacheado.
 * Lança erro DIAGNOSTICÁVEL (aponta a chave e o caminho) se o arquivo faltar — modo
 * degradado honesto, nunca string vazia silenciosa.
 */
export function loadBasePrompt(key: PromptAgentKey): string {
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const url = new URL(`./${key}.md`, import.meta.url)
  let content: string
  try {
    content = readFileSync(fileURLToPath(url), 'utf8')
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(
      `[prompts] Falha ao carregar o prompt-base de '${key}' em ${fileURLToPath(url)} — ` +
        `verifique se prompts/${key}.md existe e foi copiado para dist/ (passo copy:prompts do build). Causa: ${reason}`,
    )
  }

  cache.set(key, content)
  return content
}

/**
 * Reset do cache — APENAS para teste (E10.1.b). Em produção a mudança de um `.md` exige
 * rebuild/restart do processo; não há hot-reload. Exposto para que os testes possam
 * trocar o arquivo (ou injetar marcador) e reler.
 */
export function __resetPromptCacheForTests(): void {
  cache.clear()
}
