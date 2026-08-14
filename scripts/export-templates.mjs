#!/usr/bin/env node
// export-templates.mjs — exporta os 4 templates built-in do agents (FONTE DA VERDADE:
// services/agents/src/templates/index.ts) para um JSON canônico que o seeder .NET
// (libs/SocialAi.Core/Data/Seed/builtin-templates.json) embute como recurso.
//
// Por que isto existe (D/ADR-0008): o seed dos 4 templates em DADOS precisa ser BYTE-FIEL
// ao CarouselTemplate que o agents recebe e valida (D5). Redigitar ~700 linhas de template
// em C# convidaria divergência silenciosa. Determinismo > geração: este script lê o TS
// canônico e emite o JSON; o teste de contrato (.NET + agents) trava qualquer drift.
//
// Uso:
//   node scripts/export-templates.mjs           # escreve o JSON
//   node scripts/export-templates.mjs --check   # falha (exit 1) se o JSON divergir do disco
//
// Roda via tsx (o agents já tem tsx); o import de TEMPLATES resolve o path alias @/* manualmente.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_TS = resolve(HERE, '../services/agents/src/templates/index.ts')
const OUT_JSON = resolve(HERE, '../libs/SocialAi.Core/Data/Seed/builtin-templates.json')

// Importa o módulo TS via tsx (registrado pelo runner). O index.ts só usa `import type`
// (apagado em runtime) — o objeto TEMPLATES é literal puro, sem efeito colateral.
// IMPORTANTE: este script importa TypeScript (index.ts → archetypes-v2), então EXIGE um loader TS.
// Rode-o por `npm run check-templates` (em services/agents) — NUNCA por `node` direto, que não
// resolve os imports .ts e falha com um ERR_MODULE_NOT_FOUND críptico. Detectamos e orientamos.
let mod
try {
  mod = await import(pathToFileURL(TEMPLATES_TS).href)
} catch (err) {
  if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
    console.error(
      'export-templates: não foi possível importar o TypeScript dos templates.\n' +
      '  Este script precisa de um loader TS. Rode:\n' +
      '    cd services/agents && npm run check-templates\n' +
      '  (não use `node scripts/export-templates.mjs` direto — Node puro não resolve os imports .ts).'
    )
    process.exit(2)
  }
  throw err
}
const TEMPLATES = mod.TEMPLATES
if (!TEMPLATES || typeof TEMPLATES !== 'object') {
  console.error('export-templates: TEMPLATES não encontrado em', TEMPLATES_TS)
  process.exit(2)
}

// Ordena por id p/ saída determinística (independe da ordem de iteração do objeto).
const list = Object.values(TEMPLATES).sort((a, b) => a.id.localeCompare(b.id))
const json = JSON.stringify(list, null, 2) + '\n'

const check = process.argv.includes('--check')
if (check) {
  let onDisk = ''
  try { onDisk = readFileSync(OUT_JSON, 'utf8') } catch { /* arquivo ausente → divergente */ }
  if (onDisk !== json) {
    console.error('export-templates --check: builtin-templates.json DESATUALIZADO. Rode `node scripts/export-templates.mjs`.')
    process.exit(1)
  }
  console.log('export-templates --check: ok (' + list.length + ' templates).')
} else {
  writeFileSync(OUT_JSON, json, 'utf8')
  console.log('export-templates: ' + list.length + ' templates → ' + OUT_JSON)
}
