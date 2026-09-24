/**
 * Utilitários de texto para a inteligência de endereço.
 * Tudo aqui é puro e determinístico (sem acesso a DOM, storage ou relógio).
 */

const MARCAS_COMBINANTES = /[̀-ͯ]/g;

/**
 * Remove acentos mantendo o MESMO comprimento do texto de entrada (NFC).
 * Isso permite achar padrões no texto "dobrado" e fatiar o texto original
 * (com acentos e maiúsculas) usando os mesmos índices.
 */
export function dobrarAcentos(texto: string): string {
  let saida = '';
  for (const ch of texto.normalize('NFC')) {
    const base = ch.normalize('NFD').replace(MARCAS_COMBINANTES, '');
    saida += base.length === ch.length ? base : ch;
  }
  return saida;
}

/** Colapsa espaços e normaliza para NFC. */
export function limparEspacos(texto: string | null | undefined): string {
  return (texto ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Chave de comparação: sem acento, minúscula, só letras/dígitos separados por 1 espaço. */
export function chaveTexto(texto: string | null | undefined): string {
  return dobrarAcentos(texto ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Primeira letra maiúscula, sem mexer no resto. */
export function capitalizarInicial(texto: string): string {
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto;
}
