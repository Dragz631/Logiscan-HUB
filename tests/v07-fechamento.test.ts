/**
 * V0.7 — FECHAMENTO DA ROTA e RELATÓRIO DO DIA: quantos entregues, o que não foi entregue e, de cada entrega,
 * quem recebeu, onde, quando e o texto de confirmação do Street. Só leitura do que já aconteceu.
 */
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { iniciarRota } from '../src/application/cargas';
import { fechamentoDaCarga, relatorioDoDia } from '../src/application/fechamento';
import { confirmarImportacao, prepararImportacao } from '../src/application/importacao';
import { encerrarDia } from '../src/application/novoDia';
import { atribuirRuas, criarPerfil } from '../src/application/orquestracao';
import { aplicarConhecimentoInicial } from '../src/application/regioes';
import { receberEventosStreet } from '../src/application/transporteStreet';
import { duracao, fraseDoRecebedor, textoDoRelatorio } from '../src/domain/fechamento';
import { criarApi } from '../src/server/app';
import { contextoDeTeste, documento, pacote } from './ajuda';

const CATALOGO = JSON.parse(readFileSync('src/infrastructure/conhecimento/conhecimento-inicial.json', 'utf8'));

const seidl = (cod: string, nome: string, numero: string, card: number) =>
  pacote({ tracking_code: cod, recipient_name: nome, street: 'Rua Carlos Seidl', number: numero, complement: 'Casa 4', cep: '20931002' }, card);
const gurjao = (cod: string, nome: string, numero: string, card: number) =>
  pacote({ tracking_code: cod, recipient_name: nome, street: 'Rua General Gurjão', number: numero, cep: '20931040' }, card);

/** Hugo leva as caixas 1 (3 pacotes) e 3 (1 pacote); a rota sai às 13:00Z (10:00 em São Paulo). */
function cenario() {
  const ctx = contextoDeTeste();
  aplicarConhecimentoInicial(ctx, CATALOGO);
  const r = prepararImportacao(ctx, {
    arquivo: 'lote.json',
    conteudo: documento([seidl('S1', 'Maria Souza', '10', 0), seidl('S2', 'José Lima', '12', 1), seidl('S3', 'Ana Lúcia', '14', 2), gurjao('G1', 'Paulo Costa', '5', 3)]),
  });
  if (!r.ok) throw new Error('import');
  confirmarImportacao(ctx, r.loteId, 'Galpão');
  const hugo = criarPerfil(ctx, { nome: 'Hugo' });
  const cx = (n: string) => ctx.armazem.regioes.listar().find((x) => x.numero === n)!;
  const carga = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: [`regiao:${cx('1').id}`, `regiao:${cx('3').id}`], ator: 'G', chave: 'h' }).carga;
  iniciarRota(ctx, carga.id, 'G');
  const p = (c: string) => ctx.armazem.pacotes.porChave('jtexpress', c)!;
  let n = 0;
  const evento = (e: Record<string, unknown>) =>
    receberEventosStreet(ctx, {
      schema: 'logiscan.street-eventos/v0',
      gerado_em: '2026-09-23T16:00:00.000Z',
      ajudante: { id: hugo.id, nome: hugo.nome },
      eventos: [{ id_evento: `e-${++n}`, carga_id: carga.id, codigo: '', ...e }],
    });
  const entrega = (cod: string, hora: string, recebedor: { tipo: string; detalhes: string }, texto?: string) =>
    evento({ tipo: 'ENTREGA_REGISTRADA', hub_pacote_id: p(cod).id, ocorrido_em: `2026-09-23T${hora}:00.000Z`, recebedor, ...(texto ? { texto } : {}) });
  const insucesso = (cod: string, hora: string, motivo: string) =>
    evento({ tipo: 'INSUCESSO_REGISTRADO', hub_pacote_id: p(cod).id, ocorrido_em: `2026-09-23T${hora}:00.000Z`, motivo });
  return { ctx, hugo, carga, p, entrega, insucesso, cx };
}

const TEXTO_MARIA = '📦 *Entrega realizada*\n*Cliente:* Maria Souza\n*Recebido por:* o próprio morador\n*Local:* Rua Carlos Seidl, 10';

describe('fechamento de uma rota', () => {
  it('1. conta entregues, insucessos e o que ficou sem registro; tempo na rua; por caixa', () => {
    const { ctx, carga, entrega, insucesso } = cenario();
    entrega('S1', '14:00', { tipo: 'proprio_morador', detalhes: 'Maria' }, TEXTO_MARIA);
    insucesso('S2', '14:20', 'Morador ausente');
    entrega('S3', '15:30', { tipo: 'vizinho', detalhes: 'Dona Rita' });
    const f = fechamentoDaCarga(ctx, carga.id);
    expect(f).toMatchObject({ total: 4, entregues: 2, insucessos: 1, semDesfecho: 1, situacao: 'PARCIAL', provasCompletas: 0 });
    expect(f.ajudante.nome).toBe('Hugo');
    expect(f.saiuEm).toBe('2026-09-23T13:00:00.000Z');
    expect(f.ultimaEntregaEm).toBe('2026-09-23T15:30:00.000Z');
    expect(f.minutosNaRua).toBe(150); // 13:00 → 15:30
    expect(f.caixas.map((c) => [c.numero, c.total, c.entregues])).toEqual([['1', 3, 2], ['3', 1, 0]]);
  });

  it('1b. cada entrega diz de qual caixa saiu (é isso que organiza as provas por caixa na tela)', () => {
    const { ctx, carga, entrega } = cenario();
    entrega('S1', '14:00', { tipo: 'proprio_morador', detalhes: 'Maria' });
    entrega('G1', '14:10', { tipo: 'vizinho', detalhes: 'Dona Rita' });
    entrega('S3', '15:30', { tipo: 'proprio_morador', detalhes: 'Ana' });
    const f = fechamentoDaCarga(ctx, carga.id);
    const doNumero = (n: string) => f.caixas.find((c) => c.numero === n)!.chave;
    const porCaixa = (n: string) => f.entregas.filter((e) => e.caixaChave === doNumero(n)).map((e) => e.destinatario);
    expect(porCaixa('1')).toEqual(['Maria Souza', 'Ana Lúcia']); // na ordem em que foram entregues
    expect(porCaixa('3')).toEqual(['Paulo Costa']);
    expect(f.entregas.every((e) => f.caixas.some((c) => c.chave === e.caixaChave))).toBe(true);
  });

  it('2. cada entrega traz quem recebeu, o texto de confirmação e a hora; a lista vem na ordem das entregas', () => {
    const { ctx, carga, entrega } = cenario();
    entrega('S3', '15:30', { tipo: 'vizinho', detalhes: 'Dona Rita' });
    entrega('S1', '14:00', { tipo: 'proprio_morador', detalhes: 'Maria' }, TEXTO_MARIA);
    const e = fechamentoDaCarga(ctx, carga.id).entregas;
    expect(e.map((x) => x.destinatario)).toEqual(['Maria Souza', 'Ana Lúcia']);
    expect(e[0]).toMatchObject({ quando: '2026-09-23T14:00:00.000Z', texto: TEXTO_MARIA, recebedor: { tipo: 'proprio_morador' }, provaCompleta: false });
    expect(e[1]).toMatchObject({ texto: null, recebedor: { tipo: 'vizinho', detalhes: 'Dona Rita' } });
  });

  it('3. a falha mostra o motivo; quem não teve registro aparece como "sem desfecho"', () => {
    const { ctx, carga, insucesso } = cenario();
    insucesso('S2', '14:20', 'Morador ausente');
    const falhas = fechamentoDaCarga(ctx, carga.id).falhas;
    expect(falhas.find((x) => x.destinatario === 'José Lima')).toMatchObject({ situacao: 'INSUCESSO', motivo: 'Morador ausente', depois: null });
    expect(falhas.find((x) => x.destinatario === 'Paulo Costa')).toMatchObject({ situacao: 'SEM_DESFECHO', motivo: null });
  });

  it('4. PERFEITA quando tudo foi entregue; CONCLUIDA quando tudo tem desfecho mas houve insucesso', () => {
    const { ctx, carga, entrega, insucesso } = cenario();
    const r = { tipo: 'proprio_morador', detalhes: 'x' };
    entrega('S1', '14:00', r);
    entrega('S2', '14:10', r);
    entrega('S3', '14:20', r);
    insucesso('G1', '14:30', 'Endereço não encontrado');
    expect(fechamentoDaCarga(ctx, carga.id)).toMatchObject({ situacao: 'CONCLUIDA', entregues: 3, insucessos: 1 });

    const b = cenario();
    for (const [i, c] of ['S1', 'S2', 'S3', 'G1'].entries()) b.entrega(c, `14:${10 + i}`, r);
    expect(fechamentoDaCarga(b.ctx, b.carga.id)).toMatchObject({ situacao: 'PERFEITA', entregues: 4, insucessos: 0, semDesfecho: 0 });
  });

  it('5. depois do Novo dia o relatório continua certo: quem sobrou aparece com o destino ("ficou para amanhã")', () => {
    const { ctx, hugo, carga, entrega, insucesso } = cenario();
    entrega('S1', '14:00', { tipo: 'proprio_morador', detalhes: 'Maria' }, TEXTO_MARIA);
    insucesso('S2', '14:20', 'Morador ausente');
    const dia = encerrarDia(ctx, { ator: 'G', chave: 'k', historico: true, destinos: { [hugo.id]: 'amanha' }, destinoSemResponsavel: 'amanha' }).dia;
    const f = fechamentoDaCarga(ctx, carga.id);
    expect(f).toMatchObject({ total: 4, entregues: 1, insucessos: 1, semDesfecho: 2 });
    expect(f.falhas.map((x) => [x.destinatario, x.depois]).sort()).toEqual([['Ana Lúcia', 'amanha'], ['José Lima', 'amanha'], ['Paulo Costa', 'amanha']]);

    const rel = relatorioDoDia(ctx, dia.id);
    expect(rel.totais).toEqual({ rotas: 1, perfeitas: 0, total: 4, entregues: 1, naoEntregues: 3 });
    expect(rel.rotas[0].ajudante.nome).toBe('Hugo');
    expect(rel.texto).toContain('*Relatório do dia — 23/09/2026*');
    expect(rel.texto).toContain('✅ *Entregues:* 1 de 4 em 1 rota');
    expect(rel.texto).toContain('- *Hugo*: 1 de 4 · 1 insucesso · 2 sem registro');
    expect(rel.texto).toContain('*O que ficou de fora:*');
    expect(rel.texto).toContain('José Lima');
  });

  it('6. pacote que sobrou, voltou e foi para OUTRA carga no dia seguinte não aparece como pendente na rota antiga', () => {
    const { ctx, hugo, carga, entrega, p } = cenario();
    entrega('S1', '14:00', { tipo: 'proprio_morador', detalhes: 'Maria' });
    encerrarDia(ctx, { ator: 'G', chave: 'k', historico: true, destinos: { [hugo.id]: 'amanha' }, destinoSemResponsavel: 'amanha' });
    ctx.avancar(24 * 60);
    const ana = criarPerfil(ctx, { nome: 'Ana' });
    const cx = ctx.armazem.regioes.listar().find((x) => x.numero === '1')!;
    const nova = atribuirRuas(ctx, { ajudanteId: ana.id, ruas: [`regiao:${cx.id}`], ator: 'G', chave: 'a' }).carga;
    expect(p('S2').cargaId).toBe(nova.id);
    const antiga = fechamentoDaCarga(ctx, carga.id);
    expect(antiga.falhas.find((x) => x.destinatario === 'José Lima')).toMatchObject({ situacao: 'SEM_DESFECHO', depois: 'amanha' }); // o que aconteceu ONTEM
    const hoje = fechamentoDaCarga(ctx, nova.id);
    expect(hoje.total).toBe(2); // S2 e S3, que voltaram para a caixa
  });
});

describe('texto do relatório (puro)', () => {
  it('7. rota perfeita: título, totais, provas pendentes e o texto de confirmação de cada entrega (com a hora de São Paulo)', () => {
    const t = textoDoRelatorio(
      {
        cargaId: 'c', codigo: 'C-1', ajudante: { id: 'a', nome: 'Raul' }, saiuEm: '2026-10-01T14:49:00.000Z', ultimaEntregaEm: '2026-10-01T17:32:00.000Z', minutosNaRua: 163,
        total: 2, entregues: 2, insucessos: 0, semDesfecho: 0, provasCompletas: 0, situacao: 'PERFEITA', caixas: [],
        entregas: [
          { caixaChave: 'c1', pacoteId: '1', codigo: 'X1', destinatario: 'Ana M.', rua: 'Rua Tavares Guerra', numero: '41', complemento: 'Casa 4', quando: '2026-10-01T17:32:00.000Z', recebedor: { tipo: 'proprio_morador', detalhes: 'Ana' }, texto: 'Entrega realizada\nRecebido por: Ana', provaCompleta: false },
          { caixaChave: 'c1', pacoteId: '2', codigo: 'X2', destinatario: 'Carlos P.', rua: 'Rua General Sampaio', numero: '112', complemento: '', quando: '2026-10-01T16:48:00.000Z', recebedor: { tipo: 'portaria', detalhes: 'Seu Jorge' }, texto: null, provaCompleta: false },
        ],
        falhas: [],
      },
      new Date('2026-10-01T18:00:00Z'),
    );
    expect(t).toContain('🏆 *Rota perfeita* — Raul');
    expect(t).toContain('📅 01/10/2026 às 15:00 · carga C-1');
    expect(t).toContain('🛵 Saiu 11:49 · última entrega 14:32 (2 h 43 min na rua)');
    expect(t).toContain('✅ *Entregues:* 2 de 2');
    expect(t).not.toContain('Não entregues');
    expect(t).toContain('📷 *Provas com foto:* 0 de 2 (fotos pendentes)');
    expect(t).toContain('1. *Ana M.* — Rua Tavares Guerra, 41 · Casa 4 · 14:32\n   Entrega realizada\n   Recebido por: Ana');
    expect(t).toContain('2. *Carlos P.* — Rua General Sampaio, 112 · 13:48\n   Recebido pela portaria: Seu Jorge');
  });

  it('8. recebedor e duração em português claro', () => {
    expect(fraseDoRecebedor({ tipo: 'proprio_morador', detalhes: 'Próprio Morador' })).toBe('Recebido pelo próprio morador');
    expect(fraseDoRecebedor({ tipo: 'proprio_morador', detalhes: 'Maria' })).toBe('Recebido pelo próprio morador: Maria');
    expect(fraseDoRecebedor({ tipo: 'vizinho', detalhes: 'Dona Rita' })).toBe('Recebido por um vizinho: Dona Rita');
    expect(fraseDoRecebedor({ tipo: 'portaria', detalhes: 'Seu Jorge' })).toBe('Recebido pela portaria: Seu Jorge');
    expect(fraseDoRecebedor({ tipo: 'outro_tipo', detalhes: '' })).toBe('Recebido por outro tipo');
    expect(fraseDoRecebedor(null)).toBe('Recebedor não informado');
    expect(duracao(163)).toBe('2 h 43 min');
    expect(duracao(7)).toBe('7 min');
    expect(duracao(60)).toBe('1 h 00 min');
  });
});

describe('API do fechamento', () => {
  const abertos: { close: () => void }[] = [];
  afterEach(() => abertos.splice(0).forEach((s) => s.close()));

  it('9. GET /cargas/:id/fechamento e /dias/:id/relatorio respondem; carga inexistente = 404', async () => {
    const { ctx, hugo, carga, entrega } = cenario();
    entrega('S1', '14:00', { tipo: 'proprio_morador', detalhes: 'Maria' }, TEXTO_MARIA);
    const dia = encerrarDia(ctx, { ator: 'G', chave: 'k', historico: false, destinos: { [hugo.id]: 'galpao' }, destinoSemResponsavel: 'galpao' }).dia;
    const app = express();
    app.use('/api', criarApi(ctx));
    const srv = app.listen(0, '127.0.0.1');
    await new Promise((r) => srv.once('listening', r));
    abertos.push(srv);
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api`;
    const f = await (await fetch(`${base}/cargas/${carga.id}/fechamento`)).json();
    expect(f).toMatchObject({ entregues: 1, total: 4, ajudante: { nome: 'Hugo' } });
    const r = await (await fetch(`${base}/dias/${dia.id}/relatorio`)).json();
    expect(r.totais).toMatchObject({ rotas: 1, entregues: 1 });
    expect(r.texto).toContain('(dia de teste)');
    const nao = await fetch(`${base}/cargas/nao-existe/fechamento`);
    expect(nao.status).toBe(404);
  });
});
