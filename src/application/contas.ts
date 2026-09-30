/**
 * CONTAS — criar conta (pedido do Street), entrar, sessões, aprovação pelo master e primeiro acesso.
 *
 * Regras (decididas pelo Hugo):
 *  - a conta nasce PENDENTE; só o MASTER aprova e define o papel (Ajudante, ADMIN ou os dois);
 *  - ao aprovar como Ajudante, liga a um perfil que já existe OU cria um perfil novo;
 *  - sem papel aprovado a conta não vê nada;
 *  - PIN de 6 dígitos (o mínimo do Supabase), guardado com scrypt + sal; 5 erros bloqueiam a conta por 15 min;
 *  - o master nasce de variáveis de ambiente, SEM PIN: ele define o PIN no primeiro acesso com um código de uso único.
 */
import {
  type Conta,
  type ContaPublica,
  PAPEIS,
  PIN_VALIDO,
  type Papel,
  type Sessao,
  erroDeUsuario,
  normalizarUsuario,
  publica,
  temAdmin,
  temAjudante,
} from '../domain/contas';
import { ErroAplicacao } from './erros';
import { criarPerfil } from './orquestracao';
import type { Contexto } from './portas';
import { conferenciaFalsa, conferirPin, hashPin, hashToken, iguaisEmTempoConstante, novoToken } from './segredos';

const MINUTOS_DO_TOKEN = 60;
const DIAS_DO_RENOVAR = 30;
const MAX_TENTATIVAS = 5;
const MINUTOS_DE_BLOQUEIO = 15;
const MAX_PENDENTES = 50;
const HORAS_DO_CODIGO_DE_ATIVACAO = 72;

const somarMinutos = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString();
const invalido = (mensagem: string) => new ErroAplicacao('ENTRADA_INVALIDA', mensagem);

function texto(valor: unknown, campo: string, min: number, max: number, obrigatorio: boolean): string | null {
  const t = typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ') : '';
  if (!t) {
    if (obrigatorio) throw invalido(`${campo}: informe o ${campo}`);
    return null;
  }
  if (t.length < min || t.length > max) throw invalido(`${campo}: de ${min} a ${max} caracteres`);
  return t;
}

// ---------------------------------------------------------------------------
// Criar conta (pedido)

export interface EntradaCriarConta {
  nome: string;
  usuario: string;
  pin: string;
  telefone?: string | null;
  veiculo?: string | null;
}

export function criarConta(ctx: Contexto, e: EntradaCriarConta): { situacao: 'PENDENTE' } {
  const nome = texto(e.nome, 'nome', 2, 80, true)!;
  const usuario = normalizarUsuario(String(e.usuario ?? ''));
  const motivo = erroDeUsuario(usuario);
  if (motivo) throw invalido(`usuario: ${motivo}`);
  if (typeof e.pin !== 'string' || !PIN_VALIDO.test(e.pin)) throw invalido('pin: o PIN tem 6 dígitos');
  const telefone = texto(e.telefone, 'telefone', 8, 30, false);
  const veiculo = texto(e.veiculo, 'veiculo', 2, 60, false);
  const pinHash = hashPin(e.pin);
  const { armazem } = ctx;
  return armazem.transacao(() => {
    if (armazem.contas.porUsuario(usuario)) throw new ErroAplicacao('USUARIO_EXISTENTE', 'já existe uma conta com esse usuário', 409);
    const pendentes = armazem.contas.listar().filter((c) => c.situacao === 'PENDENTE').length;
    if (pendentes >= MAX_PENDENTES) {
      throw new ErroAplicacao('FILA_CHEIA', 'há pedidos de conta demais esperando aprovação; avise o Hugo', 429);
    }
    const agora = ctx.relogio.agora();
    const conta: Conta = {
      id: ctx.ids.novo(), usuario, nome, telefone, veiculo, pinHash, situacao: 'PENDENTE', papel: null, master: false,
      ajudanteId: null, ativacaoHash: null, ativacaoExpiraEm: null, tentativas: 0, bloqueadaAte: null, criadaEm: agora,
      decididaEm: null, decididaPor: null,
    };
    armazem.contas.criar(conta);
    armazem.contas.anexarHistorico({ id: ctx.ids.novo(), contaId: conta.id, tipo: 'CONTA_CRIADA', dados: { usuario, nome }, ator: usuario, ocorridoEm: agora });
    return { situacao: 'PENDENTE' as const };
  });
}

// ---------------------------------------------------------------------------
// Entrar, renovar, sair, conferir token

export interface PerfilDeLogin {
  /** Id do perfil de ajudante ligado (nulo para quem é só ADMIN). */
  id: string | null;
  nome: string;
  papel: Papel;
  master: boolean;
}

export interface ResultadoLogin {
  token: string;
  renovar: string;
  expiraEm: string;
  perfil: PerfilDeLogin;
}

function perfilDe(c: Conta): PerfilDeLogin {
  return { id: c.ajudanteId, nome: c.nome, papel: c.papel!, master: c.master };
}

function abrirSessao(ctx: Contexto, conta: Conta): ResultadoLogin {
  const agora = ctx.relogio.agora();
  const token = novoToken();
  const renovar = novoToken();
  const sessao: Sessao = {
    tokenHash: hashToken(token),
    renovarHash: hashToken(renovar),
    contaId: conta.id,
    criadaEm: agora,
    expiraEm: somarMinutos(agora, MINUTOS_DO_TOKEN),
    renovarExpiraEm: somarMinutos(agora, DIAS_DO_RENOVAR * 24 * 60),
    revogadaEm: null,
  };
  ctx.armazem.contas.criarSessao(sessao);
  return { token, renovar, expiraEm: sessao.expiraEm, perfil: perfilDe(conta) };
}

const pinInvalido = () => new ErroAplicacao('PIN_INVALIDO', 'usuário ou PIN incorreto', 401);

/** Conta uma tentativa errada; na quinta, bloqueia por 15 minutos. Grava mesmo quando a operação falha depois. */
function registrarErro(ctx: Contexto, conta: Conta): void {
  const agora = ctx.relogio.agora();
  const tentativas = conta.tentativas + 1;
  ctx.armazem.contas.atualizar(
    tentativas >= MAX_TENTATIVAS
      ? { ...conta, tentativas: 0, bloqueadaAte: somarMinutos(agora, MINUTOS_DE_BLOQUEIO) }
      : { ...conta, tentativas },
  );
}

function exigirLivre(ctx: Contexto, conta: Conta): void {
  if (conta.bloqueadaAte && conta.bloqueadaAte > ctx.relogio.agora()) {
    throw new ErroAplicacao('BLOQUEADO', 'muitas tentativas erradas: tente de novo mais tarde', 429, { ate: conta.bloqueadaAte });
  }
}

export function entrar(ctx: Contexto, e: { usuario: string; pin: string }): ResultadoLogin {
  const usuario = normalizarUsuario(String(e.usuario ?? ''));
  const pin = typeof e.pin === 'string' ? e.pin : '';
  const { armazem } = ctx;
  const conta = armazem.contas.porUsuario(usuario);
  if (!conta) {
    conferenciaFalsa(pin); // quem não existe demora o mesmo que quem existe
    throw pinInvalido();
  }
  exigirLivre(ctx, conta);
  const certo = PIN_VALIDO.test(pin) && conferirPin(pin, conta.pinHash);
  if (!certo) {
    armazem.transacao(() => registrarErro(ctx, conta));
    throw pinInvalido();
  }
  // PIN certo: só agora se revela a situação da conta.
  if (conta.situacao === 'PENDENTE') throw new ErroAplicacao('CONTA_PENDENTE', 'sua conta ainda espera a aprovação do Hugo', 403);
  if (conta.situacao === 'RECUSADA') throw new ErroAplicacao('CONTA_RECUSADA', 'sua conta não foi aprovada', 403);
  return armazem.transacao(() => {
    const limpa = conta.tentativas === 0 && !conta.bloqueadaAte ? conta : { ...conta, tentativas: 0, bloqueadaAte: null };
    if (limpa !== conta) armazem.contas.atualizar(limpa);
    return abrirSessao(ctx, limpa);
  });
}

export function renovar(ctx: Contexto, e: { renovar: string }): ResultadoLogin {
  const { armazem } = ctx;
  const sessao = typeof e.renovar === 'string' ? armazem.contas.sessaoPorRenovar(hashToken(e.renovar)) : undefined;
  const agora = ctx.relogio.agora();
  if (!sessao || sessao.revogadaEm || sessao.renovarExpiraEm <= agora) {
    throw new ErroAplicacao('SESSAO_INVALIDA', 'sessão expirada: entre de novo', 401);
  }
  const conta = armazem.contas.porId(sessao.contaId);
  if (!conta || conta.situacao !== 'APROVADA' || !conta.papel) {
    throw new ErroAplicacao('SESSAO_INVALIDA', 'sessão expirada: entre de novo', 401);
  }
  return armazem.transacao(() => {
    armazem.contas.revogarSessao(sessao.tokenHash, agora); // o refresh token usado morre: cada um vale uma vez
    return abrirSessao(ctx, conta);
  });
}

export function sair(ctx: Contexto, token: string): void {
  ctx.armazem.contas.revogarSessao(hashToken(token), ctx.relogio.agora());
}

/** Confere o token. 401 se não vale; 403 se a conta não está aprovada (ex.: foi recusada depois). */
export function autenticar(ctx: Contexto, token: string | null): Conta {
  const sessao = token ? ctx.armazem.contas.sessaoPorToken(hashToken(token)) : undefined;
  if (!sessao || sessao.revogadaEm || sessao.expiraEm <= ctx.relogio.agora()) {
    throw new ErroAplicacao('SESSAO_INVALIDA', 'entre de novo', 401);
  }
  const conta = ctx.armazem.contas.porId(sessao.contaId);
  if (!conta) throw new ErroAplicacao('SESSAO_INVALIDA', 'entre de novo', 401);
  if (conta.situacao !== 'APROVADA' || !conta.papel) throw new ErroAplicacao('SEM_PERMISSAO', 'esta conta não tem acesso', 403);
  return conta;
}

// ---------------------------------------------------------------------------
// Aprovação (só o master)

function exigirMaster(ator: Conta): void {
  if (!ator.master) throw new ErroAplicacao('SO_O_MASTER', 'só a conta master aprova contas e muda papéis', 403);
}

export interface EntradaPapel {
  contaId: string;
  como: Papel;
  /** Ligar a um perfil de ajudante que já existe… */
  ajudanteId?: string | null;
  /** …ou criar um perfil novo com o nome da conta. */
  criarPerfilNovo?: boolean;
}

/** Decide o perfil de ajudante de uma conta que recebe o papel `como`. */
function perfilDoPapel(ctx: Contexto, conta: Conta, e: EntradaPapel): string | null {
  if (!PAPEIS.includes(e.como)) throw invalido(`como: use ${PAPEIS.join(', ')}`);
  if (!temAjudante(e.como)) return null; // só ADMIN: não é ajudante
  const { armazem } = ctx;
  if (e.ajudanteId) {
    const a = armazem.ajudantes.porId(e.ajudanteId);
    if (!a) throw new ErroAplicacao('AJUDANTE_INEXISTENTE', 'esse ajudante não existe', 404);
    const dono = armazem.contas.porAjudante(a.id);
    if (dono && dono.id !== conta.id) throw new ErroAplicacao('AJUDANTE_JA_TEM_CONTA', `${a.nome} já está ligado à conta ${dono.usuario}`, 409);
    return a.id;
  }
  if (e.criarPerfilNovo) return criarPerfil(ctx, { nome: conta.nome, veiculo: conta.veiculo }).id;
  if (conta.ajudanteId) return conta.ajudanteId; // já ligada: mantém
  throw invalido('escolha um ajudante que já existe ou crie um perfil novo');
}

export function aprovarConta(ctx: Contexto, ator: Conta, e: EntradaPapel): ContaPublica {
  exigirMaster(ator);
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const conta = armazem.contas.porId(e.contaId);
    if (!conta) throw new ErroAplicacao('CONTA_INEXISTENTE', 'conta não encontrada', 404);
    if (conta.master) throw new ErroAplicacao('CONTA_MASTER', 'a conta master não muda por aqui', 409);
    const ajudanteId = perfilDoPapel(ctx, conta, e);
    const agora = ctx.relogio.agora();
    const nova: Conta = { ...conta, situacao: 'APROVADA', papel: e.como, ajudanteId, decididaEm: agora, decididaPor: ator.nome };
    armazem.contas.atualizar(nova);
    armazem.contas.anexarHistorico({
      id: ctx.ids.novo(), contaId: conta.id, tipo: conta.situacao === 'APROVADA' ? 'PAPEL_ALTERADO' : 'CONTA_APROVADA',
      dados: { papel: e.como, ajudanteId, antes: { situacao: conta.situacao, papel: conta.papel } }, ator: ator.nome, ocorridoEm: agora,
    });
    return publica(nova);
  });
}

export function recusarConta(ctx: Contexto, ator: Conta, contaId: string): ContaPublica {
  exigirMaster(ator);
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const conta = armazem.contas.porId(contaId);
    if (!conta) throw new ErroAplicacao('CONTA_INEXISTENTE', 'conta não encontrada', 404);
    if (conta.master) throw new ErroAplicacao('CONTA_MASTER', 'a conta master não pode ser recusada', 409);
    const agora = ctx.relogio.agora();
    const nova: Conta = { ...conta, situacao: 'RECUSADA', papel: null, decididaEm: agora, decididaPor: ator.nome };
    armazem.contas.atualizar(nova);
    armazem.contas.revogarSessoesDaConta(conta.id, agora);
    armazem.contas.anexarHistorico({ id: ctx.ids.novo(), contaId: conta.id, tipo: 'CONTA_RECUSADA', dados: {}, ator: ator.nome, ocorridoEm: agora });
    return publica(nova);
  });
}

export function listarContas(ctx: Contexto, ator: Conta): ContaPublica[] {
  exigirMaster(ator);
  return ctx.armazem.contas.listar().map(publica);
}

// ---------------------------------------------------------------------------
// Master e primeiro acesso

export interface ConfigMaster {
  usuario: string;
  nome?: string;
  /** Nome do perfil de ajudante do master (padrão "Hugo"). */
  ajudanteNome?: string;
  /** Código de uso único do primeiro acesso (segredo de ambiente). */
  codigoDeAtivacao?: string;
}

/**
 * Garante que a conta master existe. Ela nasce APROVADA como ADMIN_AJUDANTE, SEM PIN: o PIN é definido por
 * quem tem o código de ativação (primeiro acesso). Idempotente: rodar de novo não muda nada, a não ser
 * renovar o código enquanto o PIN ainda não foi definido.
 */
export function garantirMaster(ctx: Contexto, cfg: ConfigMaster): { criada: boolean } {
  const usuario = normalizarUsuario(cfg.usuario);
  if (erroDeUsuario(usuario)) throw new Error(`HUB_MASTER_USUARIO inválido: ${erroDeUsuario(usuario)}`);
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const agora = ctx.relogio.agora();
    const ativacaoHash = cfg.codigoDeAtivacao ? hashToken(cfg.codigoDeAtivacao) : null;
    const ativacaoExpiraEm = ativacaoHash ? somarMinutos(agora, HORAS_DO_CODIGO_DE_ATIVACAO * 60) : null;
    const existente = armazem.contas.listar().find((c) => c.master);
    if (existente) {
      if (existente.pinHash === null && ativacaoHash && existente.ativacaoHash !== ativacaoHash) {
        armazem.contas.atualizar({ ...existente, ativacaoHash, ativacaoExpiraEm });
      }
      return { criada: false };
    }
    const nomeAjudante = (cfg.ajudanteNome ?? 'Hugo').trim();
    const perfil =
      armazem.ajudantes.listar().find((a) => a.nome.toLowerCase() === nomeAjudante.toLowerCase()) ?? criarPerfil(ctx, { nome: nomeAjudante });
    if (armazem.contas.porAjudante(perfil.id)) return { criada: false };
    const conta: Conta = {
      id: ctx.ids.novo(), usuario, nome: cfg.nome ?? nomeAjudante, telefone: null, veiculo: null, pinHash: null, situacao: 'APROVADA',
      papel: 'ADMIN_AJUDANTE', master: true, ajudanteId: perfil.id, ativacaoHash, ativacaoExpiraEm, tentativas: 0, bloqueadaAte: null,
      criadaEm: agora, decididaEm: agora, decididaPor: 'sistema',
    };
    armazem.contas.criar(conta);
    armazem.contas.anexarHistorico({ id: ctx.ids.novo(), contaId: conta.id, tipo: 'MASTER_CRIADA', dados: { usuario }, ator: 'sistema', ocorridoEm: agora });
    return { criada: true };
  });
}

/** Primeiro acesso da master: com o código de uso único, define o PIN de 6 dígitos. */
export function definirPrimeiroPin(ctx: Contexto, e: { usuario: string; codigo: string; pin: string }): void {
  const usuario = normalizarUsuario(String(e.usuario ?? ''));
  const { armazem } = ctx;
  const conta = armazem.contas.porUsuario(usuario);
  const naoServe = () => new ErroAplicacao('CODIGO_INVALIDO', 'código de primeiro acesso inválido ou vencido', 401);
  if (!conta || !conta.master || conta.pinHash !== null || !conta.ativacaoHash) throw naoServe();
  exigirLivre(ctx, conta);
  if (typeof e.pin !== 'string' || !PIN_VALIDO.test(e.pin)) throw invalido('pin: o PIN tem 6 dígitos');
  const agora = ctx.relogio.agora();
  const certo =
    typeof e.codigo === 'string' &&
    iguaisEmTempoConstante(hashToken(e.codigo), conta.ativacaoHash) &&
    !!conta.ativacaoExpiraEm &&
    conta.ativacaoExpiraEm > agora;
  if (!certo) {
    armazem.transacao(() => registrarErro(ctx, conta));
    throw naoServe();
  }
  const pinHash = hashPin(e.pin);
  armazem.transacao(() => {
    armazem.contas.atualizar({ ...conta, pinHash, ativacaoHash: null, ativacaoExpiraEm: null, tentativas: 0, bloqueadaAte: null });
    armazem.contas.anexarHistorico({ id: ctx.ids.novo(), contaId: conta.id, tipo: 'PIN_DEFINIDO', dados: { primeiroAcesso: true }, ator: conta.usuario, ocorridoEm: agora });
  });
}

export { temAdmin, temAjudante };
