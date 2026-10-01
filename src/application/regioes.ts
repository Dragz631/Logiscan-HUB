/**
 * Casos de uso das REGIÕES (memória operacional do HUB).
 * Rua conhecida → região automática. Rua nova → revisão humana; a decisão vira memória persistida.
 * Mudar a região de uma rua já conhecida é CONFLITO: só com confirmação explícita (e fica no histórico).
 */
import { type OrigemCaixa, caixasCitadas, chavePessoa, decidirCaixa, termoDoNome } from '../domain/caixas';
import { idLogradouro, nomeQuaseIgual, normalizarCep, partesDoLogradouro, resolverLogradouro } from '../domain/destino/logradouro';
import type { Pacote } from '../domain/pacote';
import { type Associacao, type Regiao, type RuaConhecida, decidirAssociacao, resolverRegiao, ruaOperacional, type ResolucaoRegiao } from '../domain/regioes';
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
    const r: Regiao = { id: ctx.ids.novo(), nome: limpo, criadaEm: ctx.relogio.agora(), criadaPor: ator, repasseUnico, numero: null, ordem: null, paiId: null };
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
  const mapa = associacoesEfetivas(ctx, ruasVistas(ctx).nomes);
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

/**
 * Catálogo de CAIXAS (arquivo editável `conhecimento-inicial.json`): a lista de caixas que o Hugo ditou,
 * com número, nome, agrupamento (Associações agrupa as 4 associações), ruas explícitas e nomes antigos
 * (para absorver as regiões que ele já tinha criado sem duplicar). Formato antigo (`regioes`) continua aceito.
 */
export interface CaixaDoCatalogo {
  numero?: string;
  nome: string;
  nomesAnteriores?: string[];
  /** Número da caixa que agrupa esta (ex.: "10" para as associações). */
  dentroDe?: string;
  repasseUnico?: boolean;
  ruas?: { nome: string; prioridade?: number | null }[];
}

export interface ConhecimentoInicial {
  caixas?: CaixaDoCatalogo[];
  /** Formato da V0.3 (sem número): continua aceito. */
  regioes?: { nome: string; repasseUnico?: boolean; ruas: { nome: string; prioridade?: number | null }[] }[];
}

/** Quem grava o que vem do catálogo (e como o HUB sabe que um nome de rua é o OFICIAL). */
export const ATOR_CATALOGO = 'conhecimento inicial';

/** "1" → 1, "1.2" → 1.02, "10.1" → 10.01: ordem das caixas como o Hugo numera. */
export function ordemDoNumero(numero: string): number {
  const [a, b] = numero.split('.');
  return Number(a) + (b ? Number(b) / 100 : 0);
}

/**
 * Aplica o catálogo. Idempotente e CONSERVADOR: cria a caixa que falta, dá número/nome/agrupamento às
 * regiões que já existiam (pelo nome atual ou por um nome antigo) e associa as ruas explícitas.
 * Nunca muda a caixa de uma rua que o operador já decidiu diferente — isso volta como conflito.
 * Toda mudança de nome/número/agrupamento fica no histórico (CAIXA_CONFIGURADA).
 */
export function aplicarConhecimentoInicial(
  ctx: Contexto,
  conhecimento: ConhecimentoInicial,
  ator = ATOR_CATALOGO,
): { regioesCriadas: string[]; ruasAssociadas: number; conflitos: string[]; caixasConfiguradas: string[] } {
  const { armazem } = ctx;
  const caixas: CaixaDoCatalogo[] = conhecimento.caixas ?? (conhecimento.regioes ?? []).map((r) => ({ ...r }));
  return armazem.transacao(() => {
    const regioesCriadas: string[] = [];
    const conflitos: string[] = [];
    const caixasConfiguradas: string[] = [];
    let ruasAssociadas = 0;
    const agora = ctx.relogio.agora();
    const porNumero = new Map<string, Regiao>();

    const configurar = (atual: Regiao, para: { nome: string; numero: string | null; ordem: number | null; paiId: string | null; repasseUnico: boolean }) => {
      const muda =
        atual.nome !== para.nome || atual.numero !== para.numero || atual.ordem !== para.ordem || atual.paiId !== para.paiId || atual.repasseUnico !== para.repasseUnico;
      if (!muda) return atual;
      armazem.regioes.configurarCaixa(atual.id, para);
      armazem.regioes.anexarEvento({
        id: ctx.ids.novo(),
        ruaChave: `caixa:${atual.id}`,
        tipo: 'CAIXA_CONFIGURADA',
        dados: {
          caixa: atual.id,
          de: { nome: atual.nome, numero: atual.numero, paiId: atual.paiId },
          para: { nome: para.nome, numero: para.numero, paiId: para.paiId },
        },
        ator,
        ocorridoEm: agora,
      });
      caixasConfiguradas.push(para.numero ? `${para.numero} ${para.nome}` : para.nome);
      return { ...atual, ...para };
    };

    // 1ª passada: cada caixa existe, com nome e número do catálogo.
    for (const c of caixas) {
      const nome = c.nome.replace(/\s+/g, ' ').trim();
      const existente =
        armazem.regioes.porNome(nome) ?? (c.nomesAnteriores ?? []).map((n) => armazem.regioes.porNome(n)).find((r): r is Regiao => !!r);
      const numero = c.numero ?? existente?.numero ?? null;
      const ordem = c.numero ? ordemDoNumero(c.numero) : (existente?.ordem ?? null);
      let regiao: Regiao;
      if (!existente) {
        regiao = {
          id: ctx.ids.novo(), nome, criadaEm: agora, criadaPor: ator, repasseUnico: !!c.repasseUnico, numero, ordem, paiId: null,
        };
        armazem.regioes.criar(regiao);
        regioesCriadas.push(nome);
      } else {
        // nome do catálogo só entra se não for de OUTRA região (nunca funde duas regiões)
        const outra = armazem.regioes.porNome(nome);
        const nomeFinal = outra && outra.id !== existente.id ? existente.nome : nome;
        regiao = configurar(existente, {
          nome: nomeFinal, numero, ordem, paiId: existente.paiId, repasseUnico: c.repasseUnico ?? existente.repasseUnico,
        });
      }
      if (numero) porNumero.set(numero, regiao);
    }

    // 2ª passada: agrupamento (Associações → as 4 associações) e ruas explícitas.
    for (const c of caixas) {
      const regiao = (c.numero && porNumero.get(c.numero)) || armazem.regioes.porNome(c.nome);
      if (!regiao) continue;
      if (c.dentroDe !== undefined) {
        const pai = porNumero.get(c.dentroDe) ?? null;
        const atual = armazem.regioes.porId(regiao.id)!;
        if (pai && atual.paiId !== pai.id) configurar(atual, { nome: atual.nome, numero: atual.numero, ordem: atual.ordem, paiId: pai.id, repasseUnico: atual.repasseUnico });
      }
      for (const rua of c.ruas ?? []) {
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
    return { regioesCriadas, ruasAssociadas, conflitos, caixasConfiguradas };
  });
}

// ---------------------------------------------------------------------------
// Identidade da rua (street_id) com o CEP tirando a dúvida de digitação
// ---------------------------------------------------------------------------

/** O que o HUB já viu de ruas: nomes, CEPs de cada rua, e quais nomes são OFICIAIS (catálogo) ou ensinados. */
export interface RuasVistas {
  nomes: string[];
  cepsPorId: Map<string, Set<string>>;
  /** Nomes do catálogo de caixas (o certo, ex.: "Manoel"). */
  catalogo: string[];
  /** Nomes ensinados pelo operador (memória). */
  memoria: string[];
}

export function ruasVistas(ctx: Contexto): RuasVistas {
  const nomes = new Set<string>();
  const catalogo: string[] = [];
  const memoria: string[] = [];
  const cepsPorId = new Map<string, Set<string>>();
  for (const a of ctx.armazem.regioes.associacoes().values()) {
    nomes.add(a.ruaNome);
    (a.definidaPor === ATOR_CATALOGO ? catalogo : memoria).push(a.ruaNome);
  }
  for (const p of ctx.armazem.pacotes.listar()) {
    if (!p.dados.rua.trim()) continue;
    nomes.add(p.dados.rua);
    const cep = normalizarCep(p.dados.cep);
    if (!cep) continue;
    const id = idLogradouro(p.dados.rua);
    if (!cepsPorId.has(id)) cepsPorId.set(id, new Set());
    cepsPorId.get(id)!.add(cep);
  }
  return { nomes: [...nomes], cepsPorId, catalogo, memoria };
}

/**
 * Nome escrito no card (+ CEP) → logradouro (street_id + nome certo). Em ordem:
 *  1. identidade da escrita (caixa, acento, abreviação; sem tipo → único com tipo);
 *  2. nome do CATÁLOGO: igual, ou quase igual com o MESMO CEP (erro de digitação: "Manuel" → "Manoel");
 *  3. nome ENSINADO: igual, ou quase igual com o mesmo CEP;
 *  4. senão, fica como veio (rua nova → triagem).
 * O CEP sozinho nunca junta ruas (um CEP cobre várias no Caju) e nome parecido com CEP diferente é outra rua.
 */
export function resolvedorDeNome(v: RuasVistas): (nome: string, cep?: string) => { chave: string; nome: string } {
  const cache = new Map<string, { chave: string; nome: string }>();
  const idsCatalogo = new Map(v.catalogo.map((n) => [idLogradouro(n), n]));
  const idsMemoria = new Map(v.memoria.map((n) => [idLogradouro(n), n]));
  return (nome, cep = '') => {
    const k = `${nome}|${cep}`;
    if (!cache.has(k)) {
      const r = resolverLogradouro(nome, v.nomes);
      const c = normalizarCep(cep);
      const comTipo = partesDoLogradouro(r.id).tipo !== null;
      // nunca troca um nome COM tipo por um SEM tipo ("Rua Praia do Caju" não vira "praia do caju")
      const porCep = (lista: string[]) =>
        c
          ? lista.find(
              (o) =>
                idLogradouro(o) !== r.id &&
                !(comTipo && partesDoLogradouro(idLogradouro(o)).tipo === null) &&
                nomeQuaseIgual(r.nome, o) &&
                v.cepsPorId.get(idLogradouro(o))?.has(c),
            )
          : undefined;
      let res: { chave: string; nome: string };
      if (idsCatalogo.has(r.id)) res = { chave: r.id, nome: idsCatalogo.get(r.id)! };
      else {
        const doCatalogo = porCep(v.catalogo);
        if (doCatalogo) res = { chave: idLogradouro(doCatalogo), nome: doCatalogo };
        else if (idsMemoria.has(r.id)) res = { chave: r.id, nome: r.nome };
        else {
          const ensinado = porCep(v.memoria);
          res = ensinado ? { chave: idLogradouro(ensinado), nome: ensinado } : { chave: r.id, nome: r.nome };
        }
      }
      cache.set(k, res);
    }
    return cache.get(k)!;
  };
}

/**
 * Memória rua → região, pela identidade da rua (street_id).
 * Um nome ensinado SEM tipo ("praia do caju") vale também para o mesmo logradouro escrito COM tipo
 * ("Rua Praia do Caju") quando a regra segura do `logradouro.ts` encaixa os dois (um único candidato).
 * Nunca junta nomes diferentes ("Carlos Seidl" ≠ "Carlos Seixas"); região não mexe na identidade.
 */
function associacoesEfetivas(ctx: Contexto, nomes: readonly string[]): Map<string, Associacao> {
  const base = ctx.armazem.regioes.associacoes();
  const mapa = new Map<string, Associacao>();
  for (const a of base.values()) mapa.set(idLogradouro(a.ruaNome) || a.ruaChave, a);
  for (const a of base.values()) {
    const id = idLogradouro(a.ruaNome);
    if (partesDoLogradouro(id).tipo !== null) continue;
    const r = resolverLogradouro(a.ruaNome, nomes);
    if (r.como === 'sem_tipo' && !mapa.has(r.id)) mapa.set(r.id, { ...a, ruaChave: r.id });
  }
  return mapa;
}

/** Ruas conhecidas (memória do HUB) — base para decidir a rua operacional dos pacotes. */
export function ruasConhecidas(ctx: Contexto, nomes = ruasVistas(ctx).nomes): Map<string, RuaConhecida> {
  return new Map(
    [...associacoesEfetivas(ctx, nomes)].map(([chave, a]) => [chave, { chave, nome: a.ruaNome, regiaoId: a.regiaoId, prioridade: a.prioridade }]),
  );
}

type NomeDe = (nome: string, cep?: string) => { chave: string; nome: string };

/** Identidade da rua do pacote (nome certo, antes da especificidade da região). */
function identidadeDoNome(p: Pacote, nomeDe: NomeDe): { chave: string; nome: string } {
  return nomeDe(p.dados.rua, p.dados.cep);
}

/** Rua do pacote: identidade (street_id + CEP) → especificidade da região; nome = o ensinado, se houver. */
function ruaDoPacote(p: Pacote, conhecidas: Map<string, RuaConhecida>, nomeDe: NomeDe): { chave: string; nome: string } {
  const n = identidadeDoNome(p, nomeDe);
  const rua = n.chave === idLogradouro(p.dados.rua) ? p.dados.rua : n.nome; // encaixada (sem tipo / digitação): usa o nome certo
  const r = ruaOperacional({ rua, complemento: p.dados.complemento }, conhecidas);
  return { chave: r.chave, nome: conhecidas.get(r.chave)?.nome ?? r.nome };
}

/** "pacote → rua": a MESMA decisão em todas as telas (identidade + CEP + especificidade da Manilha). */
export function resolvedorDeRua(ctx: Contexto): (p: Pacote) => { chave: string; nome: string } {
  const v = ruasVistas(ctx);
  const conhecidas = ruasConhecidas(ctx, v.nomes);
  const nomeDe = resolvedorDeNome(v);
  return (p) => ruaDoPacote(p, conhecidas, nomeDe);
}

// ---------------------------------------------------------------------------
// Pacote → CAIXA (a triagem)
// ---------------------------------------------------------------------------

export interface CaixaDoPacote {
  /** null = sem caixa: aguarda a revisão do Hugo na triagem. */
  caixa: Regiao | null;
  /** 'pergunta' = a rua diz uma caixa e o complemento cita outra: o Hugo escolhe (ver `pergunta`). */
  origem: OrigemCaixa | 'pergunta' | null;
  /** Só com origem 'pergunta': as caixas em dúvida (a da rua primeiro, depois as citadas no complemento). */
  pergunta?: { candidatas: Regiao[] };
  /** Rua de verdade do pacote (para listar dentro da caixa). */
  rua: { chave: string; nome: string };
  /** Chave da pessoa (nome + rua) — memória por pessoa. */
  pessoa: string;
}

/**
 * Em qual caixa cada pacote está: à mão (triagem) > memória da PESSOA (nome + rua) > memória da RUA.
 * Sem nenhuma: sem caixa (triagem). Nunca chuta.
 */
export function resolvedorDeCaixa(ctx: Contexto): (p: Pacote) => CaixaDoPacote {
  const v = ruasVistas(ctx);
  const conhecidas = ruasConhecidas(ctx, v.nomes);
  const nomeDe = resolvedorDeNome(v);
  const regioes = new Map(ctx.armazem.regioes.listar().map((r) => [r.id, r]));
  const pessoas = ctx.armazem.pessoas.todas();
  const agrupa = new Set([...regioes.values()].map((r) => r.paiId).filter((id): id is string => !!id));
  const existe = (id: string) => regioes.has(id) && !agrupa.has(id); // caixa que só agrupa não recebe pacote
  const citaveis = caixasCitaveis(ctx, regioes, agrupa);
  return (p) => {
    const ident = identidadeDoNome(p, nomeDe);
    const rua = ruaDoPacote(p, conhecidas, nomeDe);
    const pessoa = chavePessoa(p.dados.destinatario, ident.chave);
    const d = decidirCaixa({
      manual: p.caixaId,
      pessoa: pessoa ? (pessoas.get(pessoa)?.caixaId ?? null) : null,
      rua: conhecidas.get(rua.chave)?.regiaoId ?? null,
      existe,
    });
    // Decidido só "pela rua" e o complemento cita OUTRA caixa: não decide, pergunta (a pessoa/à mão já mandam antes).
    if (d?.origem === 'rua') {
      const citadas = caixasCitadas(p.dados.complemento, citaveis, d.caixaId);
      if (citadas.length > 0) {
        const candidatas = [d.caixaId, ...citadas].map((id) => regioes.get(id)!);
        return { caixa: null, origem: 'pergunta', pergunta: { candidatas }, rua, pessoa };
      }
    }
    return { caixa: d ? regioes.get(d.caixaId)! : null, origem: d?.origem ?? null, rua, pessoa };
  };
}

/**
 * Por quais nomes cada caixa pode ser CITADA num complemento: o nome da caixa e, nas caixas com ruas (Manilha,
 * Quinta do Caju…), os nomes das ruas que o Hugo ensinou. Ficam de fora: caixas que só agrupam, "Diversos" (junta
 * de tudo) e as ruas das associações (a rua delas é a de quem mora, não a da associação).
 */
function caixasCitaveis(ctx: Contexto, regioes: Map<string, Regiao>, agrupa: Set<string>): { id: string; termos: string[] }[] {
  const ruasPorCaixa = new Map<string, string[]>();
  for (const a of ctx.armazem.regioes.associacoes().values()) {
    if (!a.regiaoId) continue;
    if (!ruasPorCaixa.has(a.regiaoId)) ruasPorCaixa.set(a.regiaoId, []);
    ruasPorCaixa.get(a.regiaoId)!.push(a.ruaNome);
  }
  const lista: { id: string; termos: string[] }[] = [];
  for (const r of regioes.values()) {
    if (agrupa.has(r.id) || r.repasseUnico) continue;
    const doNome = termoDoNome(r.nome);
    const dasRuas = r.paiId ? [] : (ruasPorCaixa.get(r.id) ?? []).map(termoDoNome);
    const termos = [...new Set([doNome, ...dasRuas].filter(Boolean))];
    if (termos.length > 0) lista.push({ id: r.id, termos });
  }
  return lista;
}

/** Identidade da rua do pacote (street_id) + caixa. Vai na carga para o Street. */
export function identidadeDaRua(ctx: Contexto): (p: Pacote) => {
  ruaId: string;
  ruaNome: string;
  regiao: { id: string; nome: string; repasseUnico: boolean } | null;
  caixa: Regiao | null;
} {
  const caixaDe = resolvedorDeCaixa(ctx);
  return (p) => {
    const c = caixaDe(p);
    return {
      ruaId: c.rua.chave,
      ruaNome: c.rua.nome,
      regiao: c.caixa ? { id: c.caixa.id, nome: c.caixa.nome, repasseUnico: c.caixa.repasseUnico } : null,
      caixa: c.caixa,
    };
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
