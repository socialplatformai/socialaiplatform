import { describe, it, expect, vi, afterEach } from 'vitest'
import { GeminiAPIClient } from './client.js'

// 🔴 SEGURANÇA (B/ADR-0008, §6.6) — a chave de IA por workspace NÃO pode vazar em log.
// Com B4 (chave por workspace) o GeminiAPIClient é construído com a chave de CADA tenant;
// qualquer console.log/console.error que ecoe (mesmo um prefixo d)a chave passa a expor
// segredo de tenant no log compartilhado do container agents. Estes testes provam o
// invariante e travam a regressão (foi um furo BLOQUEADOR pego na verificação adversarial).

const SEGREDO = 'AIzaSyD-SEGREDO-DO-WORKSPACE-NUNCA-LOGAR-123456'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GeminiAPIClient — a chave nunca vaza em log (invariante de segredo §6.6)', () => {
  it('o construtor NÃO loga nenhum trecho da chave (nem prefixo)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    new GeminiAPIClient({
      apiKey: SEGREDO,
      textModel: 'models/gemini-flash-latest',
      imageModel: 'models/gemini-2.5-flash-image',
      temperature: 0.7,
      maxOutputTokens: 16384,
    })

    const tudo = [...logSpy.mock.calls, ...errSpy.mock.calls].flat().join(' ')
    // Nenhum prefixo de 6+ chars da chave pode aparecer no log.
    expect(tudo).not.toContain(SEGREDO.slice(0, 6))
    expect(tudo).not.toContain(SEGREDO.slice(0, 10))
    expect(tudo).not.toContain(SEGREDO)
  })

  it('o construtor com chave inválida (models/...) NÃO ecoa a chave no erro', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const chaveInvalida = 'models/algo-que-parece-chave-mas-nao-e-SEGREDO'

    expect(
      () =>
        new GeminiAPIClient({
          apiKey: chaveInvalida,
          textModel: 'm',
          imageModel: 'i',
          temperature: 0.7,
          maxOutputTokens: 16384,
        }),
    ).toThrow(/API key/i)

    const tudo = errSpy.mock.calls.flat().join(' ')
    expect(tudo).not.toContain(chaveInvalida.slice(0, 12))
  })
})
