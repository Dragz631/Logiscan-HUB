/**
 * Casos de uso das REGIÕES (memória operacional do HUB).
 * Rua conhecida → região automática. Rua nova → revisão humana; a decisão vira memória persistida.
 * Mudar a região de uma rua já conhecida é CONFLITO: só com confirmação explícita (e fica no histórico).
 */
import { type Regiao, decidirAssociacao, resolverRegiao, type ResolucaoRegiao } from '../domain/regioes';
import { chaveRua } from '../domain/ruas';
import { ErroAplicacao } from './erros';
import type { Contexto } from './portas';

export function criarRegiao(ctx: Contexto, nome: string, ator: string): Regiao {
  const limpo = nome.replace(/\s+/g, ' ').trim();
  if (!limpo) throw new ErroAplicacao('NOME_VAZIO', 'informe o nome da região');
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const existente = armazem.regioes.porNome(limpo);
    if (existente) return existente;
    const r: Regiao = { id: ctx.ids.novo(), nome: limpo, criadaEm: ctx.relogio.agora(), criadaPor: ator };
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
  entrada: { rua: string; regiaoId: string | null; ator: string; substituir?: boolean },
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
    if (decisao === 'igual') return { ok: true, mudou: false };
    if (decisao === 'conflito') {
      const nomeAtual = atual!.regiaoId ? (armazem.regioes.porId(atual!.regiaoId)?.nome ?? '?') : 'sem região';
      return { ok: false, conflito: { rua: atual!.ruaNome, atual: { id: atual!.regiaoId, nome: nomeAtual } } };
    }
    const agora = ctx.relogio.agora();
    const ruaNome = entrada.rua.replace(/\s+/g, ' ').trim();
    armazem.regioes.definir({ ruaChave, ruaNome, regiaoId: entrada.regiaoId, definidaEm: agora, definidaPor: entrada.ator });
    armazem.regioes.anexarEvento({
      id: ctx.ids.novo(),
      ruaChave,
      tipo: 'REGIAO_DEFINIDA',
      dados: { rua: { chave: ruaChave, nome: ruaNome }, de: atual?.regiaoId, para: entrada.regiaoId },
      ator: entrada.ator,
      ocorridoEm: agora,
    });
    return { ok: true, mudou: true };
  });
}
