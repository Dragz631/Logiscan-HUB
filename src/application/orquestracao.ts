/**
 * ORQUESTRADOR — o HUB organiza, atribui e monitora; o Street executa.
 *
 * Unidade de repasse = RUA. Atribuir uma rua a um ajudante leva a rua INTEIRA (todos os pacotes
 * dela sem responsável) para a carga ativa dele. Regras de segurança:
 *  - uma rua não fica com dois ajudantes ao mesmo tempo;
 *  - um pacote está em no máximo uma carga ativa;
 *  - um ajudante tem no máximo uma carga ativa (não mistura duas cargas);
 *  - carga em rota não recebe nem perde ruas (só antes de iniciar);
 *  - toda mudança gera evento (atribuição, inclusão, retirada, reatribuição, início/fim de rota).
 */
import { type Carga, type RuaRef, codigoCarga, prefixoCarga } from '../domain/carga';
import { type CaixaRef, ErroDominio, type Evento } from '../domain/eventos';
import type { Regiao } from '../domain/regioes';
import type { Pacote } from '../domain/pacote';
import { type ResumoRua, agruparPorRua, chaveRua, naOperacao } from '../domain/ruas';
import { ErroAplicacao } from './erros';
import type { Ajudante, Contexto } from './portas';
import { registrarEvento } from './registrarEvento';
import { type RegiaoDaRua, consultorDeRegioes, resolvedorDeCaixa, resolvedorDeRua } from './regioes';

// ---------------------------------------------------------------------------
// Perfis
// ---------------------------------------------------------------------------

/** Perfil: nome, veículo, ativo. Sem "capacidade": a operação não bloqueia nem mede lotação. */
export interface DadosPerfil {
  nome: string;
  veiculo?: string | null;
  ativo?: boolean;
}

function validarPerfil(d: DadosPerfil): { nome: string; veiculo: string | null } {
  const nome = d.nome.replace(/\s+/g, ' ').trim();
  if (!nome) throw new ErroAplicacao('NOME_VAZIO', 'informe o nome do ajudante');
  return { nome, veiculo: d.veiculo?.trim() || null };
}

export function criarPerfil(ctx: Contexto, d: DadosPerfil): Ajudante {
  const v = validarPerfil(d);
  const { armazem } = ctx;
  return armazem.transacao(() => {
    if (armazem.ajudantes.listar().some((a) => a.nome.toLowerCase() === v.nome.toLowerCase())) {
      throw new ErroAplicacao('AJUDANTE_DUPLICADO', `já existe um ajudante chamado ${v.nome}`, 409);
    }
    const a: Ajudante = { id: ctx.ids.novo(), ativo: d.ativo ?? true, criadoEm: ctx.relogio.agora(), streetVistoEm: null, ...v };
    armazem.ajudantes.criar(a);
    return a;
  });
}

export function editarPerfil(ctx: Contexto, id: string, d: DadosPerfil): Ajudante {
  const v = validarPerfil(d);
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const atual = armazem.ajudantes.porId(id);
    if (!atual) throw new ErroAplicacao('AJUDANTE_INEXISTENTE', 'ajudante não encontrado', 404);
    if (armazem.ajudantes.listar().some((a) => a.id !== id && a.nome.toLowerCase() === v.nome.toLowerCase())) {
      throw new ErroAplicacao('AJUDANTE_DUPLICADO', `já existe um ajudante chamado ${v.nome}`, 409);
    }
    const ativo = d.ativo ?? atual.ativo;
    if (!ativo && armazem.cargas.ativaDoAjudante(id)) {
      throw new ErroAplicacao('TEM_CARGA_ATIVA', 'não dá para desativar um ajudante com carga ativa', 409);
    }
    const novo: Ajudante = { ...atual, ...v, ativo };
    armazem.ajudantes.atualizar(novo);
    return novo;
  });
}

// ---------------------------------------------------------------------------
// Visão do orquestrador
// ---------------------------------------------------------------------------

function pacotesNaOperacao(ctx: Contexto): { pacotes: Pacote[]; ativas: Set<string> } {
  const ativas = ctx.armazem.cargas.idsAtivas();
  return { pacotes: ctx.armazem.pacotes.listar().filter((p) => naOperacao(p, ativas)), ativas };
}

export type RuaNoOrquestrador = ResumoRua & { regiao: RegiaoDaRua };

/** Referência da caixa gravada nos eventos (prova de em qual caixa o pacote saiu). */
export const refCaixa = (c: Regiao): CaixaRef => ({ id: c.id, numero: c.numero, nome: c.nome });

/**
 * Chave de REPASSE do pacote: a CAIXA dele (`regiao:<id>`). Sem caixa → `sem:<rua>`: não vai para
 * ajudante nenhum até o Hugo dizer a caixa na triagem.
 */
export function resolvedorDeUnidade(ctx: Contexto): (p: Pacote) => { chave: string; nome: string; caixa: Regiao | null; rua: { chave: string; nome: string } } {
  const caixaDe = resolvedorDeCaixa(ctx);
  const cache = new Map<string, ReturnType<ReturnType<typeof resolvedorDeUnidade>>>();
  return (p) => {
    const k = `${p.id}|${p.versao}`;
    if (!cache.has(k)) {
      const c = caixaDe(p);
      cache.set(
        k,
        c.caixa
          ? { chave: `regiao:${c.caixa.id}`, nome: c.caixa.nome, caixa: c.caixa, rua: c.rua }
          : { chave: `sem:${c.rua.chave}`, nome: c.rua.nome, caixa: null, rua: c.rua },
      );
    }
    return cache.get(k)!;
  };
}

/** Linhas do orquestrador: uma por CAIXA (e as ruas ainda sem caixa, que aguardam a triagem). */
export function listarRuas(ctx: Contexto): RuaNoOrquestrador[] {
  const regiaoDe = consultorDeRegioes(ctx);
  return agruparPorRua(pacotesNaOperacao(ctx).pacotes, resolvedorDeUnidade(ctx)).map((r) => ({
    ...r,
    regiao: r.chave.startsWith('regiao:') ? regiaoDe(r.chave) : { status: 'desconhecida' as const },
  }));
}

/**
 * UNIDADE DE REPASSE = CAIXA (o card da coluna Origem).
 *   caixa → uma rua (Carlos Seidl), um lugar com ruas dentro (Manilha, Quinta) ou uma associação;
 *   grupo → caixa que agrupa outras (Associações: as 4 associações), dá para mandar inteira ou só uma.
 * A caixa vai INTEIRA para o ajudante. As ruas de dentro só aparecem ao expandir (informação).
 */
export interface UnidadeRepasse {
  chave: string;
  tipo: 'caixa' | 'grupo';
  numero: string | null;
  nome: string;
  regiao: RegiaoDaRua;
  total: number;
  disponiveis: number;
  atribuidos: number;
  revisao: number;
  /** Pacotes que voltaram para a caixa ao fim do dia (Retornado) e de quais dias (AAAA-MM-DD). */
  retornados: number;
  diasRetornados: string[];
  responsaveis: string[];
  /** Ruas de verdade dentro da caixa (ao expandir). */
  ruas: RuaNoOrquestrador[];
  /** Só no grupo: as caixas que ele agrupa. */
  subcaixas: UnidadeRepasse[];
}

const ordemCaixa = (a: { ordem: number | null; nome: string }, b: { ordem: number | null; nome: string }) =>
  (a.ordem ?? Number.MAX_SAFE_INTEGER) - (b.ordem ?? Number.MAX_SAFE_INTEGER) || a.nome.localeCompare(b.nome, 'pt-BR');

export function listarUnidades(ctx: Contexto): UnidadeRepasse[] {
  const unidadeDe = resolvedorDeUnidade(ctx);
  const regioes = new Map(ctx.armazem.regioes.listar().map((r) => [r.id, r]));
  const porCaixa = new Map<string, Pacote[]>();
  for (const p of pacotesNaOperacao(ctx).pacotes) {
    const u = unidadeDe(p);
    if (u.caixa) porCaixa.set(u.caixa.id, [...(porCaixa.get(u.caixa.id) ?? []), p]);
  }
  const caixa = (c: Regiao, lista: Pacote[]): UnidadeRepasse => {
    const [r] = agruparPorRua(lista, () => ({ chave: `regiao:${c.id}`, nome: c.nome }));
    const regiao: RegiaoDaRua = { status: 'conhecida', id: c.id, nome: c.nome };
    return {
      chave: `regiao:${c.id}`, tipo: 'caixa', numero: c.numero, nome: c.nome, regiao,
      total: r.total, disponiveis: r.disponiveis, atribuidos: r.atribuidos, revisao: r.revisao, responsaveis: r.responsaveis,
      retornados: r.retornados, diasRetornados: r.diasRetornados,
      ruas: agruparPorRua(lista, (p) => unidadeDe(p).rua).map((x) => ({ ...x, regiao })),
      subcaixas: [],
    };
  };
  const soltas: UnidadeRepasse[] = [];
  const grupos = new Map<string, UnidadeRepasse>();
  for (const [id, lista] of porCaixa) {
    const c = regioes.get(id)!;
    const u = caixa(c, lista);
    const pai = c.paiId ? regioes.get(c.paiId) : undefined;
    if (!pai) {
      soltas.push(u);
      continue;
    }
    if (!grupos.has(pai.id)) {
      grupos.set(pai.id, {
        chave: `regiao:${pai.id}`, tipo: 'grupo', numero: pai.numero, nome: pai.nome, regiao: { status: 'conhecida', id: pai.id, nome: pai.nome },
        total: 0, disponiveis: 0, atribuidos: 0, revisao: 0, retornados: 0, diasRetornados: [], responsaveis: [], ruas: [], subcaixas: [],
      });
    }
    const g = grupos.get(pai.id)!;
    g.subcaixas.push(u);
    g.total += u.total;
    g.disponiveis += u.disponiveis;
    g.atribuidos += u.atribuidos;
    g.revisao += u.revisao;
    g.retornados += u.retornados;
    g.diasRetornados = [...new Set([...g.diasRetornados, ...u.diasRetornados])].sort();
    g.responsaveis = [...new Set([...g.responsaveis, ...u.responsaveis])];
  }
  const dados = (u: UnidadeRepasse) => regioes.get(u.chave.slice('regiao:'.length))!;
  for (const g of grupos.values()) g.subcaixas.sort((a, b) => ordemCaixa(dados(a), dados(b)));
  return [...soltas, ...grupos.values()].sort((a, b) => ordemCaixa(dados(a), dados(b)));
}

/** Compatibilidade: unidades a partir de linhas já agrupadas (usado só por quem já tem as linhas). */
export function agruparEmUnidades(_ruas: RuaNoOrquestrador[], ctx?: Contexto): UnidadeRepasse[] {
  return ctx ? listarUnidades(ctx) : [];
}

export interface ResumoPerfil {
  ajudante: Ajudante;
  carga: { id: string; codigo: string; situacao: 'MONTADA' | 'EM_ROTA' | 'CONCLUIDA' } | null;
  pacotes: number;
  ruas: number;
  /** Quantas caixas o ajudante leva. */
  caixas: number;
  entregues: number;
  insucessos: number;
  pendentes: number;
  /** % de pacotes com desfecho. */
  progresso: number;
  rotaIniciadaEm: string | null;
  /** Quando o Street do perfil confirmou que carregou a carga (null = ainda não chegou). */
  recebidaNoStreetEm: string | null;
  /** Último contato do Street deste perfil com o HUB (null = nunca conectou). */
  streetVistoEm: string | null;
  /** Último repasse na hora que envolveu a carga atual (avisa nos cards). */
  repasse: { sentido: 'enviado' | 'recebido'; com: string; em: string; pacotes: number } | null;
}

function resumoPerfil(ctx: Contexto, a: Ajudante, unidadeDe = resolvedorDeUnidade(ctx)): ResumoPerfil {
  const carga = ctx.armazem.cargas.ativaDoAjudante(a.id) ?? null;
  const pacotes = carga ? carga.pacoteIds.map((id) => ctx.armazem.pacotes.porId(id)).filter((p): p is Pacote => !!p) : [];
  const entregues = pacotes.filter((p) => p.estado === 'ENTREGUE').length;
  const insucessos = pacotes.filter((p) => p.estado === 'INSUCESSO').length;
  const situacao = !carga ? null : !carga.rotaIniciadaEm ? 'MONTADA' : entregues + insucessos === pacotes.length && pacotes.length > 0 ? 'CONCLUIDA' : 'EM_ROTA';
  const eventosCarga = carga ? ctx.armazem.cargas.eventos(carga.id) : [];
  let repasse: ResumoPerfil['repasse'] = null;
  for (const ev of eventosCarga) {
    if (ev.tipo === 'ROTA_REPASSADA') repasse = { sentido: 'enviado', com: ev.dados.para.nome, em: ev.ocorridoEm, pacotes: ev.dados.pacotes };
    if (ev.tipo === 'CARGA_CRIADA' && ev.dados.repassadaDe) {
      repasse = { sentido: 'recebido', com: ev.dados.repassadaDe.ajudante.nome, em: ev.ocorridoEm, pacotes: ev.dados.quantidade };
    }
  }
  return {
    ajudante: a,
    carga: carga && situacao ? { id: carga.id, codigo: carga.codigo, situacao } : null,
    pacotes: pacotes.length,
    ruas: new Set(pacotes.map((p) => unidadeDe(p).rua.chave)).size,
    caixas: new Set(pacotes.map((p) => unidadeDe(p).chave)).size,
    entregues,
    insucessos,
    pendentes: pacotes.length - entregues - insucessos,
    progresso: pacotes.length ? Math.round(((entregues + insucessos) / pacotes.length) * 100) : 0,
    rotaIniciadaEm: carga?.rotaIniciadaEm ?? null,
    recebidaNoStreetEm: eventosCarga.filter((e) => e.tipo === 'RECEBIDA_NO_STREET').at(-1)?.ocorridoEm ?? null,
    streetVistoEm: a.streetVistoEm,
    repasse,
  };
}

export function listarPerfis(ctx: Contexto): ResumoPerfil[] {
  const unidadeDe = resolvedorDeUnidade(ctx);
  return ctx.armazem.ajudantes.listar().map((a) => resumoPerfil(ctx, a, unidadeDe));
}

export interface RuaDoPerfil extends RuaRef {
  entregues: number;
  insucessos: number;
  pendentes: number;
}

/** Uma parada = um DESTINO (rua + nº + contexto) com os pacotes dele. Região ≠ rua ≠ destino. */
export interface Parada {
  destinoId: string;
  ruaChave: string;
  rua: string;
  numero: string;
  /** Como aparece no card: "Rua Carlos Seidl, 133 — Loja ABC". */
  titulo: string;
  bairro: string;
  pacotes: { id: string; codigo: string; destinatario: string; estado: Pacote['estado']; complemento: string; motivoInsucesso: string | null; provaIncompleta: boolean }[];
}

/** Um NÚMERO dentro de uma caixa (como o card de número do Street): pode ter vários pacotes, casas ou locais. */
export interface NumeroNaCaixa {
  rua: string;
  numero: string;
  total: number;
  entregues: number;
  insucessos: number;
  pendentes: number;
  /** Os destinos (local/endereço) deste número, cada um com seus pacotes. Mais de um = "locais diferentes neste número". */
  destinos: Parada[];
}

/** Uma CAIXA que o ajudante recebeu, com os números dela em ordem crescente (a mesma arrumação do Street). */
export interface CaixaDoPerfil {
  chave: string;
  /** "1", "1.2", "10.1"… (nulo = rua ainda sem caixa). */
  numero: string | null;
  nome: string;
  total: number;
  entregues: number;
  insucessos: number;
  pendentes: number;
  numeros: NumeroNaCaixa[];
}

export interface DetalhePerfil extends ResumoPerfil {
  /** As caixas recebidas, cada uma com seus números — é o que o Hugo vê como "o Street do ajudante". */
  caixasRecebidas: CaixaDoPerfil[];
  ruasDaCarga: (RuaDoPerfil & { regiao: RegiaoDaRua })[];
  montadaEm: string | null;
  /** Sequência de paradas — só faz sentido quando a carga já está no Street. */
  paradas: Parada[];
  /** Últimos acontecimentos dos pacotes da carga atual (mais recentes primeiro). */
  ocorrencias: (Evento & { codigo: string })[];
}

const numeroOrdem = (n: string) => {
  const m = /\d+/.exec(n);
  return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
};

export function montarParadas(pacotes: Pacote[], ruaDe: (p: Pacote) => { chave: string; nome: string }): Parada[] {
  const porDestino = new Map<string, Parada>();
  for (const p of pacotes) {
    const rua = ruaDe(p);
    const chave = p.destinoId ?? `${rua.chave}|${p.dados.numero}|${p.dados.complemento}`;
    if (!porDestino.has(chave)) {
      porDestino.set(chave, {
        destinoId: chave,
        ruaChave: rua.chave,
        rua: rua.nome,
        numero: p.dados.numero || 'S/N',
        titulo: `${p.dados.rua}, ${p.dados.numero || 'S/N'}`,
        bairro: p.dados.bairro,
        pacotes: [],
      });
    }
    porDestino.get(chave)!.pacotes.push({
      id: p.id,
      codigo: p.codigo,
      destinatario: p.dados.destinatario,
      estado: p.estado,
      complemento: p.dados.complemento,
      motivoInsucesso: p.motivoInsucesso,
      /** Entregue ≠ pronto para baixa: sem as provas (fotos), a confirmação continua incompleta. */
      provaIncompleta: p.estado === 'ENTREGUE' && p.confirmacaoEntrega?.status !== 'COMPLETA',
    });
  }
  return [...porDestino.values()].sort(
    (a, b) => a.rua.localeCompare(b.rua, 'pt-BR') || numeroOrdem(a.numero) - numeroOrdem(b.numero) || a.titulo.localeCompare(b.titulo, 'pt-BR'),
  );
}

const ENTREGUES = ['ENTREGUE', 'PRONTO_PARA_BAIXA', 'BAIXADO'];

/** Caixas da carga → números em ordem crescente → destinos → pacotes (mesma arrumação do Street). */
export function montarCaixas(
  pacotes: Pacote[],
  unidadeDe: (p: Pacote) => { chave: string; nome: string; caixa: Regiao | null },
  ruaDe: (p: Pacote) => { chave: string; nome: string },
): CaixaDoPerfil[] {
  const porCaixa = new Map<string, { chave: string; nome: string; caixa: Regiao | null; pacotes: Pacote[] }>();
  for (const p of pacotes) {
    const u = unidadeDe(p);
    if (!porCaixa.has(u.chave)) porCaixa.set(u.chave, { chave: u.chave, nome: u.nome, caixa: u.caixa, pacotes: [] });
    porCaixa.get(u.chave)!.pacotes.push(p);
  }
  const contar = (ps: { estado: Pacote['estado'] }[]) => {
    const entregues = ps.filter((x) => ENTREGUES.includes(x.estado)).length;
    const insucessos = ps.filter((x) => x.estado === 'INSUCESSO').length;
    return { total: ps.length, entregues, insucessos, pendentes: ps.length - entregues - insucessos };
  };
  const ordemCaixa = (c: { caixa: Regiao | null; nome: string }) => c.caixa?.ordem ?? Number.MAX_SAFE_INTEGER;
  return [...porCaixa.values()]
    .sort((a, b) => ordemCaixa(a) - ordemCaixa(b) || a.nome.localeCompare(b.nome, 'pt-BR'))
    .map((c) => {
      const numeros = new Map<string, NumeroNaCaixa>();
      for (const parada of montarParadas(c.pacotes, ruaDe)) {
        const chave = `${parada.ruaChave}|${parada.numero}`;
        if (!numeros.has(chave)) numeros.set(chave, { rua: parada.rua, numero: parada.numero, total: 0, entregues: 0, insucessos: 0, pendentes: 0, destinos: [] });
        const n = numeros.get(chave)!;
        n.destinos.push(parada);
        Object.assign(n, contar(n.destinos.flatMap((d) => d.pacotes)));
      }
      const lista = [...numeros.values()].sort(
        (a, b) => a.rua.localeCompare(b.rua, 'pt-BR') || numeroOrdem(a.numero) - numeroOrdem(b.numero) || a.numero.localeCompare(b.numero, 'pt-BR'),
      );
      return { chave: c.chave, numero: c.caixa?.numero ?? null, nome: c.nome, ...contar(c.pacotes), numeros: lista };
    });
}

export function ruasDaCarga(pacotes: Pacote[], ruaDe?: (p: Pacote) => { chave: string; nome: string }): RuaDoPerfil[] {
  return agruparPorRua(pacotes, ruaDe).map((r) => ({
    chave: r.chave,
    nome: r.nome,
    quantidade: r.total,
    entregues: r.entregues,
    insucessos: r.insucessos,
    pendentes: r.total - r.entregues - r.insucessos,
  }));
}

export function detalharPerfil(ctx: Contexto, ajudanteId: string): DetalhePerfil {
  const a = ctx.armazem.ajudantes.porId(ajudanteId);
  if (!a) throw new ErroAplicacao('AJUDANTE_INEXISTENTE', 'ajudante não encontrado', 404);
  const ruaDe = resolvedorDeRua(ctx);
  const unidadeDe = resolvedorDeUnidade(ctx);
  const regiaoDe = consultorDeRegioes(ctx);
  const r = resumoPerfil(ctx, a, unidadeDe);
  const carga = ctx.armazem.cargas.ativaDoAjudante(a.id);
  const pacotes = carga ? carga.pacoteIds.map((id) => ctx.armazem.pacotes.porId(id)).filter((p): p is Pacote => !!p) : [];
  const ocorrencias = pacotes
    .flatMap((p) => ctx.armazem.eventos.doPacote(p.id).map((e) => ({ ...e, codigo: p.codigo })))
    .sort((x, y) => y.ocorridoEm.localeCompare(x.ocorridoEm))
    .slice(0, 15);
  const recebida = carga ? ctx.armazem.cargas.eventos(carga.id).filter((e) => e.tipo === 'RECEBIDA_NO_STREET').at(-1) : undefined;
  return {
    ...r,
    caixasRecebidas: montarCaixas(pacotes, unidadeDe, ruaDe),
    // Caixas da carga (a unidade que entra/sai da carga); as ruas de verdade aparecem nas paradas.
    ruasDaCarga: ruasDaCarga(pacotes, unidadeDe).map((x) => ({
      ...x,
      regiao: x.chave.startsWith('regiao:') ? regiaoDe(x.chave) : ({ status: 'desconhecida' } as const),
    })),
    rotaIniciadaEm: carga?.rotaIniciadaEm ?? null,
    montadaEm: carga?.criadaEm ?? null,
    recebidaNoStreetEm: recebida?.ocorridoEm ?? null,
    paradas: recebida ? montarParadas(pacotes, ruaDe) : [],
    ocorrencias,
  };
}

// ---------------------------------------------------------------------------
// Repassar CAIXAS → carga MONTADA
// ---------------------------------------------------------------------------

/** Chave vinda da tela: caixa (`regiao:<id>`) passa intacta; nome de rua vira a chave da rua. */
const chaveEntrada = (k: string) => (k.startsWith('regiao:') || k.startsWith('sem:') ? k : chaveRua(k));

/** Disponível para o repasse: sem carga e sem ajudante definitivo. RETORNADO (voltou ao fim do dia) também. */
const livre = (p: Pacote) => p.cargaId === null && (p.estado === 'NAO_ATRIBUIDO' || p.estado === 'ATRIBUIDO' || p.estado === 'RETORNADO');

/** Caixa que ficou fora de uma seleção de GRUPO inteiro (Associações), e por quê (sempre dito na tela). */
export interface RuaDeFora {
  rua: string;
  com: string;
  /** Pacotes da caixa que continuam no galpão (a caixa não se divide entre dois ajudantes). */
  pacotes: number;
}

type UnidadeDe = ReturnType<typeof resolvedorDeUnidade>;

/**
 * O que foi pedido → caixas:
 *  - caixa (`regiao:<id>`) → ela mesma;
 *  - GRUPO (Associações) → as caixas dele com pacote disponível; caixa já com OUTRO ajudante fica de fora
 *    COM aviso (`deFora`), porque uma caixa não fica com dois ajudantes;
 *  - nome de rua → a caixa dos pacotes dessa rua (rua ainda sem caixa: erro, vai para a triagem).
 */
function expandirPedido(
  ctx: Contexto,
  chave: string,
  pacotes: Pacote[],
  unidadeDe: UnidadeDe,
  ajudanteId: string,
): { caixas: string[]; deFora: RuaDeFora[] } {
  if (chave.startsWith('sem:')) {
    throw new ErroAplicacao('SEM_CAIXA', 'esses pacotes ainda não têm caixa: diga a caixa deles na triagem antes do repasse', 409);
  }
  if (!chave.startsWith('regiao:')) {
    const daRua = pacotes.filter((p) => unidadeDe(p).rua.chave === chave);
    const semCaixa = daRua.filter((p) => livre(p) && !unidadeDe(p).caixa);
    if (semCaixa.length > 0) {
      throw new ErroAplicacao('SEM_CAIXA', `${semCaixa.length} pacote(s) de ${unidadeDe(semCaixa[0]).rua.nome} ainda sem caixa: faça a triagem antes do repasse`, 409);
    }
    const caixas = [...new Set(daRua.map((p) => unidadeDe(p).chave))];
    return { caixas: caixas.length ? caixas : [chave], deFora: [] };
  }
  const id = chave.slice('regiao:'.length);
  const regiao = ctx.armazem.regioes.porId(id);
  if (!regiao) throw new ErroAplicacao('REGIAO_INEXISTENTE', 'caixa não encontrada', 404);
  const filhas = ctx.armazem.regioes.listar().filter((r) => r.paiId === id);
  if (filhas.length === 0) return { caixas: [chave], deFora: [] };
  const caixas: string[] = [];
  const deFora: RuaDeFora[] = [];
  for (const f of filhas) {
    const lista = pacotes.filter((p) => unidadeDe(p).caixa?.id === f.id);
    const noGalpao = lista.filter((p) => livre(p) && p.responsavelId === null).length;
    if (lista.filter(livre).length === 0) continue;
    const outro = lista.find((p) => p.responsavelId !== null && p.responsavelId !== ajudanteId);
    if (outro) {
      deFora.push({ rua: f.nome, com: ctx.armazem.ajudantes.porId(outro.responsavelId!)?.nome ?? 'outro ajudante', pacotes: noGalpao });
      continue;
    }
    caixas.push(`regiao:${f.id}`);
  }
  if (caixas.length === 0) {
    const motivo = deFora.length ? ` (${deFora.map((d) => `${d.rua} já está com ${d.com}`).join('; ')})` : '';
    throw new ErroAplicacao('REGIAO_SEM_PACOTES', `${regiao.nome} não tem pacotes disponíveis para repassar${motivo}`, 409);
  }
  return { caixas, deFora };
}

export function erroDominio<T>(fn: () => T, codigo?: string): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErroDominio) throw new ErroAplicacao(e.codigo, codigo ? `pacote ${codigo}: ${e.message}` : e.message, 409);
    throw e;
  }
}

/**
 * Repassa CAIXAS INTEIRAS a um ajudante. Os pacotes entram na carga ativa MONTADA dele
 * (ou numa carga nova). Tudo ou nada. Uma caixa não fica com dois ajudantes; pacote sem caixa não sai.
 * (Nome mantido: a API e o histórico já chamam assim; hoje cada "rua" da entrada é uma caixa.)
 */
export function atribuirRuas(
  ctx: Contexto,
  entrada: { ajudanteId: string; ruas: string[]; ator: string; chave: string },
): { carga: Carga; pacotes: number; ruas: RuaRef[]; deFora: RuaDeFora[] } {
  const pedidas = [...new Set(entrada.ruas.map(chaveEntrada).filter(Boolean))];
  if (pedidas.length === 0) throw new ErroAplicacao('SEM_RUAS', 'selecione ao menos uma caixa');
  if (!entrada.chave) throw new ErroAplicacao('SEM_CHAVE', 'chave de idempotência obrigatória');
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const ajudante = armazem.ajudantes.porId(entrada.ajudanteId);
    if (!ajudante) throw new ErroAplicacao('AJUDANTE_INEXISTENTE', 'ajudante não encontrado', 404);
    if (!ajudante.ativo) throw new ErroAplicacao('AJUDANTE_INATIVO', `${ajudante.nome} está INATIVO e não recebe repasse: ative o perfil em Ajudantes`, 409);
    const ref = { id: ajudante.id, nome: ajudante.nome };
    const agora = ctx.relogio.agora();

    let carga = armazem.cargas.ativaDoAjudante(ajudante.id);
    // Retry do mesmo clique (mesma chave): devolve o que já foi feito, sem erro e sem evento novo.
    const feito = carga && armazem.cargas.eventos(carga.id).find((e) => e.tipo === 'RUAS_ADICIONADAS' && e.dados.chave === entrada.chave);
    if (carga && feito && feito.tipo === 'RUAS_ADICIONADAS') {
      return { carga, pacotes: feito.dados.ruas.reduce((n, r) => n + r.quantidade, 0), ruas: feito.dados.ruas, deFora: [] };
    }
    if (carga?.rotaIniciadaEm) {
      throw new ErroAplicacao('JA_EM_ROTA', `${ajudante.nome} já está em rota com a carga ${carga.codigo}: carga em rota é FECHADA (não recebe novas caixas)`, 409);
    }

    // Valida TODAS as caixas antes de gravar qualquer coisa.
    const { pacotes } = pacotesNaOperacao(ctx);
    const unidadeDe = resolvedorDeUnidade(ctx);
    const expandidas = pedidas.map((k) => expandirPedido(ctx, k, pacotes, unidadeDe, ajudante.id));
    const chaves = [...new Set(expandidas.flatMap((e) => e.caixas))];
    const deFora = expandidas.flatMap((e) => e.deFora);
    const porCaixa = new Map<string, Pacote[]>();
    for (const p of pacotes) {
      const k = unidadeDe(p).chave;
      if (chaves.includes(k)) porCaixa.set(k, [...(porCaixa.get(k) ?? []), p]);
    }
    const ruasRef: RuaRef[] = [];
    const entram: { p: Pacote; caixa: Regiao | null }[] = [];
    for (const k of chaves) {
      const lista = porCaixa.get(k) ?? [];
      const nome = lista[0] ? unidadeDe(lista[0]).nome : k;
      const deOutro = lista.filter((p) => p.responsavelId !== null && p.responsavelId !== ajudante.id);
      if (deOutro.length > 0) {
        const outro = armazem.ajudantes.porId(deOutro[0].responsavelId!)?.nome ?? 'outro ajudante';
        throw new ErroAplicacao('CAIXA_DE_OUTRO', `a caixa ${nome} tem ${deOutro.length} pacote(s) com ${outro}: uma caixa não fica com dois ajudantes`, 409);
      }
      const livres = lista.filter(livre);
      if (livres.length === 0) throw new ErroAplicacao('CAIXA_SEM_PACOTES', `a caixa ${nome} não tem pacotes disponíveis para repassar`, 409);
      ruasRef.push({ chave: k, nome, quantidade: livres.length });
      entram.push(...livres.map((p) => ({ p, caixa: unidadeDe(p).caixa })));
    }

    if (!carga) {
      carga = {
        id: ctx.ids.novo(),
        codigo: codigoCarga(agora, ajudante.nome, armazem.cargas.contarPorPrefixo(prefixoCarga(agora, ajudante.nome)) + 1),
        ajudante: ref,
        pacoteIds: [],
        criadaEm: agora,
        criadaPor: entrada.ator,
        rotaIniciadaEm: null,
        rotaIniciadaPor: null,
        finalizadaEm: null,
        finalizadaPor: null,
      };
      armazem.cargas.criar(carga);
      armazem.cargas.anexarEvento({
        id: ctx.ids.novo(), cargaId: carga.id, tipo: 'CARGA_CRIADA',
        dados: { ajudante: ref, quantidade: entram.length }, ator: entrada.ator, ocorridoEm: agora, registradoEm: agora,
      });
    }
    const cargaRef = { id: carga.id, codigo: carga.codigo };
    const base = { ator: entrada.ator, origem: 'hub' as const, ocorridoEm: agora, registradoEm: agora };

    for (const { p, caixa } of entram) {
      if (p.estado === 'NAO_ATRIBUIDO' || p.estado === 'RETORNADO') {
        erroDominio(() => registrarEvento(armazem, {
          ...base, id: ctx.ids.novo(), pacoteId: p.id, tipo: 'ATRIBUIDO', dados: { ajudante: ref },
          chaveIdempotencia: `rua:${entrada.chave}:atribuido:${p.id}`,
        }), p.codigo);
      }
      erroDominio(() => registrarEvento(armazem, {
        ...base, id: ctx.ids.novo(), pacoteId: p.id, tipo: 'INCLUIDO_EM_CARGA',
        dados: { carga: cargaRef, ajudante: ref, ...(caixa ? { caixa: refCaixa(caixa) } : {}) },
        chaveIdempotencia: `rua:${entrada.chave}:incluido:${carga.id}:${p.id}`,
      }), p.codigo);
    }
    armazem.cargas.adicionarPacotes(carga.id, entram.map(({ p }) => p.id));
    armazem.cargas.anexarEvento({
      id: ctx.ids.novo(), cargaId: carga.id, tipo: 'RUAS_ADICIONADAS', dados: { ruas: ruasRef, chave: entrada.chave },
      ator: entrada.ator, ocorridoEm: agora, registradoEm: agora,
    });
    return { carga: armazem.cargas.porId(carga.id)!, pacotes: entram.length, ruas: ruasRef, deFora };
  });
}

/** Tira uma CAIXA de uma carga MONTADA. Os pacotes voltam ao galpão sem responsável (ou vão para outro ajudante). */
export function removerRuaDaCarga(
  ctx: Contexto,
  entrada: { cargaId: string; rua: string; ator: string; paraAjudanteId?: string },
): { pacotes: number } {
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const carga = armazem.cargas.porId(entrada.cargaId);
    if (!carga) throw new ErroAplicacao('CARGA_INEXISTENTE', 'carga não encontrada', 404);
    if (carga.rotaIniciadaEm || carga.finalizadaEm) {
      throw new ErroAplicacao('CARGA_NA_RUA', 'só é possível mexer nas caixas antes de iniciar a rota', 409);
    }
    const unidadeDe = resolvedorDeUnidade(ctx);
    const daCarga = carga.pacoteIds.map((id) => armazem.pacotes.porId(id)).filter((p): p is Pacote => !!p);
    let k = chaveEntrada(entrada.rua);
    // nome de rua → a caixa dela nesta carga (a caixa sai inteira)
    if (!k.startsWith('regiao:')) {
      const achado = daCarga.find((p) => unidadeDe(p).rua.chave === k);
      if (achado) k = unidadeDe(achado).chave;
    }
    const pacotes = daCarga.filter((p) => unidadeDe(p).chave === k);
    if (pacotes.length === 0) throw new ErroAplicacao('RUA_FORA_DA_CARGA', 'essa caixa não está na carga', 404);
    const rua: RuaRef = { chave: unidadeDe(pacotes[0]).chave, nome: unidadeDe(pacotes[0]).nome, quantidade: pacotes.length };
    const para = entrada.paraAjudanteId ? armazem.ajudantes.porId(entrada.paraAjudanteId) : undefined;
    if (entrada.paraAjudanteId && (!para || !para.ativo)) throw new ErroAplicacao('AJUDANTE_INEXISTENTE', 'ajudante de destino não encontrado', 404);
    if (para?.id === carga.ajudante.id) throw new ErroAplicacao('MESMO_AJUDANTE', 'a caixa já está com esse ajudante', 409);
    const agora = ctx.relogio.agora();
    const base = { ator: entrada.ator, origem: 'hub' as const, ocorridoEm: agora, registradoEm: agora };
    const motivo = para ? `caixa ${rua.nome} reatribuída para ${para.nome}` : `caixa ${rua.nome} removida da carga`;
    const marca = ctx.ids.novo();

    for (const p of pacotes) {
      erroDominio(() => registrarEvento(armazem, {
        ...base, id: ctx.ids.novo(), pacoteId: p.id, tipo: 'RETIRADO_DA_CARGA',
        dados: { carga: { id: carga.id, codigo: carga.codigo }, motivo }, chaveIdempotencia: `remover:${marca}:${p.id}`,
      }), p.codigo);
      if (para) {
        erroDominio(() => registrarEvento(armazem, {
          ...base, id: ctx.ids.novo(), pacoteId: p.id, tipo: 'REATRIBUIDO',
          dados: { de: carga.ajudante, para: { id: para.id, nome: para.nome } }, chaveIdempotencia: `reatribuir:${marca}:${p.id}`,
        }), p.codigo);
      } else {
        erroDominio(() => registrarEvento(armazem, {
          ...base, id: ctx.ids.novo(), pacoteId: p.id, tipo: 'DESATRIBUIDO',
          dados: { de: carga.ajudante, motivo }, chaveIdempotencia: `desatribuir:${marca}:${p.id}`,
        }), p.codigo);
      }
    }
    armazem.cargas.removerPacotes(carga.id, pacotes.map((p) => p.id));
    armazem.cargas.anexarEvento({
      id: ctx.ids.novo(), cargaId: carga.id, tipo: 'RUA_REMOVIDA',
      dados: { rua, motivo: para ? 'reatribuida' : 'removida', ...(para ? { para: { id: para.id, nome: para.nome } } : {}) },
      ator: entrada.ator, ocorridoEm: agora, registradoEm: agora,
    });
    // Reatribuir = a caixa inteira entra na carga do outro ajudante (mesmas regras do repasse).
    if (para) atribuirRuas(ctx, { ajudanteId: para.id, ruas: [rua.chave], ator: entrada.ator, chave: `reatrib:${marca}` });
    return { pacotes: pacotes.length };
  });
}

/** Encerra a carga. Só com todos os pacotes com desfecho (entregue ou insucesso). */
export function finalizarRota(ctx: Contexto, cargaId: string, ator: string): { jaFinalizada: boolean } {
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const carga = armazem.cargas.porId(cargaId);
    if (!carga) throw new ErroAplicacao('CARGA_INEXISTENTE', 'carga não encontrada', 404);
    if (carga.finalizadaEm) return { jaFinalizada: true };
    if (!carga.rotaIniciadaEm) throw new ErroAplicacao('ROTA_NAO_INICIADA', 'a rota ainda não foi iniciada', 409);
    const pacotes = carga.pacoteIds.map((id) => armazem.pacotes.porId(id)).filter((p): p is Pacote => !!p);
    const pendentes = pacotes.filter((p) => p.estado !== 'ENTREGUE' && p.estado !== 'INSUCESSO');
    if (pendentes.length > 0) {
      throw new ErroAplicacao('PACOTES_SEM_DESFECHO', `${pendentes.length} pacote(s) ainda sem desfecho: ${pendentes.slice(0, 5).map((p) => p.codigo).join(', ')}`, 409);
    }
    const agora = ctx.relogio.agora();
    armazem.cargas.marcarFinalizada(carga.id, agora, ator);
    armazem.cargas.anexarEvento({
      id: ctx.ids.novo(), cargaId: carga.id, tipo: 'ROTA_FINALIZADA',
      dados: { entregues: pacotes.filter((p) => p.estado === 'ENTREGUE').length, insucessos: pacotes.filter((p) => p.estado === 'INSUCESSO').length },
      ator, ocorridoEm: agora, registradoEm: agora,
    });
    return { jaFinalizada: false };
  });
}

// ---------------------------------------------------------------------------
// Repasse em lote (tela "Orquestrador de Repasse")
// ---------------------------------------------------------------------------

export interface PlanoRepasse {
  ajudanteId: string;
  ruas: string[];
}

/**
 * Confirma um PLANO de repasses (várias ruas para vários ajudantes) de uma vez só.
 * Tudo ou nada: se uma rua não puder ir para o ajudante planejado, nenhum repasse é gravado.
 * Cada repasse segue as mesmas regras de `atribuirRuas` (rua inteira, sem dividir, carga ativa única).
 */
export function confirmarRepasses(
  ctx: Contexto,
  entrada: { repasses: PlanoRepasse[]; ator: string; chave: string },
): { cargas: { ajudante: string; codigo: string; pacotes: number; ruas: number }[] } {
  // Um bloco por ajudante (a chave de idempotência é por ajudante; dois blocos dele se confundiriam com retry).
  const porAjudante = new Map<string, string[]>();
  for (const r of entrada.repasses) {
    if (r.ruas.length) porAjudante.set(r.ajudanteId, [...(porAjudante.get(r.ajudanteId) ?? []), ...r.ruas]);
  }
  const planos = [...porAjudante].map(([ajudanteId, ruas]) => ({ ajudanteId, ruas }));
  if (planos.length === 0) throw new ErroAplicacao('PLANO_VAZIO', 'nenhum repasse planejado');
  const todas = planos.flatMap((p) => p.ruas.map(chaveEntrada));
  if (new Set(todas).size !== todas.length) {
    throw new ErroAplicacao('RUA_REPETIDA_NO_PLANO', 'a mesma rua foi planejada para mais de um ajudante');
  }
  return ctx.armazem.transacao(() => ({
    cargas: planos.map((p) => {
      const r = atribuirRuas(ctx, { ajudanteId: p.ajudanteId, ruas: p.ruas, ator: entrada.ator, chave: `${entrada.chave}:${p.ajudanteId}` });
      return { ajudante: r.carga.ajudante.nome, codigo: r.carga.codigo, pacotes: r.pacotes, ruas: r.ruas.length };
    }),
  }));
}
