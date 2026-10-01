/**
 * CAIXAS — a mesa de triagem do Hugo.
 *
 *   saca de pacotes  →  cada pacote vai para uma CAIXA  →  a caixa inteira vai para um ajudante
 *
 * A caixa é uma região operacional com número ("1", "1.2", "10.1"): uma rua (Carlos Seidl), um lugar com
 * ruas dentro (Manilha, Quinta do Caju, Vila Militar) ou uma associação. "Associações" agrupa as 4 associações.
 *
 * Em qual caixa um pacote fica (do mais forte para o mais fraco):
 *   1. o Hugo decidiu À MÃO para esse pacote (evento CAIXA_DEFINIDA);
 *   2. MEMÓRIA DA PESSOA: a mesma pessoa (nome) na mesma rua já foi para uma caixa — ela manda
 *      (ex.: endereço na Carlos Seidl, mas entregue na associação);
 *   3. MEMÓRIA DA RUA: a rua (identidade + CEP) pertence a uma caixa — MAS, se o complemento do pacote cita o
 *      nome de OUTRA caixa (ex.: rua Carlos Seidl, complemento "Deposito do Letinho manilha"), o HUB não
 *      decide "pela rua": pergunta ao Hugo (É Carlos Seidl ou Manilha?) e a resposta vira memória da pessoa;
 *   4. senão: SEM CAIXA → revisão do Hugo na triagem. Nunca chuta.
 */
import { chaveTexto } from './destino/texto';

/** A mesma pessoa = mesmo nome (sem acento/maiúscula/pontuação) na mesma rua (street_id). */
export function chavePessoa(nome: string, ruaId: string): string {
  const n = chaveTexto(nome);
  return n && ruaId ? `${n}|${ruaId}` : '';
}

export interface MemoriaPessoa {
  chave: string;
  nome: string;
  ruaId: string;
  ruaNome: string;
  cep: string;
  caixaId: string;
  definidaEm: string;
  definidaPor: string;
}

export interface EventoPessoa {
  id: string;
  chave: string;
  tipo: 'PESSOA_NA_CAIXA';
  dados: { nome: string; rua: { id: string; nome: string }; de: string | null; para: string; pacote?: { id: string; codigo: string } };
  ator: string;
  ocorridoEm: string;
}

export type OrigemCaixa = 'manual' | 'pessoa' | 'rua';

const PALAVRAS_DE_RUA = new Set(['rua', 'avenida', 'av', 'travessa', 'tv', 'beco', 'alameda', 'estrada', 'praca', 'associacao']);
const LIGACOES = new Set(['da', 'do', 'de', 'dos', 'das', 'e']);
/** Termo curto demais ("canal", "f") aparece em qualquer frase: não serve para reconhecer uma caixa. */
const MINIMO_DO_TERMO = 6;

/**
 * Como o complemento de um pacote costuma CITAR uma caixa ou uma rua: o nome sem a palavra de rua e sem as
 * ligações do começo. "Rua Carlos Seidl" → "carlos seidl"; "Associação da Chatuba" → "chatuba"; "Manilha" → "manilha".
 * Devolve '' se sobrar pouca coisa (genérico demais).
 */
export function termoDoNome(nome: string): string {
  const palavras = chaveTexto(nome).split(' ').filter(Boolean);
  while (palavras.length > 0 && (PALAVRAS_DE_RUA.has(palavras[0]) || LIGACOES.has(palavras[0]))) palavras.shift();
  const termo = palavras.join(' ');
  return termo.length >= MINIMO_DO_TERMO ? termo : '';
}

/**
 * Quais das caixas candidatas o complemento cita (por nome, como palavra inteira). Ignora `exceto` (a caixa em
 * que o pacote já está: citar a própria caixa não é dúvida). Complemento comum ("Casa 2", "Loja ABC") não cita ninguém.
 */
export function caixasCitadas(
  complemento: string,
  candidatas: { id: string; termos: string[] }[],
  exceto: string,
): string[] {
  const texto = ` ${chaveTexto(complemento)} `;
  if (texto.trim() === '') return [];
  return candidatas.filter((c) => c.id !== exceto && c.termos.some((t) => texto.includes(` ${t} `))).map((c) => c.id);
}

/** Decide a caixa com a precedência acima (função pura; quem chama fornece as memórias). */
export function decidirCaixa(entrada: {
  manual: string | null;
  pessoa: string | null;
  rua: string | null;
  existe: (id: string) => boolean;
}): { caixaId: string; origem: OrigemCaixa } | null {
  if (entrada.manual && entrada.existe(entrada.manual)) return { caixaId: entrada.manual, origem: 'manual' };
  if (entrada.pessoa && entrada.existe(entrada.pessoa)) return { caixaId: entrada.pessoa, origem: 'pessoa' };
  if (entrada.rua && entrada.existe(entrada.rua)) return { caixaId: entrada.rua, origem: 'rua' };
  return null;
}
