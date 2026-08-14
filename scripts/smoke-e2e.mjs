#!/usr/bin/env node
// smoke-e2e.mjs — verificação rápida do fluxo de usuário ponta-a-ponta (E0.4).
//
// Roteiro (já validado manualmente na fundação): registrar → salvar marca →
// criar pauta → listar → gerar (espera ERRO degradado claro sem chave de IA) →
// checar 401 sem token. Usa só `fetch` nativo (Node 20+); sem dependências.
//
// NÃO sobe a stack — assume a API rodando. É um SMOKE, não um e2e de browser.
// Documentado em docs/sot/05-operacao.md como verificação rápida pós-deploy.
//
// Uso:
//   node scripts/smoke-e2e.mjs                 # contra http://localhost:5080
//   API_URL=http://host:5080 node scripts/smoke-e2e.mjs
//
// Saída: cada passo logado; exit 0 = tudo verde, exit 1 = qualquer falha.

const BASE = process.env.API_URL || 'http://localhost:5080'

let passed = 0
let failed = 0
const fails = []

function ok(msg) {
  passed++
  console.log(`  ✓ ${msg}`)
}
function bad(msg) {
  failed++
  fails.push(msg)
  console.log(`  ✗ ${msg}`)
}
function step(name) {
  console.log(`\n▸ ${name}`)
}

async function req(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  const text = await res.text()
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: res.status, json }
}

// JSON da API liga case-insensitive; usamos camelCase nas requisições e lemos
// as respostas de forma tolerante a maiúscula/minúscula.
function pick(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return undefined
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k]
    const lower = k.charAt(0).toLowerCase() + k.slice(1)
    if (obj[lower] !== undefined) return obj[lower]
    const upper = k.charAt(0).toUpperCase() + k.slice(1)
    if (obj[upper] !== undefined) return obj[upper]
  }
  return undefined
}

// Extrai o texto de erro de respostas variadas (string, {error}, {message},
// {title}/{detail} do RFC7807, ou o corpo cru). Retorna '' se não houver nada.
function errorText(json) {
  if (!json) return ''
  if (typeof json === 'string') return json
  const fields = [pick(json, 'error'), pick(json, 'message'), pick(json, 'detail'), pick(json, 'title')]
  return fields.filter((s) => typeof s === 'string' && s.trim()).join(' | ')
}

// O erro em modo degradado precisa APONTAR a causa — não basta um 500 genérico.
// Aceita sinais de: chave/credencial de IA ausente, provider, ou agents fora.
function looksDegraded(msg) {
  if (!msg || !msg.trim()) return false
  const m = msg.toLowerCase()
  const sinais = [
    'ai_provider', 'ai provider', 'provider', 'chave', 'api key', 'apikey', 'key',
    'gemini', 'openai', 'modelo', 'model', 'agents', 'agente', 'pipeline',
    'gera', 'generation', 'indispon', 'unavailable', 'connection refused', 'recusad',
  ]
  return sinais.some((s) => m.includes(s))
}

function trunc(s, n = 160) {
  s = String(s ?? '')
  return s.length > n ? s.slice(0, n) + '…' : s
}

async function main() {
  console.log(`Smoke E2E contra ${BASE}`)

  // 0) Health (sem auth) — falha cedo e claro se a stack não está de pé.
  step('Health')
  try {
    const r = await req('GET', '/health')
    if (r.status === 200) ok(`/health 200 (${pick(r.json, 'deployMode') ?? '?'})`)
    else bad(`/health esperado 200, veio ${r.status}`)
  } catch (e) {
    bad(`/health inacessível — a API está rodando em ${BASE}? (${e.message})`)
    return finish() // sem stack, o resto não faz sentido
  }

  // 1) Registrar (cria workspace + admin). Email único por execução.
  step('Registrar usuário')
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const email = `smoke+${stamp}@example.com`
  const password = 'smoke-pass-12345'
  let token = null
  {
    const r = await req('POST', '/api/auth/register', {
      body: { email, password, name: 'Smoke', workspaceName: 'Smoke WS' },
    })
    token = pick(r.json, 'accessToken')
    const role = pick(r.json, 'role')
    if (r.status === 200 && token) ok(`registrado (role=${role}), token recebido`)
    else bad(`register esperado 200+token, veio ${r.status} ${JSON.stringify(r.json)}`)
  }
  if (!token) {
    bad('sem token — abortando passos autenticados')
    return finish()
  }

  // 2) Salvar marca (upsert idempotente por workspace).
  step('Salvar marca (brand kit)')
  {
    const r = await req('PUT', '/api/brand/kit', {
      token,
      body: {
        branding: 'Marca de teste do smoke',
        tone: 'Direto, acolhedor',
        editorialGuidelines: 'Frases curtas. Sem jargão.',
        positioningRules: 'Premium acessível',
        desiredContentTypes: 'Carrossel',
      },
    })
    if (r.status === 200) ok('marca salva (200)')
    else bad(`brand/kit esperado 200, veio ${r.status} ${JSON.stringify(r.json)}`)
  }

  // 3) Criar pauta.
  step('Criar pauta')
  let pautaId = null
  {
    const r = await req('POST', '/api/pautas', {
      token,
      body: {
        title: 'Pauta do smoke',
        objective: 'Validar o fluxo ponta-a-ponta',
        priority: 1, // Medium
        desiredType: 1, // Carousel
      },
    })
    pautaId = pick(r.json, 'id')
    // API responde 200 OK (ou 201) com o DTO; o que importa é um id válido no corpo.
    if ((r.status === 200 || r.status === 201) && pautaId) ok(`pauta criada (${pautaId}, ${r.status})`)
    else bad(`pautas esperado 200/201+id, veio ${r.status} ${JSON.stringify(r.json)}`)
  }

  // 4) Listar pautas (deve conter a recém-criada).
  step('Listar pautas')
  {
    const r = await req('GET', '/api/pautas', { token })
    const arr = Array.isArray(r.json) ? r.json : []
    const found = pautaId && arr.some((p) => pick(p, 'id') === pautaId)
    if (r.status === 200 && found) ok(`lista contém a pauta (${arr.length} no total)`)
    else bad(`pautas list esperado 200 contendo a pauta, veio ${r.status} (${arr.length} itens)`)
  }

  // 5) Gerar conteúdo em modo degradado (sem chave de IA): o sistema deve ser
  //    HONESTO — ou erro síncrono claro, ou job que vai a status "error" — e o
  //    texto do erro deve APONTAR a causa (chave de IA / provider / agents).
  //    Sucesso silencioso, OU erro vazio/genérico, seria REGRESSÃO (degraded
  //    mode é estado de 1ª classe; ver docs/sot/05-operacao.md §10).
  step('Gerar conteúdo (espera erro degradado claro)')
  {
    const r = await req('POST', '/api/content/generate/async', {
      token,
      body: { pautaId, format: 1 },
    })
    if (r.status >= 400) {
      // Falha síncrona: exigimos um corpo de erro não-vazio que descreva a causa.
      const msg = errorText(r.json)
      if (looksDegraded(msg)) ok(`generate falhou síncrono e claro (${r.status}): "${trunc(msg)}"`)
      else bad(`generate ${r.status} mas sem mensagem clara de degradado: ${trunc(JSON.stringify(r.json))}`)
    } else if (r.status === 200) {
      const jobId = pick(r.json, 'jobId')
      const contentId = pick(r.json, 'contentId')
      if (!jobId) {
        bad(`generate 200 sem jobId: ${JSON.stringify(r.json)}`)
      } else {
        // Poll curto até error/done (modo degradado deve terminar em error).
        let final = null
        let errMsg = ''
        for (let i = 0; i < 20; i++) {
          await new Promise((res) => setTimeout(res, 1500))
          const j = await req('GET', `/api/content/jobs/${jobId}?contentId=${contentId}`, { token })
          const status = pick(j.json, 'status')
          if (status === 'error') {
            final = 'error'
            errMsg = errorText(j.json)
            break
          }
          if (status === 'done') {
            final = 'done'
            break
          }
        }
        if (final === 'error') {
          if (looksDegraded(errMsg)) ok(`job foi a "error" com mensagem clara: "${trunc(errMsg)}"`)
          else bad(`job foi a "error" mas a mensagem não aponta a causa degradada: "${trunc(errMsg)}"`)
        } else if (final === 'done') {
          bad('generate concluiu sem chave de IA — degraded mode deveria falhar honestamente')
        } else {
          // Timeout sem error/done: degraded mode deveria falhar RÁPIDO, não pendurar.
          bad('job não chegou a "error" no tempo do poll — degraded mode deveria falhar rápido')
        }
      }
    } else {
      bad(`generate status inesperado ${r.status}`)
    }
  }

  // 6) 401 sem token (proteção de endpoint autenticado).
  step('401 sem token')
  {
    const r = await req('GET', '/api/pautas')
    if (r.status === 401) ok('GET /api/pautas sem token → 401')
    else bad(`esperado 401 sem token, veio ${r.status}`)
  }

  finish()
}

function finish() {
  console.log(`\n${'─'.repeat(40)}`)
  console.log(`Smoke E2E: ${passed} ok, ${failed} falha(s).`)
  if (failed > 0) {
    console.log('Falhas:')
    for (const f of fails) console.log(`  - ${f}`)
    process.exit(1)
  }
  console.log('Tudo verde. ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error(`\nErro fatal no smoke: ${e.stack || e.message}`)
  process.exit(1)
})
