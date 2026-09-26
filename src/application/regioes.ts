/**
 * Casos de uso das REGIÕES (memória operacional do HUB).
 * Rua conhecida → região automática. Rua nova → revisão humana; a decisão vira memória persistida.
 * Mudar a região de uma rua já conhecida é CONFLITO: só com confirmação explícita (e fica no histórico).
 */
import type { Pacote } from '../domain/pacote';
import { type Regiao, type RuaConhecida, decidirAssociacao, resolverRegiao, ruaOperacional, type ResolucaoRegiao } from '../domain/regioes';
import { chaveRua } from '../domain/ruas';
import { ErroAplicacao } from './erros';
import type { Contexto } from './portas';

export function criarRegiao(ctx: Contexto, nome: string, ator: string, repasseUnico = false): Regiao {
  const limpo = nome.replace(/\s+/g, ' ').trim();
  if (!limpo) throw new ErroAplicacao('NOME_VAZIO', 'informe o nome da região');
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const existente = armazem.regioes.porNome(limpo);
    if (existente) return existente;
    const r: Regiao = { id: ctx.ids.novo(), nome: limpo, criadaEm: ctx.relogio.agora(), criadaPor: ator, repasseUnico };
    armazem.regioes.criar(r);
    return r;
  });
}

export function listarRegioes(ctx: Contexto): Regiao[] {
  return ctx.armazem.regioes.listar();
}

export type RegiaoDaRua =
  | { status: 'conhecida'; id: string; nome: string }
  | { status: 'sem_regiao' }
  | { status: 'desconhecida' };

/** Função de consulta usada pelo orquestrador: rua → região (a partir da memória). */
export function consultorDeRegioes(ctx: Contexto): (ruaChave: string) => RegiaoDaRua {
  const mapa = ctx.armazem.regioes.associacoes();
  const nomes = new Map(ctx.armazem.regioes.listar().map((r) => [r.id, r.nome]));
  return (ruaChave) => {
    // "rua" que é uma região inteira (repasse único, ex.: Diversos)
    if (ruaChave.startsWith('regiao:')) {
      const id = ruaChave.slice('regiao:'.length);
      return { status: 'conhecida', id, nome: nomes.get(id) ?? '?' };
    }
    const r: ResolucaoRegiao = resolverRegiao(mapa.get(ruaChave));
    if (r.status === 'conhecida') return { status: 'conhecida', id: r.regiaoId, nome: nomes.get(r.regiaoId) ?? '?' };
    return r;
  };
}

export type ResultadoDefinicao =
  | { ok: true; mudou: boolean }
  | { ok: false; conflito: { rua: string; atual: { id: string | null; nome: string } } };

/**
 * Grava a decisão rua → região (ou "sem região" com regiaoId null).
 * Sem `substituir`, uma rua que já tem decisão diferente devolve CONFLITO para revisão — nada é sobrescrito.
 */
export function definirRegiao(
  ctx: Contexto,
  entrada: { rua: string; regiaoId: string | null; ator: string; substituir?: boolean; prioridade?: number | null },
): ResultadoDefinicao {
  const ruaChave = chaveRua(entrada.rua);
  if (!ruaChave) throw new ErroAplicacao('RUA_VAZIA', 'informe a rua');
  const { armazem } = ctx;
  return armazem.transacao(() => {
    if (entrada.regiaoId !== null && !armazem.regioes.porId(entrada.regiaoId)) {
      throw new ErroAplicacao('REGIAO_INEXISTENTE', 'região não encontrada', 404);
    }
    const atual = armazem.regioes.associacao(ruaChave);
    const decisao = decidirAssociacao(atual, entrada.regiaoId, !!entrada.substituir);
    const mudaPrioridade = entrada.prioridade !== undefined && entrada.prioridade !== (atual?.prioridade ?? null);
    if (decisao === 'igual' && !mudaPrioridade) return { ok: true, mudou: false };
    if (decisao === 'conflito') {
      const nomeAtual = atual!.regiaoId ? (armazem.regioes.porId(atual!.regiaoId)?.nome ?? '?') : 'sem região';
      return { ok: false, conflito: { rua: atual!.ruaNome, atual: { id: atual!.regiaoId, nome: nomeAtual } } };
    }
    const agora = ctx.relogio.agora();
    const ruaNome = entrada.rua.replace(/\s+/g, ' ').trim();
    // mesma região: mantém a especificidade configurada; região nova: sem prioridade até alguém configurar
    const prioridade =
      entrada.prioridade !== undefined ? entrada.prioridade : atual?.regiaoId === entrada.regiaoId ? (atual?.prioridade ?? null) : null;
    armazem.regioes.definir({ ruaChave, ruaNome, regiaoId: entrada.regiaoId, prioridade, definidaEm: agora, definidaPor: entrada.ator });
    armazem.regioes.anexarEvento({
      id: ctx.ids.novo(),
      ruaChave,
      tipo: 'REGIAO_DEFINIDA',
      dados: {
        rua: { chave: ruaChave, nome: ruaNome },
        de: atual?.regiaoId,
        para: entrada.regiaoId,
        ...(prioridade !== (atual?.prioridade ?? null) ? { prioridade: { de: atual?.prioridade, para: prioridade } } : {}),
      },
      ator: entrada.ator,
      ocorridoEm: agora,
    });
    return { ok: true, mudou: true };
  });
}

// ---------------------------------------------------------------------------
// Conhecimento inicial (arquivo de dados) e rua operacional
// ---------------------------------------------------------------------------

export interface ConhecimentoInicial {
  regioes: { nome: string; repasseUnico?: boolean; ruas: { nome: string; prioridade?: number | null }[] }[];
}

/**
 * Aplica o conhecimento inicial (ex.: Manilha e suas 14 ruas; Quinta do Caju vazia).
 * Idempotente e CONSERVADOR: cria o que falta e nunca sobrescreve uma decisão já tomada pelo operador.
 * O que ficou de fora por conflito volta na lista, para revisão.
 */
export function aplicarConhecimentoInicial(
  ctx: Contexto,
  conhecimento: ConhecimentoInicial,
  ator = 'conhecimento inicial',
): { regioesCriadas: string[]; ruasAssociadas: number; conflitos: string[] } {
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const regioesCriadas: string[] = [];
    const conflitos: string[] = [];
    let ruasAssociadas = 0;
    for (const r of conhecimento.regioes) {
      const existia = armazem.regioes.porNome(r.nome);
      const regiao = existia ?? criarRegiao(ctx, r.nome, ator, !!r.repasseUnico);
      if (!existia) regioesCriadas.push(regiao.nome);
      for (const rua of r.ruas) {
        const atual = armazem.regioes.associacao(chaveRua(rua.nome));
        if (atual && atual.regiaoId !== regiao.id) {
          const onde = atual.regiaoId ? (armazem.regioes.porId(atual.regiaoId)?.nome ?? '?') : 'sem região';
          conflitos.push(`${rua.nome}: já decidido como ${onde}`);
          continue;
        }
        if (atual && atual.prioridade !== null) continue; // já configurada: não mexe
        const res = definirRegiao(ctx, { rua: rua.nome, regiaoId: regiao.id, ator, prioridade: rua.prioridade ?? null });
        if (res.ok && res.mudou) ruasAssociadas++;
      }
    }
    return { regioesCriadas, ruasAssociadas, conflitos };
  });
}

/** Ruas conhecidas (memória do HUB) — base para decidir a rua operacional dos pacotes. */
export function ruasConhecidas(ctx: Contexto): Map<string, RuaConhecida> {
  return new Map(
    [...ctx.armazem.regioes.associacoes().values()].map((a) => [
      a.ruaChave,
      { chave: a.ruaChave, nome: a.ruaNome, regiaoId: a.regiaoId, prioridade: a.prioridade },
    ]),
  );
}

/**
 * "pacote → rua operacional": a MESMA decisão em todas as telas e em todas as atribuições.
 * Rua de uma região de repasse único (ex.: Diversos) vira a própria região: `regiao:<id>`.
 */
export function resolvedorDeRua(ctx: Contexto): (p: Pacote) => { chave: string; nome: string } {
  const conhecidas = ruasConhecidas(ctx);
  const unicas = new Map(ctx.armazem.regioes.listar().filter((r) => r.repasseUnico).map((r) => [r.id, r.nome]));
  return (p) => {
    const r = ruaOperacional({ rua: p.dados.rua, complemento: p.dados.complemento }, conhecidas);
    const regiaoId = conhecidas.get(r.chave)?.regiaoId;
    if (regiaoId && unicas.has(regiaoId)) return { chave: `regiao:${regiaoId}`, nome: unicas.get(regiaoId)! };
    return r;
  };
}

export interface RegiaoComRuas extends Regiao {
  ruas: { chave: string; nome: string; prioridade: number | null; definidaPor: string; definidaEm: string }[];
}

/** Mapa operacional para a tela de Regiões: cada região com os logradouros ensinados. */
export function mapaDeRegioes(ctx: Contexto): { regioes: RegiaoComRuas[]; semRegiao: RegiaoComRuas['ruas'] } {
  const assoc = [...ctx.armazem.regioes.associacoes().values()];
  const ruas = (id: string | null) =>
    assoc
      .filter((a) => a.regiaoId === id)
      .map((a) => ({ chave: a.ruaChave, nome: a.ruaNome, prioridade: a.prioridade, definidaPor: a.definidaPor, definidaEm: a.definidaEm }))
      .sort((x, y) => (x.prioridade ?? 99) - (y.prioridade ?? 99) || x.nome.localeCompare(y.nome, 'pt-BR'));
  return { regioes: ctx.armazem.regioes.listar().map((r) => ({ ...r, ruas: ruas(r.id) })), semRegiao: ruas(null) };
}
