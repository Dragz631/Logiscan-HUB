/**
 * Autenticação das rotas HTTP. Camada fina: lê o token, pede à aplicação para conferir, barra ou deixa passar.
 *
 * Login OBRIGATÓRIO na Vercel (variável VERCEL) ou com HUB_EXIGIR_LOGIN=1. No HUB local de sempre (SQLite no PC, sem
 * essas variáveis) o HUB segue aberto como antes; por isso `loginObrigatorio()` é decidido aqui, num lugar só.
 *
 * Com login: nenhuma rota do HUB responde sem token de conta APROVADA com papel ADMIN; as rotas do Street só
 * respondem ao próprio ajudante; aprovar contas é só do master. O `ator` de cada ação vem da conta logada
 * (o que o navegador mandar no corpo é ignorado).
 */
import type { Request, RequestHandler } from 'express';
import { autenticar } from '../application/contas';
import { ErroAplicacao } from '../application/erros';
import type { Contexto } from '../application/portas';
import { temAdmin, temAjudante } from '../domain/contas';

export const loginObrigatorio = (): boolean => !!process.env.VERCEL || process.env.HUB_EXIGIR_LOGIN === '1';

export function lerToken(req: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
  return m ? m[1].trim() : null;
}

function carimbarAtor(req: Request, nome: string): void {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) (req.body as Record<string, unknown>).ator = nome;
}

/** Só conta aprovada com papel ADMIN (ou ADMIN_AJUDANTE) usa as telas do HUB. */
export function exigirAdmin(ctx: Contexto): RequestHandler {
  return (req, res, next) => {
    if (!loginObrigatorio()) return next();
    const conta = autenticar(ctx, lerToken(req));
    if (!temAdmin(conta.papel)) throw new ErroAplicacao('SEM_PERMISSAO', 'esta conta não tem acesso às telas do HUB', 403);
    res.locals.conta = conta;
    carimbarAtor(req, conta.nome);
    next();
  };
}

/** Aprovar contas e mudar papéis: só a conta master. */
export function exigirMaster(ctx: Contexto): RequestHandler {
  return (req, res, next) => {
    // Sem login obrigatório (HUB local) não há conta para aprovar: a tela de contas só vale com login.
    if (!loginObrigatorio()) throw new ErroAplicacao('LOGIN_DESLIGADO', 'as contas só existem quando o login do HUB está ligado', 409);
    const conta = autenticar(ctx, lerToken(req));
    if (!conta.master || !temAdmin(conta.papel)) throw new ErroAplicacao('SO_O_MASTER', 'só a conta master faz isto', 403);
    res.locals.conta = conta;
    carimbarAtor(req, conta.nome);
    next();
  };
}

/** Qualquer conta aprovada (ex.: listar perfis no Street). */
export function exigirLogin(ctx: Contexto): RequestHandler {
  return (_req, res, next) => {
    if (!loginObrigatorio()) return next();
    res.locals.conta = autenticar(ctx, lerToken(_req));
    next();
  };
}

/**
 * Rotas do Street que falam de UM ajudante: só a conta ligada a esse perfil passa.
 * Legado: sem login obrigatório, perfil SEM conta continua funcionando sem token (Street antigo na rede local).
 */
export function exigirAjudanteDoPerfil(ctx: Contexto, idDoPedido: (req: Request) => string | undefined): RequestHandler {
  return (req, res, next) => {
    const id = idDoPedido(req);
    if (!loginObrigatorio() && id && !ctx.armazem.contas.porAjudante(id)) return next();
    const conta = autenticar(ctx, lerToken(req));
    if (!temAjudante(conta.papel) || !conta.ajudanteId || conta.ajudanteId !== id) {
      throw new ErroAplicacao('SEM_PERMISSAO', 'este perfil não é o da sua conta', 403);
    }
    res.locals.conta = conta;
    next();
  };
}
