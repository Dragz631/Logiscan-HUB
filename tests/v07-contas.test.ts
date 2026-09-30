/**
 * V0.7 — CONTAS: criar conta (pedido do Street), entrar com PIN de 6 dígitos, aprovação só pelo master
 * (Ajudante / ADMIN / os dois, ligando a perfil existente ou criando perfil novo), sessões, bloqueio por tentativas,
 * primeiro acesso da master e o HUB trancado por papel. Roda nos dois motores (SQLite e Postgres).
 */
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aprovarConta,
  autenticar,
  criarConta,
  definirPrimeiroPin,
  entrar,
  garantirMaster,
  listarContas,
  recusarConta,
  renovar,
  sair,
} from '../src/application/contas';
import { criarPerfil } from '../src/application/orquestracao';
import type { Contexto } from '../src/application/portas';
import type { Conta } from '../src/domain/contas';
import { criarApi } from '../src/server/app';
import { contextoDeTeste } from './ajuda';

type Ctx = ReturnType<typeof contextoDeTeste>;

const erro = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as { codigo: string; message: string; status: number; extra: Record<string, unknown> };
  }
  throw new Error('esperava erro');
};

const PEDIDO = { nome: 'Maria Souza', usuario: 'maria', pin: '123456' };

/** Master criada pelo ambiente, com o PIN já definido no primeiro acesso. */
function comMaster(ctx: Ctx = contextoDeTeste()) {
  garantirMaster(ctx, { usuario: 'HugoDZLOG@logiscan.log', ajudanteNome: 'Hugo', codigoDeAtivacao: 'codigo-de-teste-unico' });
  definirPrimeiroPin(ctx, { usuario: 'hugodzlog', codigo: 'codigo-de-teste-unico', pin: '654321' });
  const master = ctx.armazem.contas.porUsuario('hugodzlog') as Conta;
  return { ctx, master };
}

describe('criar conta (pedido)', () => {
  it('1. nasce PENDENTE, usuário normalizado, PIN só como hash', () => {
    const ctx = contextoDeTeste();
    expect(criarConta(ctx, { ...PEDIDO, usuario: 'Maria Souza@logiscan.log', telefone: '21 99999-0000' })).toEqual({ situacao: 'PENDENTE' });
    const c = ctx.armazem.contas.porUsuario('mariasouza')!;
    expect(c).toMatchObject({ situacao: 'PENDENTE', papel: null, master: false, ajudanteId: null, telefone: '21 99999-0000' });
    expect(c.pinHash).toMatch(/^scrypt\$/);
    expect(c.pinHash).not.toContain('123456');
    expect(ctx.armazem.contas.historico(c.id).map((e) => e.tipo)).toEqual(['CONTA_CRIADA']);
  });

  it('2. usuário repetido (mesmo depois de normalizar) → USUARIO_EXISTENTE; entradas ruins → 400', () => {
    const ctx = contextoDeTeste();
    criarConta(ctx, PEDIDO);
    expect(erro(() => criarConta(ctx, { ...PEDIDO, usuario: 'MARIA@logiscan.log' }))).toMatchObject({ codigo: 'USUARIO_EXISTENTE', status: 409 });
    expect(erro(() => criarConta(ctx, { ...PEDIDO, usuario: 'joao', pin: '1234' })).codigo).toBe('ENTRADA_INVALIDA'); // 4 dígitos não serve
    expect(erro(() => criarConta(ctx, { ...PEDIDO, usuario: 'joao', pin: 'abcdef' })).codigo).toBe('ENTRADA_INVALIDA');
    expect(erro(() => criarConta(ctx, { ...PEDIDO, usuario: 'jo' })).codigo).toBe('ENTRADA_INVALIDA');
    expect(erro(() => criarConta(ctx, { ...PEDIDO, usuario: 'joao', nome: ' ' })).codigo).toBe('ENTRADA_INVALIDA');
  });

  it('3. fila de pedidos tem limite (não dá para encher o HUB de pedidos falsos)', () => {
    const ctx = contextoDeTeste();
    for (let i = 0; i < 50; i++) criarConta(ctx, { nome: `Pessoa ${i}`, usuario: `pessoa${i}`, pin: '111111' });
    expect(erro(() => criarConta(ctx, { nome: 'Mais uma', usuario: 'maisuma', pin: '111111' }))).toMatchObject({ codigo: 'FILA_CHEIA', status: 429 });
  });
});

describe('entrar', () => {
  it('4. conta pendente: PIN errado → PIN_INVALIDO (não revela nada); PIN certo → CONTA_PENDENTE; recusada → CONTA_RECUSADA', () => {
    const { ctx, master } = comMaster();
    criarConta(ctx, PEDIDO);
    expect(erro(() => entrar(ctx, { usuario: 'maria', pin: '000000' }))).toMatchObject({ codigo: 'PIN_INVALIDO', status: 401 });
    expect(erro(() => entrar(ctx, { usuario: 'maria', pin: '123456' }))).toMatchObject({ codigo: 'CONTA_PENDENTE', status: 403 });
    const id = ctx.armazem.contas.porUsuario('maria')!.id;
    recusarConta(ctx, master, id);
    expect(erro(() => entrar(ctx, { usuario: 'maria', pin: '123456' }))).toMatchObject({ codigo: 'CONTA_RECUSADA', status: 403 });
  });

  it('5. usuário que não existe = PIN_INVALIDO (igual a PIN errado)', () => {
    const ctx = contextoDeTeste();
    expect(erro(() => entrar(ctx, { usuario: 'ninguem', pin: '123456' }))).toMatchObject({ codigo: 'PIN_INVALIDO', status: 401 });
  });

  it('6. 5 erros bloqueiam por 15 min (429 com `ate`); passado o tempo volta; acerto zera a contagem', () => {
    const { ctx, master } = comMaster();
    criarConta(ctx, PEDIDO);
    const id = ctx.armazem.contas.porUsuario('maria')!.id;
    aprovarConta(ctx, master, { contaId: id, como: 'ADMIN' });
    for (let i = 0; i < 5; i++) expect(erro(() => entrar(ctx, { usuario: 'maria', pin: '000000' })).codigo).toBe('PIN_INVALIDO');
    const b = erro(() => entrar(ctx, { usuario: 'maria', pin: '123456' })); // até o PIN certo é barrado durante o bloqueio
    expect(b).toMatchObject({ codigo: 'BLOQUEADO', status: 429 });
    expect(typeof b.extra.ate).toBe('string');
    ctx.avancar(16);
    expect(entrar(ctx, { usuario: 'maria', pin: '123456' }).perfil.papel).toBe('ADMIN');
    for (let i = 0; i < 4; i++) erro(() => entrar(ctx, { usuario: 'maria', pin: '000000' }));
    entrar(ctx, { usuario: 'maria', pin: '123456' }); // acerto zera: mais 4 erros não bloqueiam
    for (let i = 0; i < 4; i++) erro(() => entrar(ctx, { usuario: 'maria', pin: '000000' }));
    expect(entrar(ctx, { usuario: 'maria', pin: '123456' }).token).toBeTruthy();
  });
});

describe('aprovação (só o master)', () => {
  it('7. como Ajudante, ligando a um perfil que já existe', () => {
    const { ctx, master } = comMaster();
    const kadu = criarPerfil(ctx, { nome: 'KADU' });
    criarConta(ctx, { nome: 'Carlos Eduardo', usuario: 'kadu', pin: '222222' });
    const id = ctx.armazem.contas.porUsuario('kadu')!.id;
    const c = aprovarConta(ctx, master, { contaId: id, como: 'AJUDANTE', ajudanteId: kadu.id });
    expect(c).toMatchObject({ situacao: 'APROVADA', papel: 'AJUDANTE', ajudanteId: kadu.id, decididaPor: master.nome });
    const login = entrar(ctx, { usuario: 'kadu@logiscan.log', pin: '222222' });
    expect(login.perfil).toEqual({ id: kadu.id, nome: 'Carlos Eduardo', papel: 'AJUDANTE', master: false });
    expect(ctx.armazem.contas.historico(id).map((e) => e.tipo)).toEqual(['CONTA_CRIADA', 'CONTA_APROVADA']);
  });

  it('8. como Ajudante, criando perfil novo com o nome da conta', () => {
    const { ctx, master } = comMaster();
    criarConta(ctx, PEDIDO);
    const c = aprovarConta(ctx, master, { contaId: ctx.armazem.contas.porUsuario('maria')!.id, como: 'AJUDANTE', criarPerfilNovo: true });
    expect(ctx.armazem.ajudantes.porId(c.ajudanteId!)).toMatchObject({ nome: 'Maria Souza' });
  });

  it('9. só ADMIN: não vira ajudante. Os dois: ADMIN_AJUDANTE precisa de perfil. Sem escolher, recusa com explicação', () => {
    const { ctx, master } = comMaster();
    criarConta(ctx, PEDIDO);
    const id = ctx.armazem.contas.porUsuario('maria')!.id;
    expect(erro(() => aprovarConta(ctx, master, { contaId: id, como: 'ADMIN_AJUDANTE' })).message).toMatch(/escolha um ajudante/);
    expect(ctx.armazem.contas.porId(id)!.situacao).toBe('PENDENTE'); // nada foi gravado
    expect(aprovarConta(ctx, master, { contaId: id, como: 'ADMIN' })).toMatchObject({ papel: 'ADMIN', ajudanteId: null });
    const irmao = criarPerfil(ctx, { nome: 'Irmão' });
    expect(aprovarConta(ctx, master, { contaId: id, como: 'ADMIN_AJUDANTE', ajudanteId: irmao.id })).toMatchObject({ papel: 'ADMIN_AJUDANTE', ajudanteId: irmao.id });
    expect(ctx.armazem.contas.historico(id).map((e) => e.tipo)).toEqual(['CONTA_CRIADA', 'CONTA_APROVADA', 'PAPEL_ALTERADO']);
  });

  it('10. um perfil não serve a duas contas', () => {
    const { ctx, master } = comMaster();
    const hugoPerfil = master.ajudanteId!;
    criarConta(ctx, PEDIDO);
    const e = erro(() => aprovarConta(ctx, master, { contaId: ctx.armazem.contas.porUsuario('maria')!.id, como: 'AJUDANTE', ajudanteId: hugoPerfil }));
    expect(e).toMatchObject({ codigo: 'AJUDANTE_JA_TEM_CONTA', status: 409 });
  });

  it('11. quem não é master não aprova, não recusa e não lista; a master não se recusa', () => {
    const { ctx, master } = comMaster();
    criarConta(ctx, PEDIDO);
    criarConta(ctx, { nome: 'Outro Admin', usuario: 'outro', pin: '333333' });
    const maria = ctx.armazem.contas.porUsuario('maria')!;
    aprovarConta(ctx, master, { contaId: ctx.armazem.contas.porUsuario('outro')!.id, como: 'ADMIN' });
    const outro = ctx.armazem.contas.porUsuario('outro')!;
    expect(erro(() => aprovarConta(ctx, outro, { contaId: maria.id, como: 'ADMIN' })).codigo).toBe('SO_O_MASTER');
    expect(erro(() => recusarConta(ctx, outro, maria.id)).codigo).toBe('SO_O_MASTER');
    expect(erro(() => listarContas(ctx, outro)).codigo).toBe('SO_O_MASTER');
    expect(erro(() => recusarConta(ctx, master, master.id)).codigo).toBe('CONTA_MASTER');
    expect(listarContas(ctx, master).map((c) => c.usuario)).toContain('maria');
    expect(JSON.stringify(listarContas(ctx, master))).not.toMatch(/scrypt|pinHash|ativacao/); // nunca hash na resposta
  });

  it('12. recusar derruba as sessões abertas da conta', () => {
    const { ctx, master } = comMaster();
    criarConta(ctx, PEDIDO);
    const id = ctx.armazem.contas.porUsuario('maria')!.id;
    aprovarConta(ctx, master, { contaId: id, como: 'ADMIN' });
    const { token } = entrar(ctx, { usuario: 'maria', pin: '123456' });
    expect(autenticar(ctx, token).usuario).toBe('maria');
    recusarConta(ctx, master, id);
    expect(erro(() => autenticar(ctx, token)).codigo).toBe('SESSAO_INVALIDA');
  });
});

describe('sessão', () => {
  it('13. token expira em 1 h; renovar gira o par (o refresh usado morre); sair revoga; só o hash fica no banco', () => {
    const { ctx, master } = comMaster();
    criarConta(ctx, PEDIDO);
    aprovarConta(ctx, master, { contaId: ctx.armazem.contas.porUsuario('maria')!.id, como: 'ADMIN' });
    const a = entrar(ctx, { usuario: 'maria', pin: '123456' });
    expect(autenticar(ctx, a.token).usuario).toBe('maria');
    const db = (ctx.armazem.contas as unknown as { db: import('../src/infrastructure/banco').Db }).db;
    const guardado = JSON.stringify(db.prepare('SELECT * FROM sessoes').all());
    expect(guardado).not.toContain(a.token);
    expect(guardado).not.toContain(a.renovar);

    ctx.avancar(61);
    expect(erro(() => autenticar(ctx, a.token)).codigo).toBe('SESSAO_INVALIDA');
    const b = renovar(ctx, { renovar: a.renovar });
    expect(autenticar(ctx, b.token).usuario).toBe('maria');
    expect(erro(() => renovar(ctx, { renovar: a.renovar })).codigo).toBe('SESSAO_INVALIDA'); // o refresh velho já foi usado
    sair(ctx, b.token);
    expect(erro(() => autenticar(ctx, b.token)).codigo).toBe('SESSAO_INVALIDA');
    expect(erro(() => autenticar(ctx, null)).codigo).toBe('SESSAO_INVALIDA');
    expect(erro(() => autenticar(ctx, 'token-inventado')).codigo).toBe('SESSAO_INVALIDA');
  });

  it('14. o histórico de contas é append-only (o banco recusa alterar ou apagar)', () => {
    const { ctx } = comMaster();
    const db = (ctx.armazem.contas as unknown as { db: import('../src/infrastructure/banco').Db }).db;
    expect(() => db.exec("UPDATE contas_historico SET ator = 'outro'")).toThrow(/append-only/);
    expect(() => db.exec('DELETE FROM contas_historico')).toThrow(/append-only/);
  });
});

describe('master e primeiro acesso', () => {
  it('15. nasce aprovada, ADMIN_AJUDANTE, ligada ao perfil "Hugo", SEM PIN (não dá para entrar antes do primeiro acesso)', () => {
    const ctx = contextoDeTeste();
    const r = garantirMaster(ctx, { usuario: 'HugoDZLOG@logiscan.log', codigoDeAtivacao: 'abc' });
    expect(r.criada).toBe(true);
    const m = ctx.armazem.contas.porUsuario('hugodzlog')!;
    expect(m).toMatchObject({ master: true, situacao: 'APROVADA', papel: 'ADMIN_AJUDANTE', pinHash: null });
    expect(ctx.armazem.ajudantes.porId(m.ajudanteId!)!.nome).toBe('Hugo');
    expect(erro(() => entrar(ctx, { usuario: 'hugodzlog', pin: '123456' })).codigo).toBe('PIN_INVALIDO');
    expect(garantirMaster(ctx, { usuario: 'HugoDZLOG@logiscan.log', codigoDeAtivacao: 'abc' }).criada).toBe(false); // idempotente
    expect(ctx.armazem.contas.listar().filter((c) => c.master)).toHaveLength(1);
  });

  it('16. liga ao perfil "Hugo" que já existe no banco (não cria outro)', () => {
    const ctx = contextoDeTeste();
    const hugo = criarPerfil(ctx, { nome: 'Hugo' });
    garantirMaster(ctx, { usuario: 'hugodzlog', codigoDeAtivacao: 'abc' });
    expect(ctx.armazem.contas.porUsuario('hugodzlog')!.ajudanteId).toBe(hugo.id);
    expect(ctx.armazem.ajudantes.listar()).toHaveLength(1);
  });

  it('17. primeiro acesso: código errado não serve (e bloqueia depois de 5); o certo define o PIN UMA vez', () => {
    const ctx = contextoDeTeste();
    garantirMaster(ctx, { usuario: 'hugodzlog', codigoDeAtivacao: 'codigo-certo' });
    expect(erro(() => definirPrimeiroPin(ctx, { usuario: 'hugodzlog', codigo: 'errado', pin: '654321' })).codigo).toBe('CODIGO_INVALIDO');
    expect(erro(() => definirPrimeiroPin(ctx, { usuario: 'hugodzlog', codigo: 'codigo-certo', pin: '1234' })).codigo).toBe('ENTRADA_INVALIDA');
    definirPrimeiroPin(ctx, { usuario: 'hugodzlog', codigo: 'codigo-certo', pin: '654321' });
    expect(entrar(ctx, { usuario: 'hugodzlog', pin: '654321' }).perfil).toMatchObject({ papel: 'ADMIN_AJUDANTE', master: true });
    // o código não vale duas vezes, nem serve para trocar o PIN depois
    expect(erro(() => definirPrimeiroPin(ctx, { usuario: 'hugodzlog', codigo: 'codigo-certo', pin: '111111' })).codigo).toBe('CODIGO_INVALIDO');
    expect(ctx.armazem.contas.historico(ctx.armazem.contas.porUsuario('hugodzlog')!.id).map((e) => e.tipo)).toEqual(['MASTER_CRIADA', 'PIN_DEFINIDO']);
  });

  it('18. o código de primeiro acesso vence em 72 h e as tentativas erradas bloqueiam', () => {
    const ctx = contextoDeTeste();
    garantirMaster(ctx, { usuario: 'hugodzlog', codigoDeAtivacao: 'codigo-certo' });
    ctx.avancar(73 * 60);
    expect(erro(() => definirPrimeiroPin(ctx, { usuario: 'hugodzlog', codigo: 'codigo-certo', pin: '654321' })).codigo).toBe('CODIGO_INVALIDO');
    // a tentativa com o código vencido já contou 1; mais 3 erradas = 4; a quinta bloqueia
    for (let i = 0; i < 3; i++) erro(() => definirPrimeiroPin(ctx, { usuario: 'hugodzlog', codigo: 'x', pin: '654321' }));
    expect(erro(() => definirPrimeiroPin(ctx, { usuario: 'hugodzlog', codigo: 'x', pin: '654321' })).codigo).toBe('CODIGO_INVALIDO');
    expect(erro(() => definirPrimeiroPin(ctx, { usuario: 'hugodzlog', codigo: 'codigo-certo', pin: '654321' })).codigo).toBe('BLOQUEADO');
    // renovar o código (o dono do ambiente troca a variável) vale enquanto o PIN não foi definido
    ctx.avancar(20);
    garantirMaster(ctx, { usuario: 'hugodzlog', codigoDeAtivacao: 'codigo-novo' });
    definirPrimeiroPin(ctx, { usuario: 'hugodzlog', codigo: 'codigo-novo', pin: '654321' });
    expect(entrar(ctx, { usuario: 'hugodzlog', pin: '654321' }).token).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// HTTP: o HUB trancado

const abertos: { close: () => void }[] = [];
let loginAntes: string | undefined;
beforeEach(() => {
  loginAntes = process.env.HUB_EXIGIR_LOGIN;
  process.env.HUB_EXIGIR_LOGIN = '1';
});
afterEach(() => {
  abertos.splice(0).forEach((s) => s.close());
  if (loginAntes === undefined) delete process.env.HUB_EXIGIR_LOGIN;
  else process.env.HUB_EXIGIR_LOGIN = loginAntes;
});

async function subir(ctx: Contexto) {
  const app = express();
  app.use('/api', criarApi(ctx));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  abertos.push(srv);
  return `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api`;
}

async function chamar(base: string, caminho: string, opcoes: { metodo?: string; corpo?: unknown; token?: string; origem?: string } = {}) {
  const r = await fetch(`${base}${caminho}`, {
    method: opcoes.metodo ?? (opcoes.corpo ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      ...(opcoes.token ? { authorization: `Bearer ${opcoes.token}` } : {}),
      ...(opcoes.origem ? { origin: opcoes.origem } : {}),
    },
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
  });
  const texto = await r.text();
  let json: Record<string, any> = {};
  try {
    json = JSON.parse(texto);
  } catch {
    // sem corpo JSON
  }
  return { status: r.status, json, cabecalhos: r.headers };
}

/** Login pelo HTTP, como o Street faria. */
async function logar(base: string, usuario: string, pin: string) {
  const r = await chamar(base, '/street/login', { corpo: { usuario, pin } });
  expect(r.status).toBe(200);
  return r.json as { token: string; renovar: string; perfil: { id: string | null; nome: string; papel: string; master: boolean } };
}

describe('HUB trancado (HTTP)', () => {
  it('19. sem token NADA do HUB responde; com token de ajudante, também não (só ADMIN aprovado)', async () => {
    const { ctx, master } = comMaster();
    const base = await subir(ctx);
    for (const caminho of ['/orquestrador', '/pacotes', '/ajudantes', '/cargas', '/dias', '/triagem', '/regioes', '/contas']) {
      const r = await chamar(base, caminho);
      expect(r.status, caminho).toBe(401);
      expect(r.json.codigo, caminho).toBe('SESSAO_INVALIDA');
    }
    expect((await chamar(base, '/importacoes', { corpo: { arquivo: 'x.json', conteudo: '{}' } })).status).toBe(401);
    expect((await chamar(base, '/novo-dia', { corpo: {} })).status).toBe(401);
    expect((await chamar(base, '/orquestrador', { token: 'inventado' })).status).toBe(401);

    criarConta(ctx, { nome: 'Ana Ajudante', usuario: 'ana', pin: '444444' });
    aprovarConta(ctx, master, { contaId: ctx.armazem.contas.porUsuario('ana')!.id, como: 'AJUDANTE', criarPerfilNovo: true });
    const ana = await logar(base, 'ana', '444444');
    const r = await chamar(base, '/orquestrador', { token: ana.token });
    expect(r.status).toBe(403);
    expect(r.json.codigo).toBe('SEM_PERMISSAO');
    expect((await chamar(base, '/contas', { token: ana.token })).status).toBe(403);
  });

  it('20. ADMIN aprovado vê o HUB; só a master vê e decide as contas', async () => {
    const { ctx, master } = comMaster();
    const base = await subir(ctx);
    criarConta(ctx, { nome: 'Bia Admin', usuario: 'bia', pin: '555555' });
    aprovarConta(ctx, master, { contaId: ctx.armazem.contas.porUsuario('bia')!.id, como: 'ADMIN' });
    const bia = await logar(base, 'bia', '555555');
    expect(bia.perfil).toMatchObject({ id: null, papel: 'ADMIN', master: false });
    expect((await chamar(base, '/orquestrador', { token: bia.token })).status).toBe(200);
    const r = await chamar(base, '/contas', { token: bia.token });
    expect(r.status).toBe(403);
    expect(r.json.codigo).toBe('SO_O_MASTER');

    const hugo = await logar(base, 'hugodzlog@logiscan.log', '654321');
    expect(hugo.perfil).toMatchObject({ papel: 'ADMIN_AJUDANTE', master: true });
    const lista = await chamar(base, '/contas', { token: hugo.token });
    expect(lista.status).toBe(200);
    expect((lista.json as unknown as { usuario: string }[]).map((c) => c.usuario)).toEqual(expect.arrayContaining(['bia', 'hugodzlog']));
    expect(JSON.stringify(lista.json)).not.toMatch(/scrypt|pinHash/);
  });

  it('21. criar conta pelo HTTP: campos extras (papel, situação, master) são ignorados — a conta nasce PENDENTE e não entra', async () => {
    const { ctx } = comMaster();
    const base = await subir(ctx);
    const r = await chamar(base, '/street/contas', {
      corpo: { nome: 'Invasor', usuario: 'invasor', pin: '999999', papel: 'ADMIN', situacao: 'APROVADA', master: true, ajudanteId: 'x' },
    });
    expect(r.status).toBe(201);
    expect(r.json).toEqual({ situacao: 'PENDENTE' });
    expect(ctx.armazem.contas.porUsuario('invasor')).toMatchObject({ situacao: 'PENDENTE', papel: null, master: false, ajudanteId: null });
    const l = await chamar(base, '/street/login', { corpo: { usuario: 'invasor', pin: '999999' } });
    expect(l.status).toBe(403);
    expect(l.json.codigo).toBe('CONTA_PENDENTE');
    expect((await chamar(base, '/orquestrador')).status).toBe(401);
    // duplicado
    const d = await chamar(base, '/street/contas', { corpo: { nome: 'Invasor 2', usuario: 'INVASOR', pin: '999999' } });
    expect(d.status).toBe(409);
    expect(d.json).toMatchObject({ erro: 'USUARIO_EXISTENTE', codigo: 'USUARIO_EXISTENTE' });
  });

  it('22. a master aprova pelo HTTP (ligando a perfil existente) e a conta passa a entrar', async () => {
    const { ctx } = comMaster();
    const kadu = criarPerfil(ctx, { nome: 'KADU' });
    const base = await subir(ctx);
    await chamar(base, '/street/contas', { corpo: { nome: 'Carlos', usuario: 'kadu', pin: '121212', veiculo: 'Moto' } });
    const hugo = await logar(base, 'hugodzlog', '654321');
    const id = ctx.armazem.contas.porUsuario('kadu')!.id;
    const a = await chamar(base, `/contas/${id}/aprovar`, { token: hugo.token, corpo: { como: 'AJUDANTE', ajudanteId: kadu.id } });
    expect(a.status).toBe(200);
    expect(a.json).toMatchObject({ situacao: 'APROVADA', papel: 'AJUDANTE', ajudanteId: kadu.id, decididaPor: 'Hugo' });
    const k = await logar(base, 'kadu', '121212');
    expect(k.perfil).toEqual({ id: kadu.id, nome: 'Carlos', papel: 'AJUDANTE', master: false });
  });

  it('23. o `ator` vem da conta logada: o que o navegador mandar no corpo é ignorado', async () => {
    const { ctx } = comMaster();
    const base = await subir(ctx);
    const hugo = await logar(base, 'hugodzlog', '654321');
    const r = await chamar(base, '/regioes', { token: hugo.token, corpo: { nome: 'Caixa Teste', ator: 'Invasor Qualquer' } });
    expect(r.status).toBe(201);
    expect(ctx.armazem.regioes.porNome('Caixa Teste')!.criadaPor).toBe('Hugo');
  });

  it('24. rotas do Street só respondem ao próprio ajudante; perfil de outro → 403; sem token → 401', async () => {
    const { ctx, master } = comMaster();
    const base = await subir(ctx);
    criarConta(ctx, { nome: 'Ana', usuario: 'ana', pin: '444444' });
    criarConta(ctx, { nome: 'Beto', usuario: 'beto', pin: '555555' });
    const ana = aprovarConta(ctx, master, { contaId: ctx.armazem.contas.porUsuario('ana')!.id, como: 'AJUDANTE', criarPerfilNovo: true });
    const beto = aprovarConta(ctx, master, { contaId: ctx.armazem.contas.porUsuario('beto')!.id, como: 'AJUDANTE', criarPerfilNovo: true });
    const tAna = await logar(base, 'ana', '444444');

    expect((await chamar(base, `/street/perfis/${ana.ajudanteId}/cargas`)).status).toBe(401);
    expect((await chamar(base, `/street/perfis/${ana.ajudanteId}/cargas`, { token: tAna.token })).status).toBe(200);
    const outro = await chamar(base, `/street/perfis/${beto.ajudanteId}/cargas`, { token: tAna.token });
    expect(outro.status).toBe(403);
    expect(outro.json.codigo).toBe('SEM_PERMISSAO');

    const evento = (ajudanteId: string) => ({
      schema: 'logiscan.street-eventos/v0', gerado_em: '2026-09-23T15:00:00.000Z', ajudante: { id: ajudanteId, nome: 'x' }, eventos: [],
    });
    expect((await chamar(base, '/street/eventos', { corpo: evento(ana.ajudanteId!) })).status).toBe(401);
    expect((await chamar(base, '/street/eventos', { token: tAna.token, corpo: evento(beto.ajudanteId!) })).status).toBe(403);
    expect((await chamar(base, '/street/cargas/qualquer/recebida', { token: tAna.token, corpo: { ajudanteId: beto.ajudanteId, quantidade: 1 } })).status).toBe(403);
    expect((await chamar(base, '/street/perfis')).status).toBe(401);
    expect((await chamar(base, '/street/perfis', { token: tAna.token })).status).toBe(200);
  });

  it('25. login: erro traz `erro` e `codigo`; bloqueio traz `ate` (429); renovar e sair pelo HTTP', async () => {
    const { ctx } = comMaster();
    const base = await subir(ctx);
    const ruim = await chamar(base, '/street/login', { corpo: { usuario: 'hugodzlog', pin: '000000' } });
    expect(ruim.status).toBe(401);
    expect(ruim.json).toMatchObject({ erro: 'PIN_INVALIDO', codigo: 'PIN_INVALIDO' });
    for (let i = 0; i < 4; i++) await chamar(base, '/street/login', { corpo: { usuario: 'hugodzlog', pin: '000000' } });
    const bloq = await chamar(base, '/street/login', { corpo: { usuario: 'hugodzlog', pin: '654321' } });
    expect(bloq.status).toBe(429);
    expect(bloq.json).toMatchObject({ codigo: 'BLOQUEADO' });
    expect(typeof bloq.json.ate).toBe('string');

    ctx.avancar(16);
    const l = await logar(base, 'hugodzlog', '654321');
    const novo = await chamar(base, '/street/renovar', { corpo: { renovar: l.renovar } });
    expect(novo.status).toBe(200);
    expect((await chamar(base, '/street/renovar', { corpo: { renovar: l.renovar } })).status).toBe(401);
    expect((await chamar(base, '/orquestrador', { token: novo.json.token })).status).toBe(200);
    await chamar(base, '/street/sair', { token: novo.json.token, corpo: {} });
    expect((await chamar(base, '/orquestrador', { token: novo.json.token })).status).toBe(401);
  });

  it('26. /eu diz quem está logado; CORS libera o Street da Vercel com Authorization e nega origem estranha', async () => {
    const { ctx } = comMaster();
    const base = await subir(ctx);
    expect((await chamar(base, '/eu')).status).toBe(401);
    const hugo = await logar(base, 'hugodzlog', '654321');
    expect((await chamar(base, '/eu', { token: hugo.token })).json).toMatchObject({ semLogin: false, perfil: { nome: 'Hugo', papel: 'ADMIN_AJUDANTE', master: true } });

    const ok = await chamar(base, '/street/login', { metodo: 'OPTIONS', origem: 'https://safa-sanha.vercel.app' });
    expect(ok.status).toBe(204);
    expect(ok.cabecalhos.get('access-control-allow-origin')).toBe('https://safa-sanha.vercel.app');
    expect(ok.cabecalhos.get('access-control-allow-headers')).toMatch(/Authorization/);
    const mau = await chamar(base, '/street/login', { metodo: 'OPTIONS', origem: 'https://site-mal-intencionado.example' });
    expect(mau.cabecalhos.get('access-control-allow-origin')).toBeNull();
  });

  it('27. sem login obrigatório (HUB local de sempre) nada muda: as telas abrem e perfil sem conta segue sem token', async () => {
    delete process.env.HUB_EXIGIR_LOGIN;
    const ctx = contextoDeTeste();
    const perfil = criarPerfil(ctx, { nome: 'Sem Conta' });
    const base = await subir(ctx);
    expect((await chamar(base, '/orquestrador')).status).toBe(200);
    expect((await chamar(base, `/street/perfis/${perfil.id}/cargas`)).status).toBe(200);
    expect((await chamar(base, '/eu')).json).toEqual({ semLogin: true });
    expect((await chamar(base, '/contas')).json.codigo).toBe('LOGIN_DESLIGADO');
  });
});
