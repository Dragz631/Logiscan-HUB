/**
 * V0.7 — ASSOCIAÇÕES: a lista de pessoas e de pacotes de cada associação, para o Hugo mandar às mulheres.
 * O HUB distribui sozinho quem ele lembra (nome + rua); o que não sabe espera a Triagem; nada de chute.
 */
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definirResponsavelDaAssociacao, listasDasAssociacoes } from '../src/application/associacoes';
import { aprovarConta, criarConta, definirPrimeiroPin, garantirMaster } from '../src/application/contas';
import { confirmarImportacao, prepararImportacao } from '../src/application/importacao';
import { encerrarDia } from '../src/application/novoDia';
import type { Contexto } from '../src/application/portas';
import { aplicarConhecimentoInicial } from '../src/application/regioes';
import { classificarPacote } from '../src/application/triagem';
import { agruparPessoas, dataEHoraSP, nomeParaLista, textoDaLista } from '../src/domain/listaAssociacao';
import { criarApi } from '../src/server/app';
import { contextoDeTeste, documento, pacote } from './ajuda';

const CATALOGO = JSON.parse(readFileSync('src/infrastructure/conhecimento/conhecimento-inicial.json', 'utf8'));

let lote = 0;
function importar(ctx: Contexto, pacotes: Record<string, unknown>[]) {
  const r = prepararImportacao(ctx, { arquivo: `lote-${++lote}.json`, conteudo: documento(pacotes, { generated_at: `g${lote}` }) });
  if (!r.ok) throw new Error('import');
  confirmarImportacao(ctx, r.loteId, 'Galpão');
}

const seidl = (cod: string, nome: string, numero: string, card: number) =>
  pacote({ tracking_code: cod, recipient_name: nome, street: 'Rua Carlos Seidl', number: numero, cep: '20931002' }, card);
const gurjao = (cod: string, nome: string, numero: string, card: number) =>
  pacote({ tracking_code: cod, recipient_name: nome, street: 'Rua General Gurjão', number: numero, cep: '20931040' }, card);
const semCaixa = (cod: string, nome: string, card: number) =>
  pacote({ tracking_code: cod, recipient_name: nome, street: 'Rua Que Ninguem Conhece', number: '5', cep: '20999999' }, card);

/** Primeiro dia: Mariana (2 pacotes) e José entregues em associações; Paulo e Bia ficam nas caixas das ruas deles. */
function dia1() {
  const ctx = contextoDeTeste();
  aplicarConhecimentoInicial(ctx, CATALOGO);
  importar(ctx, [
    seidl('S1', 'Mariana Souza', '10', 0), seidl('S2', 'Mariana Souza', '12', 1), seidl('S3', 'José Lima', '14', 2),
    seidl('S4', 'Paulo Costa', '20', 3), gurjao('G1', 'Bia', '7', 4), semCaixa('X1', 'Quem É Esse', 5),
  ]);
  const cx = (n: string) => ctx.armazem.regioes.listar().find((r) => r.numero === n)!;
  const p = (c: string) => ctx.armazem.pacotes.porChave('jtexpress', c)!;
  const mover = (cod: string, caixa: string, substituir = false) => classificarPacote(ctx, { pacoteId: p(cod).id, caixaId: cx(caixa).id, ator: 'Hugo', substituir });
  mover('S1', '10.1');
  mover('S2', '10.1');
  mover('S3', '10.2');
  return { ctx, cx, p, mover };
}

const erro = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as { codigo: string; message: string; status: number };
  }
  throw new Error('esperava erro');
};

describe('lista por associação', () => {
  it('1. cada associação tem as suas pessoas; a mesma pessoa vira UMA linha com a soma dos pacotes', () => {
    const { ctx, cx } = dia1();
    const l = listasDasAssociacoes(ctx);
    expect(l.associacoes.map((a) => [a.numero, a.totalPacotes, a.totalPessoas])).toEqual([['10.1', 2, 1], ['10.2', 1, 1], ['10.3', 0, 0], ['10.4', 0, 0]]);
    const chatuba = l.associacoes[0];
    expect(chatuba.caixaId).toBe(cx('10.1').id);
    expect(chatuba.pessoas).toMatchObject([{ nome: 'Mariana Souza', pacotes: 2 }]);
    expect(chatuba.pessoas[0].pacoteIds).toHaveLength(2);
    expect(l.associacoes[1].pessoas).toMatchObject([{ nome: 'José Lima', pacotes: 1 }]);
  });

  it('2. quem fica na caixa da rua (Paulo, Bia) NÃO entra em lista de associação; o que não tem caixa só é contado', () => {
    const { ctx } = dia1();
    const l = listasDasAssociacoes(ctx);
    const nomes = l.associacoes.flatMap((a) => a.pessoas.map((x) => x.nome));
    expect(nomes.sort()).toEqual(['José Lima', 'Mariana Souza']);
    expect(l.aguardandoRevisao).toBe(1); // X1, numa rua que o HUB não conhece: espera a Triagem, não é chutado
  });

  it('3. no lote seguinte, quem o HUB já lembra (nome + rua) entra sozinho na associação; gente nova não', () => {
    const { ctx } = dia1();
    importar(ctx, [seidl('S5', 'Mariana Souza', '10', 0), seidl('S6', 'Ana Nova', '30', 1)]);
    const l = listasDasAssociacoes(ctx);
    expect(l.associacoes[0].pessoas).toMatchObject([{ nome: 'Mariana Souza', pacotes: 3 }]);
    expect(l.associacoes.flatMap((a) => a.pessoas.map((x) => x.nome))).not.toContain('Ana Nova');
  });

  it('4. pacote devolvido ao galpão (Novo dia) sai da lista', () => {
    const { ctx } = dia1();
    encerrarDia(ctx, { ator: 'G', chave: 'k', historico: false, destinos: {}, destinoSemResponsavel: 'galpao' });
    const l = listasDasAssociacoes(ctx);
    expect(l.associacoes.every((a) => a.totalPacotes === 0 && a.pessoas.length === 0)).toBe(true);
    expect(l.aguardandoRevisao).toBe(0);
  });

  it('5. mover a pessoa para outra associação troca as duas listas e a memória (no próximo lote ela vai para a nova)', () => {
    const { ctx, p, mover } = dia1();
    for (const cod of ['S1', 'S2']) expect(mover(cod, '10.3', true)).toMatchObject({ ok: true });
    let l = listasDasAssociacoes(ctx);
    expect(l.associacoes.map((a) => a.totalPacotes)).toEqual([0, 1, 2, 0]);
    importar(ctx, [seidl('S7', 'Mariana Souza', '10', 0)]);
    l = listasDasAssociacoes(ctx);
    expect(l.associacoes[2].pessoas).toMatchObject([{ nome: 'Mariana Souza', pacotes: 3 }]);
    expect(p('S7').estado).toBe('NAO_ATRIBUIDO');
  });
});

describe('responsável (A/C) da associação', () => {
  it('6. grava, aparece na lista e no texto; vazio apaga', () => {
    const { ctx, cx } = dia1();
    expect(definirResponsavelDaAssociacao(ctx, cx('10.1').id, '  Dona   Rita ')).toBe('Dona Rita');
    const a = listasDasAssociacoes(ctx).associacoes[0];
    expect(a.responsavel).toBe('Dona Rita');
    const texto = textoDaLista({ associacao: a.nome, responsavel: a.responsavel, pessoas: a.pessoas, agora: new Date('2026-10-01T17:05:00Z') });
    expect(texto).toContain('👩 *A/C:* Dona Rita');
    expect(definirResponsavelDaAssociacao(ctx, cx('10.1').id, '   ')).toBeNull();
    expect(listasDasAssociacoes(ctx).associacoes[0].responsavel).toBeNull();
  });

  it('7. só vale para associação; nome grande demais e id inexistente são recusados', () => {
    const { ctx, cx } = dia1();
    expect(erro(() => definirResponsavelDaAssociacao(ctx, cx('1').id, 'Fulana'))).toMatchObject({ codigo: 'NAO_E_ASSOCIACAO', status: 409 });
    expect(erro(() => definirResponsavelDaAssociacao(ctx, cx('10').id, 'Fulana')).codigo).toBe('NAO_E_ASSOCIACAO'); // o grupo não é uma associação
    expect(erro(() => definirResponsavelDaAssociacao(ctx, cx('10.1').id, 'x'.repeat(61))).codigo).toBe('ENTRADA_INVALIDA');
    expect(erro(() => definirResponsavelDaAssociacao(ctx, 'nao-existe', 'Fulana')).codigo).toBe('REGIAO_INEXISTENTE');
  });
});

describe('texto da lista (mesmo formato do Street)', () => {
  it('8. cabeçalho, totais, data/hora de São Paulo e uma linha por pessoa, singular e plural', () => {
    const texto = textoDaLista({
      associacao: 'Associação da Chatuba',
      responsavel: 'Dona Rita',
      pessoas: [{ nome: 'Ana', pacotes: 1 }, { nome: 'Bia', pacotes: 2 }],
      agora: new Date('2026-10-01T17:05:00Z'),
    });
    expect(texto).toBe(
      [
        '📋 *Lista de Encomendas - Associação*',
        '🏘️ *Local:* Associação da Chatuba',
        '👩 *A/C:* Dona Rita',
        '📦 *Total de Pacotes:* 3 volumes (2 destinatários)',
        '📅 *Data:* 01/10/2026 às 14:05',
        '',
        '📝 *Relação de Nomes:*',
        '1. *Ana* (1 pacote)',
        '2. *Bia* (2 pacotes)',
        '',
        'Favor conferir os volumes na entrega. Muito obrigado! 🙏',
      ].join('\n'),
    );
  });

  it('9. sem responsável não há linha A/C; um volume e um destinatário no singular; meia-noite em São Paulo', () => {
    const t = textoDaLista({ associacao: 'Associação São Sebastião', pessoas: [{ nome: 'José', pacotes: 1 }], agora: new Date('2026-10-01T03:30:00Z') });
    expect(t).not.toContain('A/C');
    expect(t).toContain('📦 *Total de Pacotes:* 1 volume (1 destinatário)');
    expect(dataEHoraSP(new Date('2026-10-01T03:30:00Z'))).toBe('01/10/2026 às 00:30');
  });

  it('10. agrupa por nome sem diferenciar acento, maiúscula ou espaço; sem nome vira "Morador"; ordem alfabética', () => {
    const p = (id: string, nome: string) => ({ id, destinatario: nome, rua: 'Rua A' });
    const r = agruparPessoas([p('1', 'maria  da Silva'), p('2', 'Zélia'), p('3', 'Maria da Silva'), p('4', 'Jose'), p('5', 'José'), p('6', ''), p('7', 'Ana')]);
    expect(r.map((x) => [x.nome, x.pacotes])).toEqual([['Ana', 1], ['Jose', 2], ['Maria da Silva', 2], ['Morador', 1], ['Zélia', 1]]);
  });

  it('10b. nome para a lista: primeira letra de cada palavra em maiúscula, "da/de/e" em minúscula, TUDO MAIÚSCULO vira normal, o resto fica', () => {
    expect(nomeParaLista('claudio')).toBe('Claudio');
    expect(nomeParaLista('joelma lima')).toBe('Joelma Lima');
    expect(nomeParaLista('nilda da Silva Barbosa')).toBe('Nilda da Silva Barbosa');
    expect(nomeParaLista('MARIA DA SILVA E SOUZA')).toBe('Maria da Silva e Souza');
    expect(nomeParaLista('Ana McDonald')).toBe('Ana McDonald');
    expect(nomeParaLista('de Paula')).toBe('De Paula'); // "de" no começo é sobrenome
  });
});

// ---------------------------------------------------------------------------
// HTTP, com login obrigatório

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

async function chamar(base: string, caminho: string, o: { metodo?: string; corpo?: unknown; token?: string } = {}) {
  const r = await fetch(`${base}${caminho}`, {
    method: o.metodo ?? (o.corpo ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) },
    body: o.corpo ? JSON.stringify(o.corpo) : undefined,
  });
  const t = await r.text();
  let json: Record<string, any> = {};
  try {
    json = JSON.parse(t);
  } catch {
    // sem JSON
  }
  return { status: r.status, json };
}

describe('API das associações', () => {
  it('11. sem token 401; ajudante comum 403; ADMIN lê as listas e grava o responsável; o ator vem da conta', async () => {
    const { ctx, cx } = dia1();
    garantirMaster(ctx, { usuario: 'hugodzlog', ajudanteNome: 'Hugo', codigoDeAtivacao: 'cod-teste' });
    definirPrimeiroPin(ctx, { usuario: 'hugodzlog', codigo: 'cod-teste', pin: '654321' });
    const master = ctx.armazem.contas.porUsuario('hugodzlog')!;
    criarConta(ctx, { nome: 'Ana Ajudante', usuario: 'ana', pin: '444444' });
    aprovarConta(ctx, master, { contaId: ctx.armazem.contas.porUsuario('ana')!.id, como: 'AJUDANTE', criarPerfilNovo: true });
    const base = await subir(ctx);

    expect((await chamar(base, '/associacoes')).status).toBe(401);
    expect((await chamar(base, `/associacoes/${cx('10.1').id}/responsavel`, { metodo: 'PUT', corpo: { responsavel: 'X' } })).status).toBe(401);
    const ana = (await chamar(base, '/street/login', { corpo: { usuario: 'ana', pin: '444444' } })).json;
    expect((await chamar(base, '/associacoes', { token: ana.token })).status).toBe(403);

    const hugo = (await chamar(base, '/street/login', { corpo: { usuario: 'hugodzlog', pin: '654321' } })).json;
    const lista = await chamar(base, '/associacoes', { token: hugo.token });
    expect(lista.status).toBe(200);
    expect(lista.json.associacoes.map((a: { numero: string }) => a.numero)).toEqual(['10.1', '10.2', '10.3', '10.4']);
    expect(lista.json.aguardandoRevisao).toBe(1);

    const grava = await chamar(base, `/associacoes/${cx('10.2').id}/responsavel`, { token: hugo.token, metodo: 'PUT', corpo: { responsavel: 'Dona Lúcia' } });
    expect(grava).toMatchObject({ status: 200, json: { responsavel: 'Dona Lúcia' } });
    const naoE = await chamar(base, `/associacoes/${cx('1').id}/responsavel`, { token: hugo.token, metodo: 'PUT', corpo: { responsavel: 'Fulana' } });
    expect(naoE.status).toBe(409);
    expect(naoE.json.codigo).toBe('NAO_E_ASSOCIACAO');
  });
});
