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
import { type RegiaoDaRua, consultorDeRegioes } from './regioes';

// ---------------------------------------------------------------------------
// Perfis
// ---------------------------------------------------------------------------

export interface DadosPerfil {
  nome: string;
  veiculo?: string | null;
  capacidade?: number | null;
  ativo?: boolean;
}

function validarPerfil(d: DadosPerfil): { nome: string; veiculo: string | null; capacidade: number | null } {
  const nome = d.nome.replace(/\s+/g, ' ').trim();
  if (!nome) throw new ErroAplicacao('NOME_VAZIO', 'informe o nome do ajudante');
  const capacidade = d.capacidade === undefined || d.capacidade === null ? null : Math.trunc(Number(d.capacidade));
  if (capacidade !== null && (!Number.isFinite(capacidade) || capacidade <= 0)) {
    throw new ErroAplicacao('CAPACIDADE_INVALIDA', 'capacidade deve ser um número de pacotes maior que zero');
  }
  return { nome, veiculo: d.veiculo?.trim() || null, capacidade };
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
  return agruparPorRua(pacotesNaOperacao(ctx).pacotes).map((r) => ({ ...r, regiao: regiaoDe(r.chave) }));
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
  /** pacotes / capacidade (null sem capacidade definida). */
  ocupacao: number | null;
  excesso: boolean;
}

function resumoPerfil(ctx: Contexto, a: Ajudante): ResumoPerfil {
  const carga = ctx.armazem.cargas.ativaDoAjudante(a.id) ?? null;
  const pacotes = carga ? carga.pacoteIds.map((id) => ctx.armazem.pacotes.porId(id)).filter((p): p is Pacote => !!p) : [];
  const entregues = pacotes.filter((p) => p.estado === 'ENTREGUE').length;
  const insucessos = pacotes.filter((p) => p.estado === 'INSUCESSO').length;
  const situacao = !carga ? null : !carga.rotaIniciadaEm ? 'MONTADA' : entregues + insucessos === pacotes.length && pacotes.length > 0 ? 'CONCLUIDA' : 'EM_ROTA';
  return {
    ajudante: a,
    carga: carga && situacao ? { id: carga.id, codigo: carga.codigo, situacao } : null,
    pacotes: pacotes.length,
    ruas: new Set(pacotes.map((p) => chaveRua(p.dados.rua))).size,
    entregues,
    insucessos,
    pendentes: pacotes.length - entregues - insucessos,
    progresso: pacotes.length ? Math.round(((entregues + insucessos) / pacotes.length) * 100) : 0,
    ocupacao: a.capacidade ? pacotes.length / a.capacidade : null,
    excesso: a.capacidade !== null && pacotes.length > a.capacidade,
  };
}

export function listarPerfis(ctx: Contexto): ResumoPerfil[] {
  return ctx.armazem.ajudantes.listar().map((a) => resumoPerfil(ctx, a));
}

export interface RuaDoPerfil extends RuaRef {
  entregues: number;
  insucessos: number;
  pendentes: number;
}

export interface DetalhePerfil extends ResumoPerfil {
  ruasDaCarga: RuaDoPerfil[];
  rotaIniciadaEm: string | null;
  montadaEm: string | null;
  /** Últimos acontecimentos dos pacotes da carga atual (mais recentes primeiro). */
  ocorrencias: (Evento & { codigo: string })[];
}

export function ruasDaCarga(pacotes: Pacote[]): RuaDoPerfil[] {
  return agruparPorRua(pacotes).map((r) => ({
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
  const r = resumoPerfil(ctx, a);
  const carga = ctx.armazem.cargas.ativaDoAjudante(a.id);
  const pacotes = carga ? carga.pacoteIds.map((id) => ctx.armazem.pacotes.porId(id)).filter((p): p is Pacote => !!p) : [];
  const ocorrencias = pacotes
    .flatMap((p) => ctx.armazem.eventos.doPacote(p.id).map((e) => ({ ...e, codigo: p.codigo })))
    .sort((x, y) => y.ocorridoEm.localeCompare(x.ocorridoEm))
    .slice(0, 15);
  return { ...r, ruasDaCarga: ruasDaCarga(pacotes), rotaIniciadaEm: carga?.rotaIniciadaEm ?? null, montadaEm: carga?.criadaEm ?? null, ocorrencias };
}

// ---------------------------------------------------------------------------
// Atribuir ruas → carga MONTADA
// ---------------------------------------------------------------------------

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
): { carga: Carga; pacotes: number; ruas: RuaRef[] } {
  const chaves = [...new Set(entrada.ruas.map(chaveRua).filter(Boolean))];
  if (chaves.length === 0) throw new ErroAplicacao('SEM_RUAS', 'selecione ao menos uma rua');
  if (!entrada.chave) throw new ErroAplicacao('SEM_CHAVE', 'chave de idempotência obrigatória');
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const ajudante = armazem.ajudantes.porId(entrada.ajudanteId);
    if (!ajudante || !ajudante.ativo) throw new ErroAplicacao('AJUDANTE_INEXISTENTE', 'ajudante não encontrado ou inativo', 404);
    const ref = { id: ajudante.id, nome: ajudante.nome };
    const agora = ctx.relogio.agora();

    let carga = armazem.cargas.ativaDoAjudante(ajudante.id);
    // Retry do mesmo clique (mesma chave): devolve o que já foi feito, sem erro e sem evento novo.
    const feito = carga && armazem.cargas.eventos(carga.id).find((e) => e.tipo === 'RUAS_ADICIONADAS' && e.dados.chave === entrada.chave);
    if (carga && feito && feito.tipo === 'RUAS_ADICIONADAS') {
      return { carga, pacotes: feito.dados.ruas.reduce((n, r) => n + r.quantidade, 0), ruas: feito.dados.ruas };
    }
    if (carga?.rotaIniciadaEm) {
      throw new ErroAplicacao('JA_EM_ROTA', `${ajudante.nome} já está em rota com a carga ${carga.codigo}: finalize a rota antes de atribuir novas ruas`, 409);
    }

    // Valida TODAS as ruas antes de gravar qualquer coisa.
    const { pacotes } = pacotesNaOperacao(ctx);
    const porRua = new Map<string, Pacote[]>();
    for (const p of pacotes) {
      const k = chaveRua(p.dados.rua);
      if (chaves.includes(k)) porRua.set(k, [...(porRua.get(k) ?? []), p]);
    }
    const ruasRef: RuaRef[] = [];
    const entram: Pacote[] = [];
    for (const k of chaves) {
      const lista = porRua.get(k) ?? [];
      const nome = agruparPorRua(lista)[0]?.nome ?? k;
      const deOutro = lista.filter((p) => p.responsavelId !== null && p.responsavelId !== ajudante.id);
      if (deOutro.length > 0) {
        const outro = armazem.ajudantes.porId(deOutro[0].responsavelId!)?.nome ?? 'outro ajudante';
        throw new ErroAplicacao('RUA_DE_OUTRO', `a rua ${nome} tem ${deOutro.length} pacote(s) com ${outro}: uma rua não fica com dois ajudantes`, 409);
      }
      const livres = lista.filter((p) => p.cargaId === null && (p.estado === 'NAO_ATRIBUIDO' || p.estado === 'ATRIBUIDO'));
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
    return { carga: armazem.cargas.porId(carga.id)!, pacotes: entram.length, ruas: ruasRef };
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
    const k = chaveRua(entrada.rua);
    const pacotes = carga.pacoteIds.map((id) => armazem.pacotes.porId(id)).filter((p): p is Pacote => !!p && chaveRua(p.dados.rua) === k);
    if (pacotes.length === 0) throw new ErroAplicacao('RUA_FORA_DA_CARGA', 'essa rua não está na carga', 404);
    const rua: RuaRef = { chave: k, nome: agruparPorRua(pacotes)[0].nome, quantidade: pacotes.length };
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
  const todas = planos.flatMap((p) => p.ruas.map(chaveRua));
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
