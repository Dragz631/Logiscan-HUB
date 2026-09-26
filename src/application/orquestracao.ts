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
import { ErroDominio, type Evento } from '../domain/eventos';
import type { Pacote } from '../domain/pacote';
import { type ResumoRua, agruparPorRua, chaveRua, naOperacao } from '../domain/ruas';
import { ErroAplicacao } from './erros';
import type { Ajudante, Contexto } from './portas';
import { registrarEvento } from './registrarEvento';
import { type RegiaoDaRua, consultorDeRegioes, resolvedorDeRua } from './regioes';

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
    const a: Ajudante = { id: ctx.ids.novo(), ativo: d.ativo ?? true, criadoEm: ctx.relogio.agora(), ...v };
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

/** Ruas da operação, cada uma com a região vinda da memória do HUB (desconhecida = revisão). */
export function listarRuas(ctx: Contexto): RuaNoOrquestrador[] {
  const regiaoDe = consultorDeRegioes(ctx);
  return agruparPorRua(pacotesNaOperacao(ctx).pacotes, resolvedorDeRua(ctx)).map((r) => ({ ...r, regiao: regiaoDe(r.chave) }));
}

/**
 * UNIDADE DE REPASSE — o card da coluna Origem.
 *   regiao → várias ruas que se repassam juntas (Manilha, Quinta do Caju); as ruas só aparecem ao expandir;
 *   grupo  → região de repasse único (Diversos): uma "rua operacional" com vários logradouros dentro;
 *   rua    → rua sem região: ela própria é o card (sem camada extra).
 * A unidade só organiza a seleção: a atribuição continua levando RUAS inteiras.
 */
export interface UnidadeRepasse {
  /** `regiao:<id>` para região/grupo; chave da rua (street_id) para rua solta. */
  chave: string;
  tipo: 'regiao' | 'grupo' | 'rua';
  nome: string;
  regiao: RegiaoDaRua;
  total: number;
  disponiveis: number;
  atribuidos: number;
  revisao: number;
  responsaveis: string[];
  /** Conteúdo ao expandir (grupo: 1 rua operacional, com os logradouros dentro). */
  ruas: RuaNoOrquestrador[];
}

export function agruparEmUnidades(ruas: RuaNoOrquestrador[]): UnidadeRepasse[] {
  const unidades = new Map<string, UnidadeRepasse>();
  for (const r of ruas) {
    const grupo = r.chave.startsWith('regiao:');
    const regiao = !grupo && r.regiao.status === 'conhecida' ? r.regiao : null;
    const chave = grupo ? r.chave : regiao ? `regiao:${regiao.id}` : r.chave;
    if (!unidades.has(chave)) {
      unidades.set(chave, {
        chave,
        tipo: grupo ? 'grupo' : regiao ? 'regiao' : 'rua',
        nome: regiao ? regiao.nome : r.nome,
        regiao: r.regiao,
        total: 0, disponiveis: 0, atribuidos: 0, revisao: 0, responsaveis: [], ruas: [],
      });
    }
    const u = unidades.get(chave)!;
    u.ruas.push(r);
    u.total += r.total;
    u.disponiveis += r.disponiveis;
    u.atribuidos += r.atribuidos;
    u.revisao += r.revisao;
    u.responsaveis = [...new Set([...u.responsaveis, ...r.responsaveis])];
  }
  const ordem = { regiao: 0, grupo: 0, rua: 1 } as const;
  return [...unidades.values()].sort((a, b) => ordem[a.tipo] - ordem[b.tipo] || a.nome.localeCompare(b.nome, 'pt-BR'));
}

export function listarUnidades(ctx: Contexto): UnidadeRepasse[] {
  return agruparEmUnidades(listarRuas(ctx));
}

export interface ResumoPerfil {
  ajudante: Ajudante;
  carga: { id: string; codigo: string; situacao: 'MONTADA' | 'EM_ROTA' | 'CONCLUIDA' } | null;
  pacotes: number;
  ruas: number;
  entregues: number;
  insucessos: number;
  pendentes: number;
  /** % de pacotes com desfecho. */
  progresso: number;
  rotaIniciadaEm: string | null;
  /** Quando o Street do perfil confirmou que carregou a carga (null = ainda não chegou). */
  recebidaNoStreetEm: string | null;
}

function resumoPerfil(ctx: Contexto, a: Ajudante, ruaDe = resolvedorDeRua(ctx)): ResumoPerfil {
  const carga = ctx.armazem.cargas.ativaDoAjudante(a.id) ?? null;
  const pacotes = carga ? carga.pacoteIds.map((id) => ctx.armazem.pacotes.porId(id)).filter((p): p is Pacote => !!p) : [];
  const entregues = pacotes.filter((p) => p.estado === 'ENTREGUE').length;
  const insucessos = pacotes.filter((p) => p.estado === 'INSUCESSO').length;
  const situacao = !carga ? null : !carga.rotaIniciadaEm ? 'MONTADA' : entregues + insucessos === pacotes.length && pacotes.length > 0 ? 'CONCLUIDA' : 'EM_ROTA';
  return {
    ajudante: a,
    carga: carga && situacao ? { id: carga.id, codigo: carga.codigo, situacao } : null,
    pacotes: pacotes.length,
    ruas: new Set(pacotes.map((p) => ruaDe(p).chave)).size,
    entregues,
    insucessos,
    pendentes: pacotes.length - entregues - insucessos,
    progresso: pacotes.length ? Math.round(((entregues + insucessos) / pacotes.length) * 100) : 0,
    rotaIniciadaEm: carga?.rotaIniciadaEm ?? null,
    recebidaNoStreetEm: carga ? (ctx.armazem.cargas.eventos(carga.id).filter((e) => e.tipo === 'RECEBIDA_NO_STREET').at(-1)?.ocorridoEm ?? null) : null,
  };
}

export function listarPerfis(ctx: Contexto): ResumoPerfil[] {
  const ruaDe = resolvedorDeRua(ctx);
  return ctx.armazem.ajudantes.listar().map((a) => resumoPerfil(ctx, a, ruaDe));
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

export interface DetalhePerfil extends ResumoPerfil {
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
  const regiaoDe = consultorDeRegioes(ctx);
  const r = resumoPerfil(ctx, a, ruaDe);
  const carga = ctx.armazem.cargas.ativaDoAjudante(a.id);
  const pacotes = carga ? carga.pacoteIds.map((id) => ctx.armazem.pacotes.porId(id)).filter((p): p is Pacote => !!p) : [];
  const ocorrencias = pacotes
    .flatMap((p) => ctx.armazem.eventos.doPacote(p.id).map((e) => ({ ...e, codigo: p.codigo })))
    .sort((x, y) => y.ocorridoEm.localeCompare(x.ocorridoEm))
    .slice(0, 15);
  const recebida = carga ? ctx.armazem.cargas.eventos(carga.id).filter((e) => e.tipo === 'RECEBIDA_NO_STREET').at(-1) : undefined;
  return {
    ...r,
    ruasDaCarga: ruasDaCarga(pacotes, ruaDe).map((x) => ({ ...x, regiao: regiaoDe(x.chave) })),
    rotaIniciadaEm: carga?.rotaIniciadaEm ?? null,
    montadaEm: carga?.criadaEm ?? null,
    recebidaNoStreetEm: recebida?.ocorridoEm ?? null,
    paradas: recebida ? montarParadas(pacotes, ruaDe) : [],
    ocorrencias,
  };
}

// ---------------------------------------------------------------------------
// Atribuir ruas → carga MONTADA
// ---------------------------------------------------------------------------

/** Chave de rua vinda da tela: nome de rua é normalizado; grupo (`regiao:<id>`, ex.: Diversos) passa intacto. */
const chaveEntrada = (k: string) => (k.startsWith('regiao:') ? k : chaveRua(k));

const livre = (p: Pacote) => p.cargaId === null && (p.estado === 'NAO_ATRIBUIDO' || p.estado === 'ATRIBUIDO');

/** Rua que ficou fora de uma seleção de REGIÃO inteira, e por quê (sempre dito na tela). */
export interface RuaDeFora {
  rua: string;
  com: string;
  /** Pacotes da rua que continuam no galpão (a rua não se divide entre dois ajudantes). */
  pacotes: number;
}

/**
 * Selecionar a REGIÃO inteira (`regiao:<id>`) = todas as ruas dela que ainda têm pacote disponível.
 * Rua já toda com ajudante fica de fora. Rua DIVIDIDA (parte já com OUTRO ajudante) também fica de fora —
 * uma rua não fica com dois ajudantes — e volta em `deFora` para a tela avisar. Região de repasse único
 * (Diversos) já é a própria "rua". Rua escolhida sozinha continua recusando com erro (não é silenciosa).
 */
function expandirRegiao(
  ctx: Contexto,
  chave: string,
  pacotes: Pacote[],
  ruaDe: (p: Pacote) => { chave: string; nome: string },
  ajudanteId: string,
): { ruas: string[]; deFora: RuaDeFora[] } {
  if (!chave.startsWith('regiao:')) return { ruas: [chave], deFora: [] };
  const id = chave.slice('regiao:'.length);
  const regiao = ctx.armazem.regioes.porId(id);
  if (!regiao) throw new ErroAplicacao('REGIAO_INEXISTENTE', 'região não encontrada', 404);
  if (regiao.repasseUnico) return { ruas: [chave], deFora: [] };
  const regiaoDe = consultorDeRegioes(ctx);
  const porRua = new Map<string, Pacote[]>();
  for (const p of pacotes) {
    const k = ruaDe(p).chave;
    const r = regiaoDe(k);
    if (r.status === 'conhecida' && r.id === id) porRua.set(k, [...(porRua.get(k) ?? []), p]);
  }
  const ruas: string[] = [];
  const deFora: RuaDeFora[] = [];
  for (const [k, lista] of porRua) {
    const livres = lista.filter(livre).length;
    if (livres === 0) continue;
    const outro = lista.find((p) => p.responsavelId !== null && p.responsavelId !== ajudanteId);
    if (outro) {
      const noGalpao = lista.filter((p) => livre(p) && p.responsavelId === null).length;
      deFora.push({ rua: ruaDe(outro).nome, com: ctx.armazem.ajudantes.porId(outro.responsavelId!)?.nome ?? 'outro ajudante', pacotes: noGalpao });
      continue;
    }
    ruas.push(k);
  }
  if (ruas.length === 0) {
    const motivo = deFora.length ? ` (${deFora.map((d) => `${d.rua} já está com ${d.com}`).join('; ')})` : '';
    throw new ErroAplicacao('REGIAO_SEM_PACOTES', `a região ${regiao.nome} não tem pacotes disponíveis para atribuir${motivo}`, 409);
  }
  return { ruas, deFora };
}

function erroDominio<T>(fn: () => T, codigo?: string): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErroDominio) throw new ErroAplicacao(e.codigo, codigo ? `pacote ${codigo}: ${e.message}` : e.message, 409);
    throw e;
  }
}

/**
 * Atribui ruas INTEIRAS a um ajudante. Os pacotes entram na carga ativa MONTADA dele
 * (ou numa carga nova). Tudo ou nada.
 */
export function atribuirRuas(
  ctx: Contexto,
  entrada: { ajudanteId: string; ruas: string[]; ator: string; chave: string },
): { carga: Carga; pacotes: number; ruas: RuaRef[]; deFora: RuaDeFora[] } {
  const pedidas = [...new Set(entrada.ruas.map(chaveEntrada).filter(Boolean))];
  if (pedidas.length === 0) throw new ErroAplicacao('SEM_RUAS', 'selecione ao menos uma rua');
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
      throw new ErroAplicacao('JA_EM_ROTA', `${ajudante.nome} já está em rota com a carga ${carga.codigo}: carga em rota é FECHADA (não recebe novas ruas)`, 409);
    }

    // Valida TODAS as ruas antes de gravar qualquer coisa.
    const { pacotes } = pacotesNaOperacao(ctx);
    const ruaDe = resolvedorDeRua(ctx);
    const expandidas = pedidas.map((k) => expandirRegiao(ctx, k, pacotes, ruaDe, ajudante.id));
    const chaves = [...new Set(expandidas.flatMap((e) => e.ruas))];
    const deFora = expandidas.flatMap((e) => e.deFora).filter((d) => !chaves.includes(chaveEntrada(d.rua)));
    const porRua = new Map<string, Pacote[]>();
    for (const p of pacotes) {
      const k = ruaDe(p).chave;
      if (chaves.includes(k)) porRua.set(k, [...(porRua.get(k) ?? []), p]);
    }
    const ruasRef: RuaRef[] = [];
    const entram: Pacote[] = [];
    for (const k of chaves) {
      const lista = porRua.get(k) ?? [];
      const nome = agruparPorRua(lista, ruaDe)[0]?.nome ?? k;
      const deOutro = lista.filter((p) => p.responsavelId !== null && p.responsavelId !== ajudante.id);
      if (deOutro.length > 0) {
        const outro = armazem.ajudantes.porId(deOutro[0].responsavelId!)?.nome ?? 'outro ajudante';
        throw new ErroAplicacao('RUA_DE_OUTRO', `a rua ${nome} tem ${deOutro.length} pacote(s) com ${outro}: uma rua não fica com dois ajudantes`, 409);
      }
      const livres = lista.filter(livre);
      if (livres.length === 0) throw new ErroAplicacao('RUA_SEM_PACOTES', `a rua ${nome} não tem pacotes disponíveis para atribuir`, 409);
      ruasRef.push({ chave: k, nome, quantidade: livres.length });
      entram.push(...livres);
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

    for (const p of entram) {
      if (p.estado === 'NAO_ATRIBUIDO') {
        erroDominio(() => registrarEvento(armazem, {
          ...base, id: ctx.ids.novo(), pacoteId: p.id, tipo: 'ATRIBUIDO', dados: { ajudante: ref },
          chaveIdempotencia: `rua:${entrada.chave}:atribuido:${p.id}`,
        }), p.codigo);
      }
      erroDominio(() => registrarEvento(armazem, {
        ...base, id: ctx.ids.novo(), pacoteId: p.id, tipo: 'INCLUIDO_EM_CARGA', dados: { carga: cargaRef, ajudante: ref },
        chaveIdempotencia: `rua:${entrada.chave}:incluido:${carga.id}:${p.id}`,
      }), p.codigo);
    }
    armazem.cargas.adicionarPacotes(carga.id, entram.map((p) => p.id));
    armazem.cargas.anexarEvento({
      id: ctx.ids.novo(), cargaId: carga.id, tipo: 'RUAS_ADICIONADAS', dados: { ruas: ruasRef, chave: entrada.chave },
      ator: entrada.ator, ocorridoEm: agora, registradoEm: agora,
    });
    return { carga: armazem.cargas.porId(carga.id)!, pacotes: entram.length, ruas: ruasRef, deFora };
  });
}

/** Tira uma rua de uma carga MONTADA. Os pacotes voltam ao galpão sem responsável (ou vão para outro ajudante). */
export function removerRuaDaCarga(
  ctx: Contexto,
  entrada: { cargaId: string; rua: string; ator: string; paraAjudanteId?: string },
): { pacotes: number } {
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const carga = armazem.cargas.porId(entrada.cargaId);
    if (!carga) throw new ErroAplicacao('CARGA_INEXISTENTE', 'carga não encontrada', 404);
    if (carga.rotaIniciadaEm || carga.finalizadaEm) {
      throw new ErroAplicacao('CARGA_NA_RUA', 'só é possível mexer nas ruas antes de iniciar a rota', 409);
    }
    const k = chaveEntrada(entrada.rua);
    const ruaDe = resolvedorDeRua(ctx);
    const pacotes = carga.pacoteIds.map((id) => armazem.pacotes.porId(id)).filter((p): p is Pacote => !!p && ruaDe(p).chave === k);
    if (pacotes.length === 0) throw new ErroAplicacao('RUA_FORA_DA_CARGA', 'essa rua não está na carga', 404);
    const rua: RuaRef = { chave: k, nome: agruparPorRua(pacotes, ruaDe)[0].nome, quantidade: pacotes.length };
    const para = entrada.paraAjudanteId ? armazem.ajudantes.porId(entrada.paraAjudanteId) : undefined;
    if (entrada.paraAjudanteId && (!para || !para.ativo)) throw new ErroAplicacao('AJUDANTE_INEXISTENTE', 'ajudante de destino não encontrado', 404);
    if (para?.id === carga.ajudante.id) throw new ErroAplicacao('MESMO_AJUDANTE', 'a rua já está com esse ajudante', 409);
    const agora = ctx.relogio.agora();
    const base = { ator: entrada.ator, origem: 'hub' as const, ocorridoEm: agora, registradoEm: agora };
    const motivo = para ? `rua ${rua.nome} reatribuída para ${para.nome}` : `rua ${rua.nome} removida da carga`;
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
    // Reatribuir = a rua inteira entra na carga do outro ajudante (mesmas regras de atribuição).
    if (para) atribuirRuas(ctx, { ajudanteId: para.id, ruas: [k], ator: entrada.ator, chave: `reatrib:${marca}` });
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
