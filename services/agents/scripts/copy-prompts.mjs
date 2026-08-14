/**
 * copy:prompts (ADR-0011/E10.1.c) — leva os prompts versionados para o build.
 *
 * `tsc`/`tsc-alias` compilam só `.ts`; os `.md` de `src/prompts/` NÃO vão para `dist/`
 * sozinhos. Sem este passo, `node dist/server.js` quebraria em runtime ao tentar
 * `loadBasePrompt` (o loader resolve o `.md` ao lado do módulo compilado em dist/prompts/).
 *
 * Cross-platform, sem dependência externa: `fs.cpSync` recursivo de `src/prompts/*.md`.
 * Idempotente (sobrescreve). Falha ruidosa se a origem não existir — nunca um build "verde"
 * com prompts faltando.
 */
import { cpSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url)) // services/agents/scripts
const srcDir = join(here, '..', 'src', 'prompts')
const dstDir = join(here, '..', 'dist', 'prompts')

if (!existsSync(srcDir)) {
  console.error(`[copy:prompts] origem inexistente: ${srcDir}`)
  process.exit(1)
}

mkdirSync(dstDir, { recursive: true })

const mds = readdirSync(srcDir).filter((f) => f.endsWith('.md'))
if (mds.length === 0) {
  console.error(`[copy:prompts] nenhum .md em ${srcDir} — abortando (o loader quebraria em runtime).`)
  process.exit(1)
}

for (const file of mds) {
  cpSync(join(srcDir, file), join(dstDir, file))
}

console.log(`[copy:prompts] ${mds.length} prompt(s) copiado(s) para dist/prompts/: ${mds.join(', ')}`)
