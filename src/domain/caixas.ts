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
 *   3. MEMÓRIA DA RUA: a rua (identidade + CEP) pertence a uma caixa;
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
