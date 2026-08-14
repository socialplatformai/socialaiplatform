import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GeminiAPIClient } from './client.js'

// F1b (ADR-0014/A4) — structured output nativo do Gemini, GATED por GEMINI_STRUCTURED_OUTPUT.
// Provamos o contrato do REQUEST (o que vai no generationConfig), interceptando o fetch global.

const config = { apiKey: 'k-test', textModel: 'models/gemini-3.5-flash', imageModel: 'models/img', temperature: 1, maxOutputTokens: 1024 } as never

function mockFetchOnceJson(payload: unknown) {
  const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }], role: 'model' }, finishReason: 'STOP' }] })
  return vi.fn(async () => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }))
}

function capturedBody(spy: ReturnType<typeof vi.fn>): any {
  const init = spy.mock.calls[0][1] as RequestInit
  return JSON.parse(init.body as string)
}

const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }

describe('GeminiAPIClient.completeJSON — structured output (A4, flag-gated)', () => {
  const prevFlag = process.env.GEMINI_STRUCTURED_OUTPUT
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = mockFetchOnceJson({ ok: true })
    vi.stubGlobal('fetch', fetchSpy)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    if (prevFlag === undefined) delete process.env.GEMINI_STRUCTURED_OUTPUT
    else process.env.GEMINI_STRUCTURED_OUTPUT = prevFlag
  })

  it('flag OFF: NÃO envia responseSchema/responseMimeType (caminho atual, prompt-enhancement)', async () => {
    process.env.GEMINI_STRUCTURED_OUTPUT = 'false'
    const c = new GeminiAPIClient(config)
    await c.completeJSON('sys', 'user', { responseSchema: SCHEMA })
    const body = capturedBody(fetchSpy)
    expect(body.generationConfig.responseSchema).toBeUndefined()
    expect(body.generationConfig.responseMimeType).toBeUndefined()
    // sem flag, o system instruction recebe o reforço de regras de JSON
    expect(body.systemInstruction.parts[0].text).toContain('CRITICAL JSON RULES')
  })

  it('flag ON + schema: envia responseMimeType=application/json + responseSchema, e DISPENSA o reforço de prompt', async () => {
    process.env.GEMINI_STRUCTURED_OUTPUT = 'true'
    const c = new GeminiAPIClient(config)
    await c.completeJSON('sys', 'user', { responseSchema: SCHEMA })
    const body = capturedBody(fetchSpy)
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseSchema).toEqual(SCHEMA)
    expect(body.systemInstruction.parts[0].text).not.toContain('CRITICAL JSON RULES')
  })

  it('flag ON mas SEM schema: não força structured output (volta ao caminho atual)', async () => {
    process.env.GEMINI_STRUCTURED_OUTPUT = 'true'
    const c = new GeminiAPIClient(config)
    await c.completeJSON('sys', 'user')
    const body = capturedBody(fetchSpy)
    expect(body.generationConfig.responseSchema).toBeUndefined()
    expect(body.systemInstruction.parts[0].text).toContain('CRITICAL JSON RULES')
  })
})
