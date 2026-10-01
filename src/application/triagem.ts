/**
 * TRIAGEM — "jogar cada pacote na caixa certa".
 *
 * O HUB já coloca sozinho o que sabe (memória da pessoa ou da rua). O que não sabe fica SEM CAIXA e
 * espera a revisão do Hugo. A decisão dele vira memória:
 *   - classificarRua     → "esta rua vai nesta caixa" (vale para todos os pacotes dela, hoje e amanhã);
 *   - classificarPacote  → "este pacote/pessoa vai nesta caixa" (exceção da pessoa: ex.: endereço na
 *                          Carlos Seidl, entregue na associação). Grava CAIXA_DEFINIDA no pacote e
 *                          a memória da pessoa (nome + rua).
 * Mudar uma decisão já tomada é CONFLITO: só com confirmação explícita, e fica no histórico.
 */
import { type CaixaRef, ErroDominio } from '../domain/eventos';
import type { Pacote } from '../domain/pacote';
import type { Regiao } from '../domain/regioes';
import { naOperacao } from '../domain/ruas';
import { ErroAplicacao } from './erros';
import { refCaixa } from './orquestracao';
import type { Contexto } from './portas';
import { type ResultadoDefinicao, definirRegiao, resolvedorDeCaixa } from './regioes';
import { registrarEvento } from './registrarEvento';

export interface PacoteTriagem {
  id: string;
  codigo: string;
  destinatario: string;
  /** Como veio da J&T. */
  rua: string;
  numero: string;
  complemento: string;
  cep: string;
  caixa: CaixaRef | null;
  /** "Retornado · do dia 26/09": AAAA-MM-DD de onde voltou para a caixa (null = não é retornado). */
  retornadoDia: string | null;
  /** Por que está nessa caixa: à mão, memória da pessoa ou da rua. */
  origem: 'manual' | 'pessoa' | 'rua' | null;
  /** Ainda no galpão, fora de carga: dá para mudar a caixa. */
  podeMover: boolean;
}

export interface RuaSemCaixa {
  /** Chave da rua (street_id) para "esta rua vai nesta caixa". */
  ruaChave: string;
  ruaNome: string;
  ceps: string[];
  pacotes: PacoteTriagem[];
}

export interface CaixaNaTriagem {
  id: string;
  numero: string | null;
  nome: string;
  paiId: string | null;
  /** Caixa que só agrupa outras (Associações): não recebe pacote direto. */
  agrupa: boolean;
  total: number;
}

export interface VisaoTriagem {
  caixas: CaixaNaTriagem[];
  semCaixa: RuaSemCaixa[];
  totalPacotes: number;
  nasCaixas: number;
  aguardandoRevisao: number;
}

const podeMover = (p: Pacote) => p.cargaId === null && (p.estado === 'NAO_ATRIBUIDO' || p.estado === 'ATRIBUIDO' || p.estado === 'RETORNADO');

export function pacotesDaOperacao(ctx: Contexto): Pacote[] {
  const ativas = ctx.armazem.cargas.idsAtivas();
  return ctx.armazem.pacotes.listar().filter((p) => naOperacao(p, ativas));
}

function linha(p: Pacote, c: { caixa: Regiao | null; origem: PacoteTriagem['origem'] }): PacoteTriagem {
  return {
    id: p.id,
    codigo: p.codigo,
    destinatario: p.dados.destinatario,
    rua: p.dados.rua,
    numero: p.dados.numero,
    complemento: p.dados.complemento,
    cep: p.dados.cep,
    caixa: c.caixa ? refCaixa(c.caixa) : null,
    retornadoDia: p.retornadoDe?.dia ?? null,
    origem: c.origem,
    podeMover: podeMover(p),
  };
}

const numeroOrdem = (n: string) => {
  const m = /\d+/.exec(n);
  return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
};

/** A mesa de triagem: caixas com a contagem e o que ainda está sem caixa (por rua). */
export function visaoTriagem(ctx: Contexto): VisaoTriagem {
  const caixaDe = resolvedorDeCaixa(ctx);
  const regioes = ctx.armazem.regioes.listar();
  const agrupam = new Set(regioes.map((r) => r.paiId).filter((id): id is string => !!id));
  const contagem = new Map<string, number>();
  const sem = new Map<string, RuaSemCaixa>();
  const pacotes = pacotesDaOperacao(ctx);
  for (const p of pacotes) {
    const c = caixaDe(p);
    if (c.caixa) {
      contagem.set(c.caixa.id, (contagem.get(c.caixa.id) ?? 0) + 1);
      continue;
    }
    if (!sem.has(c.rua.chave)) sem.set(c.rua.chave, { ruaChave: c.rua.chave, ruaNome: c.rua.nome, ceps: [], pacotes: [] });
    const g = sem.get(c.rua.chave)!;
    g.pacotes.push(linha(p, c));
    if (p.dados.cep && !g.ceps.includes(p.dados.cep)) g.ceps.push(p.dados.cep);
  }
  for (const g of sem.values()) g.pacotes.sort((a, b) => numeroOrdem(a.numero) - numeroOrdem(b.numero) || a.numero.localeCompare(b.numero));
  const semCaixa = [...sem.values()].sort((a, b) => b.pacotes.length - a.pacotes.length || a.ruaNome.localeCompare(b.ruaNome, 'pt-BR'));
  const aguardando = semCaixa.reduce((n, g) => n + g.pacotes.length, 0);
  return {
    caixas: regioes.map((r) => ({
      id: r.id, numero: r.numero, nome: r.nome, paiId: r.paiId, agrupa: agrupam.has(r.id), total: contagem.get(r.id) ?? 0,
    })),
    semCaixa,
    totalPacotes: pacotes.length,
    nasCaixas: pacotes.length - aguardando,
    aguardandoRevisao: aguardando,
  };
}

/** O que está dentro de uma caixa (para conferir e "mover para…" a exceção da pessoa). */
export function pacotesDaCaixa(ctx: Contexto, caixaId: string): PacoteTriagem[] {
  if (!ctx.armazem.regioes.porId(caixaId)) throw new ErroAplicacao('REGIAO_INEXISTENTE', 'caixa não encontrada', 404);
  const caixaDe = resolvedorDeCaixa(ctx);
  return pacotesDaOperacao(ctx)
    .map((p) => ({ p, c: caixaDe(p) }))
    .filter(({ c }) => c.caixa?.id === caixaId)
    .map(({ p, c }) => linha(p, c))
    .sort((a, b) => a.rua.localeCompare(b.rua, 'pt-BR') || numeroOrdem(a.numero) - numeroOrdem(b.numero));
}

function caixaQueRecebe(ctx: Contexto, caixaId: string): Regiao {
  const caixa = ctx.armazem.regioes.porId(caixaId);
  if (!caixa) throw new ErroAplicacao('REGIAO_INEXISTENTE', 'caixa não encontrada', 404);
  if (ctx.armazem.regioes.listar().some((r) => r.paiId === caixa.id)) {
    throw new ErroAplicacao('CAIXA_QUE_AGRUPA', `${caixa.nome} agrupa outras caixas: escolha uma delas`, 409);
  }
  return caixa;
}

/** "Esta rua vai nesta caixa" — vale para todos os pacotes dela (memória da rua). */
export function classificarRua(
  ctx: Contexto,
  entrada: { rua: string; caixaId: string; ator: string; substituir?: boolean },
): ResultadoDefinicao {
  caixaQueRecebe(ctx, entrada.caixaId);
  return definirRegiao(ctx, { rua: entrada.rua, regiaoId: entrada.caixaId, ator: entrada.ator, substituir: entrada.substituir });
}

export type ResultadoClassificacao =
  | { ok: true; mudou: boolean }
  | { ok: false; conflito: { pessoa: string; rua: string; atual: CaixaRef } };

/**
 * "Este pacote (esta pessoa) vai nesta caixa". Grava o evento no pacote e a memória da pessoa (nome + rua):
 * na próxima vez que a mesma pessoa vier na mesma rua, o HUB já coloca sozinho.
 */
export function classificarPacote(
  ctx: Contexto,
  entrada: { pacoteId: string; caixaId: string; ator: string; substituir?: boolean; motivo?: string },
): ResultadoClassificacao {
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const p = armazem.pacotes.porId(entrada.pacoteId);
    if (!p) throw new ErroAplicacao('PACOTE_INEXISTENTE', 'pacote não encontrado', 404);
    if (!podeMover(p)) {
      throw new ErroAplicacao('JA_SAIU_DA_TRIAGEM', `pacote ${p.codigo} já está numa carga: a caixa só muda na triagem, antes do repasse`, 409);
    }
    const caixa = caixaQueRecebe(ctx, entrada.caixaId);
    const c = resolvedorDeCaixa(ctx)(p);
    const memoria = c.pessoa ? armazem.pessoas.porChave(c.pessoa) : undefined;
    if (memoria && memoria.caixaId !== caixa.id && !entrada.substituir) {
      const atual = armazem.regioes.porId(memoria.caixaId);
      return { ok: false, conflito: { pessoa: p.dados.destinatario, rua: c.rua.nome, atual: atual ? refCaixa(atual) : { id: memoria.caixaId, numero: null, nome: '?' } } };
    }
    const agora = ctx.relogio.agora();
    let mudou = false;
    if (p.caixaId !== caixa.id) {
      try {
        registrarEvento(armazem, {
          id: ctx.ids.novo(), pacoteId: p.id, tipo: 'CAIXA_DEFINIDA',
          dados: { caixa: refCaixa(caixa), anterior: c.caixa ? refCaixa(c.caixa) : null, motivo: entrada.motivo?.trim() ?? '' },
          ator: entrada.ator, origem: 'hub', ocorridoEm: agora, registradoEm: agora,
          chaveIdempotencia: `caixa:${p.id}:${caixa.id}:${p.versao}`,
        });
      } catch (e) {
        if (e instanceof ErroDominio) throw new ErroAplicacao(e.codigo, `pacote ${p.codigo}: ${e.message}`, 409);
        throw e;
      }
      mudou = true;
    }
    if (c.pessoa && memoria?.caixaId !== caixa.id) {
      armazem.pessoas.definir({
        chave: c.pessoa, nome: p.dados.destinatario, ruaId: c.pessoa.split('|')[1] ?? c.rua.chave, ruaNome: c.rua.nome,
        cep: p.dados.cep, caixaId: caixa.id, definidaEm: agora, definidaPor: entrada.ator,
      });
      armazem.pessoas.anexarEvento({
        id: ctx.ids.novo(), chave: c.pessoa, tipo: 'PESSOA_NA_CAIXA',
        dados: { nome: p.dados.destinatario, rua: { id: c.rua.chave, nome: c.rua.nome }, de: memoria?.caixaId ?? null, para: caixa.id, pacote: { id: p.id, codigo: p.codigo } },
        ator: entrada.ator, ocorridoEm: agora,
      });
      mudou = true;
    }
    return { ok: true, mudou };
  });
}
