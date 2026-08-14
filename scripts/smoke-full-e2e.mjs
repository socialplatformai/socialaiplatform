#!/usr/bin/env node
// smoke-full-e2e.mjs — Fase 4.2 do PLANO-ENTREGA-MARCOS: a JORNADA do Marcos, ponta-a-ponta, A VIVO.
//
// Diferente do smoke-e2e.mjs (que valida o degraded-mode SEM chave de IA), este percorre o fluxo
// COMPLETO com geração REAL (assume AI key no .env + a stack de pé):
//   register → marca → pauta → generate/async → poll até done → choose → approve → schedule (no
//   passado, p/ o worker pegar já) → aguarda o worker publicar em MOCK → history → valida.
//
// Valida: (a) o /content volta LEVE (~KB, não 10MB — store de imagem ligado);
// (b) o conteúdo chega a Published via o worker (mock), com badge de demonstração.
//
// Uso: node scripts/smoke-full-e2e.mjs           # contra http://localhost:5080
//      API_URL=http://host:5080 node scripts/smoke-full-e2e.mjs
// Exit 0 = tudo verde; 1 = qualquer falha.

const BASE = process.env.API_URL || 'http://localhost:5080'
let passed = 0, failed = 0
const fails = []
const ok = (m) => { passed++; console.log(`  ✓ ${m}`) }
const bad = (m) => { failed++; fails.push(m); console.log(`  ✗ ${m}`) }
const step = (n) => console.log(`\n▸ ${n}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function pick(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return undefined
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k]
    const lo = k.charAt(0).toLowerCase() + k.slice(1)
    if (obj[lo] !== undefined) return obj[lo]
    const up = k.charAt(0).toUpperCase() + k.slice(1)
    if (obj[up] !== undefined) return obj[up]
  }
  return undefined
}

async function req(method, path, { token, body, raw } = {}) {
  const headers = {}
  if (!raw) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json, bytes: text.length }
}

async function main() {
  console.log(`Smoke FULL E2E (geração real) contra ${BASE}`)

  step('Health')
  {
    const r = await req('GET', '/health')
    if (r.status === 200) ok(`/health 200 (deployMode=${pick(r.json, 'deployMode') ?? '?'})`)
    else { bad(`/health ${r.status} — a stack está de pé?`); return finish() }
  }

  step('Registrar usuário')
  const stamp = `${Date.now()}`
  let token = null
  {
    const r = await req('POST', '/api/auth/register', {
      body: { email: `smoke+${stamp}@example.com`, password: 'smoke-pass-12345', name: 'Smoke', workspaceName: 'Smoke WS' },
    })
    token = pick(r.json, 'accessToken')
    if (r.status === 200 && token) ok('registrado, token recebido')
    else { bad(`register ${r.status}: ${JSON.stringify(r.json)}`); return finish() }
  }

  step('Salvar marca')
  {
    const r = await req('PUT', '/api/brand/kit', {
      token,
      body: { branding: 'Café de especialidade da serra', tone: 'Caloroso e direto',
        editorialGuidelines: 'Frases curtas. Sem jargão.', positioningRules: 'Premium acessível',
        desiredContentTypes: 'Carrossel' },
    })
    if (r.status === 200) ok('marca salva')
    else bad(`brand/kit ${r.status}: ${JSON.stringify(r.json)}`)
  }

  step('Criar pauta')
  let pautaId = null
  {
    const r = await req('POST', '/api/pautas', {
      token,
      body: { title: 'Os 3 erros de quem compra café barato', objective: 'Educar e converter para o nosso blend',
        priority: 1, desiredType: 1 },
    })
    pautaId = pick(r.json, 'id')
    if ((r.status === 200 || r.status === 201) && pautaId) ok(`pauta criada (${pautaId})`)
    else { bad(`pautas ${r.status}: ${JSON.stringify(r.json)}`); return finish() }
  }

  step('Gerar conteúdo (async) — geração REAL pelo pipeline de 6 agentes')
  let contentId = null, jobId = null
  {
    const r = await req('POST', '/api/content/generate/async', { token, body: { pautaId, format: 1 } })
    jobId = pick(r.json, 'jobId'); contentId = pick(r.json, 'contentId')
    if (r.status === 200 && jobId && contentId) ok(`geração enfileirada (job=${jobId}, content=${contentId})`)
    else { bad(`generate/async ${r.status}: ${JSON.stringify(r.json)}`); return finish() }
  }

  step('Poll do job até done (pipeline leva 60-120s)')
  {
    let final = null, lastStep = '', errMsg = ''
    for (let i = 0; i < 90; i++) { // ~135s de teto (90 * 1.5s)
      await sleep(1500)
      const j = await req('GET', `/api/content/jobs/${jobId}?contentId=${contentId}`, { token })
      const status = pick(j.json, 'status')
      lastStep = pick(j.json, 'step') ?? lastStep
      if (status === 'done') { final = 'done'; break }
      if (status === 'error') { final = 'error'; errMsg = pick(j.json, 'error') ?? ''; break }
      if (i % 6 === 0) console.log(`    …${Math.round(i * 1.5)}s step=${lastStep} status=${status}`)
    }
    if (final === 'done') ok(`geração concluída (done)`)
    else if (final === 'error') { bad(`job foi a error: ${errMsg}`); return finish() }
    else { bad(`job não concluiu no tempo (último step=${lastStep})`); return finish() }
  }

  step('LIÇÃO D1: GET /api/content/{id} volta LEVE (~KB, não 10MB)')
  {
    const r = await req('GET', `/api/content/${contentId}`, { token })
    const kb = (r.bytes / 1024).toFixed(1)
    const slides = pick(r.json, 'slides') ?? []
    const firstImg = slides[0] ? pick(slides[0], 'imageUrl') : ''
    if (r.status === 200 && r.bytes < 1_000_000) ok(`payload leve: ${kb} KB (< 1MB) — store de imagem por URL ligado`)
    else bad(`payload pesado: ${kb} KB (regressão D1 — base64 inline?)`)
    if (typeof firstImg === 'string' && /^https?:\/\//.test(firstImg)) ok(`slide.imageUrl é URL de proxy: ${firstImg.slice(0, 60)}…`)
    else bad(`slide.imageUrl não é URL pública: ${String(firstImg).slice(0, 60)}`)
  }

  step('A imagem do slide RENDERIZA (pixel, não cinza)')
  {
    // Segue o proxy 302 → presigned e baixa os bytes reais da imagem.
    const r = await req('GET', `/api/content/${contentId}`, { token })
    const slides = pick(r.json, 'slides') ?? []
    const imgUrl = slides[0] ? pick(slides[0], 'imageUrl') : null
    if (!imgUrl) { bad('sem slide com imageUrl para checar o pixel'); }
    else {
      const res = await fetch(imgUrl, { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow' })
      const buf = Buffer.from(await res.arrayBuffer())
      const ct = res.headers.get('content-type') || ''
      // PNG (89 50 4E 47) ou JPEG (FF D8 FF) com tamanho real → pixel de verdade.
      const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
      const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
      if (res.status === 200 && (isPng || isJpg) && buf.length > 2000) {
        ok(`imagem real: ${(buf.length / 1024).toFixed(1)} KB ${isPng ? 'PNG' : 'JPEG'} (ct=${ct})`)
      } else {
        bad(`imagem suspeita: status=${res.status} bytes=${buf.length} ct=${ct} (cinza/vazia?)`)
      }
    }
  }

  step('Choose (promove a peça de Draft) + Aprovar')
  {
    // choose: só se a peça estiver em Draft (variações). Geração única pode já estar PendingApproval.
    await req('POST', `/api/content/${contentId}/choose`, { token }) // tolerante: pode 4xx se não-Draft
    const r = await req('POST', `/api/approval/content/${contentId}/decide`, {
      token, body: { approved: true, reviewer: 'smoke', comments: null },
    })
    if (r.status === 200 || r.status === 204) ok('peça aprovada')
    else bad(`decide ${r.status}: ${JSON.stringify(r.json)}`)
  }

  step('Agendar para AGORA (worker pega no próximo tick)')
  let scheduleId = null
  {
    // Enviamos o INSTANTE ABSOLUTO (scheduledFor em UTC) e OMITIMOS scheduledForLocal: o servidor usa
    // o instante direto, sem conversão de fuso (ScheduleController). Janela estreita do produto: o
    // agendamento não pode ser <1min no passado (validação anti-passado) E o worker só pega
    // ScheduledFor <= now. Então miramos ~30s no passado: passa a validação (dentro da tolerância de
    // 1min) e o worker dispara no próximo tick. (1º run usou scheduledForLocal e a conversão de fuso
    // jogou +3h no futuro; o 2º recuou 15h e bateu na validação anti-passado — ambos do smoke, não do produto.)
    const scheduledFor = new Date(Date.now() - 30_000).toISOString()
    const r = await req('POST', '/api/schedule', {
      token, body: { contentId, scheduledFor, frequency: 0 },
    })
    scheduleId = pick(r.json, 'id')
    if ((r.status === 200 || r.status === 201) && scheduleId) ok(`agendado (${scheduleId})`)
    else bad(`schedule ${r.status}: ${JSON.stringify(r.json)}`)
  }

  step('Aguardar o worker PUBLICAR em mock (scheduler 60s → publish 30s)')
  {
    let published = false, status = null
    for (let i = 0; i < 50; i++) { // ~150s de teto
      await sleep(3000)
      const r = await req('GET', `/api/content/${contentId}`, { token })
      status = pick(r.json, 'status')
      // 6=Published, 7=EphemeralPublished
      if (status === 6 || status === 7 || status === 'Published' || status === 'EphemeralPublished') { published = true; break }
      if (i % 5 === 0) console.log(`    …${i * 3}s status=${status}`)
    }
    if (published) ok(`conteúdo PUBLICADO via worker (mock) — status=${status}`)
    else bad(`não publicou no tempo (último status=${status}) — worker de pé? modo=mock?`)
  }

  step('History: /api/content lista a peça publicada')
  {
    const r = await req('GET', '/api/content', { token })
    const arr = Array.isArray(r.json) ? r.json : []
    const found = arr.find((c) => pick(c, 'id') === contentId)
    if (r.status === 200 && found) ok(`history contém a peça (status=${pick(found, 'status')})`)
    else bad(`history não contém a peça publicada (${arr.length} itens)`)
  }

  finish()
}

function finish() {
  console.log(`\n${'─'.repeat(48)}`)
  console.log(`Smoke FULL E2E: ${passed} ok, ${failed} falha(s).`)
  if (failed > 0) { console.log('Falhas:'); for (const f of fails) console.log(`  - ${f}`); process.exit(1) }
  console.log('Fluxo provado a vivo. ✓')
}

main().catch((e) => { console.error('ERRO FATAL:', e); process.exit(1) })
