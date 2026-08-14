import { describe, it, expect } from 'vitest'
import { loadAiConfig, AI_DEFAULTS } from './config.js'

// E5.2 — config tipada como FONTE ÚNICA DA VERDADE. Trocar modelo/params é env,
// não código. Os testes injetam um env falso (loadAiConfig é puro em env).

describe('loadAiConfig — defaults', () => {
  it('usa os defaults quando o env está vazio (== comportamento atual)', () => {
    const c = loadAiConfig({})
    expect(c.textProvider).toBe('gemini')
    expect(c.imageProvider).toBe('gemini')
    expect(c.model.text).toBe(AI_DEFAULTS.textModel)
    expect(c.model.image).toBe(AI_DEFAULTS.imageModel)
    expect(c.temperature).toBe(AI_DEFAULTS.temperature)
    expect(c.maxTokens).toBe(AI_DEFAULTS.maxTokens)
    expect(c.apiKey).toBe('')
  })
})

describe('loadAiConfig — modelo trocável por env (aceite E5.2)', () => {
  it('AI_TEXT_MODEL troca o modelo de texto sem editar código', () => {
    const c = loadAiConfig({ AI_TEXT_MODEL: 'models/meu-modelo-x' })
    expect(c.model.text).toBe('models/meu-modelo-x')
    // não contamina o de imagem
    expect(c.model.image).toBe(AI_DEFAULTS.imageModel)
  })

  it('AI_IMAGE_MODEL troca o modelo de imagem', () => {
    const c = loadAiConfig({ AI_IMAGE_MODEL: 'models/img-y' })
    expect(c.model.image).toBe('models/img-y')
  })

  it('string vazia/whitespace cai no default (não vira modelo vazio)', () => {
    expect(loadAiConfig({ AI_TEXT_MODEL: '   ' }).model.text).toBe(AI_DEFAULTS.textModel)
    expect(loadAiConfig({ AI_TEXT_MODEL: '' }).model.text).toBe(AI_DEFAULTS.textModel)
  })
})

describe('loadAiConfig — params e provider', () => {
  it('AI_TEMPERATURE e AI_MAX_TOKENS são lidos como número', () => {
    const c = loadAiConfig({ AI_TEMPERATURE: '0.2', AI_MAX_TOKENS: '4096' })
    expect(c.temperature).toBe(0.2)
    expect(c.maxTokens).toBe(4096)
  })

  it('valor numérico inválido cai no default (sem NaN no pipeline)', () => {
    const c = loadAiConfig({ AI_TEMPERATURE: 'quente', AI_MAX_TOKENS: 'muitos' })
    expect(c.temperature).toBe(AI_DEFAULTS.temperature)
    expect(c.maxTokens).toBe(AI_DEFAULTS.maxTokens)
  })

  it('TEXT_PROVIDER seleciona o provider; AI_PROVIDER é fallback', () => {
    expect(loadAiConfig({ TEXT_PROVIDER: 'openai' }).textProvider).toBe('openai')
    expect(loadAiConfig({ AI_PROVIDER: 'openai' }).textProvider).toBe('openai')
    // TEXT_PROVIDER vence AI_PROVIDER
    expect(loadAiConfig({ TEXT_PROVIDER: 'gemini', AI_PROVIDER: 'openai' }).textProvider).toBe('gemini')
  })

  it('provider desconhecido cai no default gemini (não quebra)', () => {
    expect(loadAiConfig({ TEXT_PROVIDER: 'inexistente' }).textProvider).toBe('gemini')
  })

  it('apiKey: AI_PROVIDER_KEY tem prioridade sobre GEMINI_API_KEY', () => {
    expect(loadAiConfig({ AI_PROVIDER_KEY: 'a', GEMINI_API_KEY: 'b' }).apiKey).toBe('a')
    expect(loadAiConfig({ GEMINI_API_KEY: 'b' }).apiKey).toBe('b')
  })
})
