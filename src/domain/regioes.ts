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

import { idLogradouro } from './destino/logradouro';
import { limparEspacos } from './destino/texto';

export interface Regiao {
  id: string;
  nome: string;
  criadaEm: string;
  criadaPor: string;
  /** true = no repasse a região inteira vale como UMA rua (ex.: "Diversos"). */
  repasseUnico: boolean;
  /** CAIXA oficial (V0.5): número como o Hugo chama ("1", "1.2", "10.1"); null = região sem número. */
  numero: string | null;
  /** Ordem de exibição das caixas. */
  ordem: number | null;
  /** Caixa que agrupa esta (ex.: "Associações" agrupa as 4 associações). */
  paiId: string | null;
}

export interface Associacao {
  ruaChave: string;
  ruaNome: string;
  /** null = decidido "sem região". */
  regiaoId: string | null;
  /**
   * Especificidade DENTRO da região (menor = mais específica). Ex.: na Manilha, "Rua B" (1) é mais
   * específica que "Rua Leão XIII" (2). null = sem prioridade configurada. É dado, não regra no código.
   */
  prioridade: number | null;
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

export type EventoRegiao =
  | {
      id: string;
      ruaChave: string;
      tipo: 'REGIAO_DEFINIDA';
      dados: {
        rua: { chave: string; nome: string };
        de: string | null | undefined;
        para: string | null;
        /** Mudança de especificidade (quando houve). */
        prioridade?: { de: number | null | undefined; para: number | null };
      };
      ator: string;
      ocorridoEm: string;
    }
  /** Caixa configurada pelo catálogo (nome/número/agrupamento). `ruaChave` = `caixa:<id>`. */
  | {
      id: string;
      ruaChave: string;
      tipo: 'CAIXA_CONFIGURADA';
      dados: { caixa: string; de: { nome: string; numero: string | null; paiId: string | null }; para: { nome: string; numero: string | null; paiId: string | null } };
      ator: string;
      ocorridoEm: string;
    };

// ---------------------------------------------------------------------------
// Rua operacional (conhecimento configurável de especificidade)
// ---------------------------------------------------------------------------


export interface RuaConhecida {
  chave: string;
  nome: string;
  regiaoId: string | null;
  prioridade: number | null;
}

/** Menciona o logradouro como palavras inteiras? ("rua b" não casa com "rua barao"). */
function menciona(texto: string, chave: string): boolean {
  return ` ${texto} `.includes(` ${chave} `);
}

/**
 * Qual é a RUA OPERACIONAL do pacote, quando a J&T mistura referências.
 * Regra (toda vinda de DADO configurado):
 *  - parte da rua escrita no card;
 *  - se ela é conhecida numa região com prioridade P, e o endereço (rua + complemento) cita outra rua
 *    conhecida DA MESMA REGIÃO com prioridade MENOR (mais específica), a mais específica vence.
 *    Ex.: Manilha, "Rua Leão XIII" + complemento "Rua B casa 5" → "Rua B".
 *  - empate entre duas mais específicas, rua desconhecida ou região diferente → não inventa: fica a do card.
 * Não mexe em destino (nº/contexto): só decide em qual RUA o pacote é organizado/repassado.
 */
export function ruaOperacional(
  dados: { rua: string; complemento: string },
  conhecidas: ReadonlyMap<string, RuaConhecida>,
): { chave: string; nome: string; ajustada: boolean } {
  const nomeCard = limparEspacos(dados.rua);
  const chaveCard = idLogradouro(nomeCard);
  const base = conhecidas.get(chaveCard);
  if (!base || base.regiaoId === null) return { chave: chaveCard, nome: nomeCard, ajustada: false };
  const texto = idLogradouro(`${dados.rua} ${dados.complemento}`);
  const limite = base.prioridade ?? Number.POSITIVE_INFINITY;
  const candidatas = [...conhecidas.values()].filter(
    (r) => r.regiaoId === base.regiaoId && r.chave !== base.chave && r.prioridade !== null && r.prioridade < limite && menciona(texto, r.chave),
  );
  if (candidatas.length === 0) return { chave: base.chave, nome: nomeCard, ajustada: false };
  const menor = Math.min(...candidatas.map((r) => r.prioridade!));
  const vencedoras = candidatas.filter((r) => r.prioridade === menor);
  if (vencedoras.length !== 1) return { chave: base.chave, nome: nomeCard, ajustada: false }; // conflito: não inventa
  return { chave: vencedoras[0].chave, nome: vencedoras[0].nome, ajustada: true };
}
