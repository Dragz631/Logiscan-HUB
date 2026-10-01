/**
 * ASSOCIAÇÕES — a lista de pessoas e de pacotes de cada associação (10.1 Chatuba, 10.2 São Sebastião…).
 *
 * O HUB já distribui sozinho quem ele lembra (memória por pessoa: nome + rua → caixa). O que ele não sabe
 * continua SEM CAIXA, na Triagem, esperando o Hugo: aqui só aparece um aviso com a conta. A lista de cada
 * associação é a que o Hugo manda para as mulheres de lá (copiar para o WhatsApp ou imprimir).
 */
import { type PessoaDaLista, agruparPessoas } from '../domain/listaAssociacao';
import type { Pacote } from '../domain/pacote';
import { ErroAplicacao } from './erros';
import type { Contexto } from './portas';
import { resolvedorDeCaixa } from './regioes';
import { pacotesDaOperacao } from './triagem';

/** Número da caixa que AGRUPA as associações no catálogo. As filhas dela são as associações. */
export const NUMERO_DO_GRUPO_ASSOCIACOES = '10';
const MAX_RESPONSAVEL = 60;

export interface AssociacaoComLista {
  caixaId: string;
  numero: string | null;
  nome: string;
  /** "A/C" do cabeçalho da lista (null = não informado). */
  responsavel: string | null;
  totalPacotes: number;
  totalPessoas: number;
  pessoas: PessoaDaLista[];
}

export interface ListasDasAssociacoes {
  associacoes: AssociacaoComLista[];
  /** Pacotes (de qualquer caixa) que ainda esperam a Triagem: o HUB nunca chuta a associação. */
  aguardandoRevisao: number;
}

function filhasDoGrupo(ctx: Contexto) {
  const regioes = ctx.armazem.regioes.listar();
  const grupo = regioes.find((r) => r.numero === NUMERO_DO_GRUPO_ASSOCIACOES);
  return grupo ? regioes.filter((r) => r.paiId === grupo.id) : [];
}

/** Uma lista por associação, só com os pacotes que estão na operação (DEVOLVIDO e já baixados ficam de fora). */
export function listasDasAssociacoes(ctx: Contexto): ListasDasAssociacoes {
  const caixaDe = resolvedorDeCaixa(ctx);
  const porCaixa = new Map<string, Pacote[]>();
  let aguardandoRevisao = 0;
  for (const p of pacotesDaOperacao(ctx)) {
    const c = caixaDe(p);
    if (!c.caixa) {
      aguardandoRevisao++;
      continue;
    }
    if (!porCaixa.has(c.caixa.id)) porCaixa.set(c.caixa.id, []);
    porCaixa.get(c.caixa.id)!.push(p);
  }
  const associacoes = filhasDoGrupo(ctx).map((f) => {
    const pacotes = porCaixa.get(f.id) ?? [];
    const pessoas = agruparPessoas(pacotes.map((p) => ({ id: p.id, destinatario: p.dados.destinatario, rua: p.dados.rua })));
    return {
      caixaId: f.id,
      numero: f.numero,
      nome: f.nome,
      responsavel: f.responsavel ?? null,
      totalPacotes: pacotes.length,
      totalPessoas: pessoas.length,
      pessoas,
    };
  });
  return { associacoes, aguardandoRevisao };
}

/** Quem recebe a lista na associação ("A/C"). Vazio apaga. Só vale para as associações (filhas da caixa 10). */
export function definirResponsavelDaAssociacao(ctx: Contexto, caixaId: string, responsavel: string): AssociacaoComLista['responsavel'] {
  const caixa = ctx.armazem.regioes.porId(caixaId);
  if (!caixa) throw new ErroAplicacao('REGIAO_INEXISTENTE', 'associação não encontrada', 404);
  if (!filhasDoGrupo(ctx).some((f) => f.id === caixa.id)) {
    throw new ErroAplicacao('NAO_E_ASSOCIACAO', `${caixa.nome} não é uma associação: o responsável da lista só vale para elas`, 409);
  }
  const texto = (typeof responsavel === 'string' ? responsavel : '').replace(/\s+/g, ' ').trim();
  if (texto.length > MAX_RESPONSAVEL) throw new ErroAplicacao('ENTRADA_INVALIDA', `responsavel: no máximo ${MAX_RESPONSAVEL} caracteres`);
  const novo = texto || null;
  ctx.armazem.regioes.definirResponsavel(caixa.id, novo);
  return novo;
}
