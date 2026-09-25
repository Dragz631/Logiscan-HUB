/**
 * REGIÕES OPERACIONAIS — mapa interno do LogiScan (não é a divisão oficial da cidade).
 *
 *   Região (ex.: Quinta do Caju)  →  Rua/logradouro (ex.: Travessa X)  →  Destino (nº + contexto)  →  Pacote
 *
 * - A associação rua → região é DADO aprendido (memória do HUB), nunca regra no código.
 * - Uma rua pertence a no máximo UMA região. Mudar de região é conflito: só com confirmação explícita.
 * - "Sem região" também é uma decisão lembrada (não pergunta de novo).
 * - Região nunca mexe no destino nem no pacote: são níveis diferentes.
 * O extractor não sabe nada disso — entrega a rua como está no card; quem identifica a região é o HUB.
 */

export interface Regiao {
  id: string;
  nome: string;
  criadaEm: string;
  criadaPor: string;
}

export interface Associacao {
  ruaChave: string;
  ruaNome: string;
  /** null = decidido "sem região". */
  regiaoId: string | null;
  definidaEm: string;
  definidaPor: string;
}

export type ResolucaoRegiao =
  | { status: 'conhecida'; regiaoId: string }
  | { status: 'sem_regiao' }
  | { status: 'desconhecida' };

export function resolverRegiao(a: Associacao | undefined): ResolucaoRegiao {
  if (!a) return { status: 'desconhecida' };
  return a.regiaoId === null ? { status: 'sem_regiao' } : { status: 'conhecida', regiaoId: a.regiaoId };
}

/**
 * O que fazer ao receber uma decisão "rua → região":
 *   nova      → rua ainda desconhecida: grava;
 *   igual     → já é isso: nada a fazer (idempotente);
 *   conflito  → já pertence a OUTRA decisão e não houve confirmação: vai para revisão;
 *   substituir→ conflito confirmado explicitamente: grava a nova e o histórico guarda a antiga.
 */
export function decidirAssociacao(
  atual: Associacao | undefined,
  regiaoId: string | null,
  substituirConfirmado: boolean,
): 'nova' | 'igual' | 'conflito' | 'substituir' {
  if (!atual) return 'nova';
  if (atual.regiaoId === regiaoId) return 'igual';
  return substituirConfirmado ? 'substituir' : 'conflito';
}

export interface EventoRegiao {
  id: string;
  ruaChave: string;
  tipo: 'REGIAO_DEFINIDA';
  dados: { rua: { chave: string; nome: string }; de: string | null | undefined; para: string | null };
  ator: string;
  ocorridoEm: string;
}
