import { describe, it, expect } from 'vitest'
import { required, url, futureDateTime, validate } from './validate'

// E9.4 — validadores puros (mensagem PT-BR exata ou null). Cobre os 3
// validadores + o uso composto que bloqueia o submit.

describe('required', () => {
  it('falha em vazio, null, undefined e só-espaços', () => {
    expect(required('')).toBe('Campo obrigatório.')
    expect(required(null)).toBe('Campo obrigatório.')
    expect(required(undefined)).toBe('Campo obrigatório.')
    expect(required('   ')).toBe('Campo obrigatório.')
  })
  it('passa quando há texto', () => {
    expect(required('x')).toBeNull()
    expect(required('  ok  ')).toBeNull()
  })
})

describe('url', () => {
  const MSG = 'Informe uma URL válida (começando com http:// ou https://).'
  it('considera vazio válido (opcional)', () => {
    expect(url('')).toBeNull()
    expect(url(null)).toBeNull()
    expect(url(undefined)).toBeNull()
    expect(url('   ')).toBeNull()
  })
  it('aceita http/https', () => {
    expect(url('http://exemplo.com')).toBeNull()
    expect(url('https://exemplo.com/foto.png')).toBeNull()
    expect(url('  https://exemplo.com  ')).toBeNull()
  })
  it('rejeita URL malformada ou protocolo não-web', () => {
    expect(url('exemplo.com')).toBe(MSG)
    expect(url('não é url')).toBe(MSG)
    expect(url('ftp://exemplo.com')).toBe(MSG)
    expect(url('javascript:alert(1)')).toBe(MSG)
  })
})

describe('futureDateTime', () => {
  it('considera vazio válido (opcional)', () => {
    expect(futureDateTime('')).toBeNull()
    expect(futureDateTime(null)).toBeNull()
    expect(futureDateTime(undefined)).toBeNull()
  })
  it('falha em data inválida', () => {
    expect(futureDateTime('não-é-data')).toBe('Informe uma data e hora válidas.')
  })
  it('falha quando a data está no passado', () => {
    const ontem = new Date(Date.now() - 86_400_000).toISOString()
    expect(futureDateTime(ontem)).toBe('Escolha uma data e hora no futuro.')
  })
  it('passa quando a data está no futuro', () => {
    const amanha = new Date(Date.now() + 86_400_000).toISOString()
    expect(futureDateTime(amanha)).toBeNull()
  })
})

describe('bloqueio de submit (uso composto)', () => {
  // Simula o que a tela faz: junta validações e bloqueia se houver erro.
  function valida(title: string, attach: string) {
    const errors = { title: validate.required(title), attachUrl: validate.url(attach) }
    return { errors, hasErrors: Object.values(errors).some((e) => e !== null) }
  }
  it('bloqueia com título vazio', () => {
    const r = valida('', '')
    expect(r.hasErrors).toBe(true)
    expect(r.errors.title).toBe('Campo obrigatório.')
  })
  it('bloqueia com URL de anexo malformada', () => {
    const r = valida('Título ok', 'não-url')
    expect(r.hasErrors).toBe(true)
    expect(r.errors.attachUrl).not.toBeNull()
  })
  it('libera quando tudo é válido', () => {
    const r = valida('Título ok', 'https://exemplo.com/x.png')
    expect(r.hasErrors).toBe(false)
  })
})
