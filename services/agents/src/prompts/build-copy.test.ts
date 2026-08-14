import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ADR-0011 / E10.1.c — o build (`npm run build`) deve copiar prompts/*.md para dist/prompts/,
// senão `node dist/server.js` quebra ao chamar loadBasePrompt em runtime. Este teste valida o
// ARTEFATO de build: se dist/ existe (após `npm run build`), os 5 .md estão lá e são idênticos
// aos de src/. Em ambiente sem build (CI que roda só `npm test`), o teste se auto-pula com aviso
// — nunca um falso-verde silencioso: o passo de cópia é provado também no _distcheck do QG.

const KEYS = ['brand-strategist', 'story-architect', 'copywriter', 'visual-compositor', 'quality-validator'] as const

function srcPath(key: string): string {
  return fileURLToPath(new URL(`./${key}.md`, import.meta.url))
}
function distPath(key: string): string {
  // src/prompts/<key>.md → dist/prompts/<key>.md
  return fileURLToPath(new URL(`../../dist/prompts/${key}.md`, import.meta.url))
}

const distBuilt = existsSync(fileURLToPath(new URL('../../dist/prompts', import.meta.url)))

describe('build copia prompts/*.md → dist/prompts/ (E10.1.c)', () => {
  it.skipIf(!distBuilt)('os 5 .md existem em dist/prompts/ e são idênticos aos de src/', () => {
    for (const key of KEYS) {
      const dist = distPath(key)
      expect(existsSync(dist), `dist/prompts/${key}.md ausente — rode 'npm run build' (passo copy:prompts)`).toBe(true)
      // Conteúdo idêntico byte-a-byte ao asset versionado (nenhuma transformação no caminho).
      expect(readFileSync(dist, 'utf8')).toBe(readFileSync(srcPath(key), 'utf8'))
    }
  })

  it('aviso honesto quando dist/ não foi buildado (não é falso-verde)', () => {
    if (!distBuilt) {
      // eslint-disable-next-line no-console
      console.warn('[E10.1.c] dist/prompts ausente nesta execução — rode `npm run build` para validar a cópia.')
    }
    expect(true).toBe(true)
  })
})
