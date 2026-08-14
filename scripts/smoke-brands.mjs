#!/usr/bin/env node
// smoke-brands.mjs — verificação E2E do isolamento de MARCA sobre HTTP (FASE 2 / E1).
// Prova o gate: 2 marcas no mesmo workspace isoladas; X-Brand-Id de outro workspace → 403.
// Assume a API no ar (:5080). Só fetch nativo. Exit 0 = tudo verde, 1 = falha.

const BASE = process.env.API_URL || 'http://localhost:5080'
let pass = 0, fail = 0
const fails = []
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; fails.push(m); console.log(`  ✗ ${m}`) }
const step = (n) => console.log(`\n▸ ${n}`)

async function req(method, path, { token, brand, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (brand) headers['X-Brand-Id'] = brand
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json }
}
const pick = (o, ...ks) => { for (const k of ks) { if (o?.[k] !== undefined) return o[k]; const l = k[0].toLowerCase()+k.slice(1); if (o?.[l] !== undefined) return o[l] } return undefined }

async function registrar(suffix) {
  const stamp = `${Date.now()}-${Math.floor(Math.random()*1e6)}-${suffix}`
  const r = await req('POST', '/api/auth/register', { body: { email: `brandsmoke+${stamp}@example.com`, password: 'smoke-pass-12345', name: 'BS', workspaceName: `WS ${suffix}` } })
  return { token: pick(r.json, 'accessToken'), status: r.status }
}

async function main() {
  console.log(`Smoke de MARCAS contra ${BASE}`)

  step('Health')
  try { const h = await req('GET', '/health'); h.status === 200 ? ok('health 200') : bad(`health ${h.status}`) }
  catch (e) { bad(`API fora do ar? ${e.message}`); return finish() }

  step('Registrar workspace A')
  const A = await registrar('A')
  if (!A.token) { bad(`register A falhou (${A.status})`); return finish() }
  ok('workspace A registrado')

  // Toda conta nasce com 1 marca-default (backfill / criação no registro).
  step('Workspace A tem marca-default')
  let defaultBrand = null
  {
    const r = await req('GET', '/api/brands', { token: A.token })
    const arr = Array.isArray(r.json) ? r.json : []
    defaultBrand = pick(arr[0] ?? {}, 'id')
    if (r.status === 200 && arr.length >= 1 && defaultBrand) ok(`marca-default presente (${arr.length} marca[s])`)
    else bad(`esperava ≥1 marca-default, veio ${r.status} (${arr.length})`)
  }
  if (!defaultBrand) return finish()

  step('Criar marca B no workspace A')
  let brandB = null
  {
    const r = await req('POST', '/api/brands', { token: A.token, body: { name: 'Marca B' } })
    brandB = pick(r.json, 'id')
    ;(r.status === 200 || r.status === 201) && brandB ? ok(`marca B criada (${brandB})`) : bad(`criar marca B: ${r.status}`)
  }
  if (!brandB) return finish()

  step('Criar pauta na marca-default e outra na marca B')
  {
    const rA = await req('POST', '/api/pautas', { token: A.token, brand: defaultBrand, body: { title: 'Pauta default', priority: 1, desiredType: 1 } })
    const rB = await req('POST', '/api/pautas', { token: A.token, brand: brandB, body: { title: 'Pauta da B', priority: 1, desiredType: 1 } })
    const okA = (rA.status === 200 || rA.status === 201) && pick(rA.json, 'id')
    const okB = (rB.status === 200 || rB.status === 201) && pick(rB.json, 'id')
    okA && okB ? ok('duas pautas criadas (uma por marca)') : bad(`criar pautas: default ${rA.status}, B ${rB.status}`)
  }

  step('Isolamento cross-brand: cada marca só vê a sua pauta')
  {
    const lA = await req('GET', '/api/pautas', { token: A.token, brand: defaultBrand })
    const lB = await req('GET', '/api/pautas', { token: A.token, brand: brandB })
    const titlesA = (Array.isArray(lA.json) ? lA.json : []).map(p => pick(p, 'title'))
    const titlesB = (Array.isArray(lB.json) ? lB.json : []).map(p => pick(p, 'title'))
    const isolA = titlesA.length === 1 && titlesA[0] === 'Pauta default'
    const isolB = titlesB.length === 1 && titlesB[0] === 'Pauta da B'
    if (isolA && isolB) ok('marca-default vê só a sua; marca B vê só a sua')
    else bad(`vazamento cross-brand: default=${JSON.stringify(titlesA)} B=${JSON.stringify(titlesB)}`)
  }

  step('Cross-workspace: X-Brand-Id de outro workspace → 403')
  {
    const B = await registrar('OUTRO')
    if (!B.token) { bad('register do 2º workspace falhou'); return finish() }
    const rOutro = await req('GET', '/api/brands', { token: B.token })
    const brandDoOutro = pick((Array.isArray(rOutro.json) ? rOutro.json : [])[0] ?? {}, 'id')
    // Workspace A tenta usar a marca do workspace B no header → deve dar 403.
    const r = await req('GET', '/api/pautas', { token: A.token, brand: brandDoOutro })
    r.status === 403 ? ok('marca de outro workspace no header → 403') : bad(`esperava 403, veio ${r.status}`)
  }

  step('Bloqueio: não remover a última marca')
  {
    // Cria um workspace fresco (só a default) e tenta remover a default → 400.
    const C = await registrar('UNICA')
    const rl = await req('GET', '/api/brands', { token: C.token })
    const only = pick((Array.isArray(rl.json) ? rl.json : [])[0] ?? {}, 'id')
    const del = await req('DELETE', `/api/brands/${only}`, { token: C.token })
    del.status === 400 ? ok('remover a última marca → 400 (bloqueado)') : bad(`esperava 400, veio ${del.status}`)
  }

  finish()
}

function finish() {
  console.log(`\n${'─'.repeat(40)}\nSmoke MARCAS: ${pass} ok, ${fail} falha(s).`)
  if (fail > 0) { console.log('Falhas:'); fails.forEach(f => console.log(`  - ${f}`)); process.exit(1) }
  console.log('Tudo verde. ✓'); process.exit(0)
}

main().catch((e) => { console.error(`Erro fatal: ${e.stack || e.message}`); process.exit(1) })
