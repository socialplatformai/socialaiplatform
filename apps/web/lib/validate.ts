// E9.4 — validação inline padronizada. Validadores PUROS: recebem o valor cru
// do controle e retornam uma mensagem PT-BR clara OU `null` (sem erro). Sem libs
// (o ADR-0007 rejeitou RHF/Zod por KISS). As telas compõem
// `{ campo: validate.required(v) }` e o `<Field error>` exibe; o submit é
// bloqueado quando há qualquer mensagem não-nula.

/** Obrigatório: falha em vazio/só-espaços. */
export function required(value: string | null | undefined): string | null {
  return value && value.trim().length > 0 ? null : "Campo obrigatório.";
}

/**
 * URL: vazio é considerado válido (use `required` em conjunto se o campo for
 * obrigatório). Aceita apenas http/https — é o que os anexos/refs precisam.
 */
export function url(value: string | null | undefined): string | null {
  if (!value || value.trim().length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return "Informe uma URL válida (começando com http:// ou https://).";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Informe uma URL válida (começando com http:// ou https://).";
  }
  return null;
}

/**
 * Data/hora no futuro: vazio é válido (combine com `required` se obrigatório).
 * Aceita o valor de um <input type="datetime-local"> (ou qualquer string
 * parseável por Date). Falha se a data for inválida ou não estiver no futuro.
 */
export function futureDateTime(value: string | null | undefined): string | null {
  if (!value || value.trim().length === 0) return null;
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return "Informe uma data e hora válidas.";
  if (t <= Date.now()) return "Escolha uma data e hora no futuro.";
  return null;
}

export const validate = { required, url, futureDateTime };
