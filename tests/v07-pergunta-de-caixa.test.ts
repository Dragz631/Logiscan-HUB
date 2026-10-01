/**
 * V0.7 — PERGUNTA DE CAIXA: a rua do pacote é de uma caixa, mas o COMPLEMENTO cita o nome de OUTRA caixa
 * (caso real: Rua Carlos Seidl nº 6, "Deposito do Letinho manilha"). O HUB não decide "pela rua": pergunta
 * ("É Carlos Seidl ou Manilha?"), e a resposta vira memória da pessoa. Complemento comum não gera pergunta.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { confirmarImportacao, prepararImportacao } from '../src/application/importacao';
import { atribuirRuas, criarPerfil } from '../src/application/orquestracao';
import type { Contexto } from '../src/application/portas';
import { aplicarConhecimentoInicial, resolvedorDeCaixa } from '../src/application/regioes';
import { classificarPacote, pacotesDaCaixa, visaoTriagem } from '../src/application/triagem';
import { caixasCitadas, termoDoNome } from '../src/domain/caixas';
import { contextoDeTeste, documento, pacote } from './ajuda';

const CATALOGO = JSON.parse(readFileSync('src/infrastructure/conhecimento/conhecimento-inicial.json', 'utf8'));

let lote = 0;
function importar(ctx: Contexto, pacotes: Record<string, unknown>[]) {
  const r = prepararImportacao(ctx, { arquivo: `lote-${++lote}.json`, conteudo: documento(pacotes, { generated_at: `g${lote}` }) });
  if (!r.ok) throw new Error('import');
  confirmarImportacao(ctx, r.loteId, 'Galpão');
}

const seidl = (cod: string, nome: string, numero: string, complemento: string, card: number) =>
  pacote({ tracking_code: cod, recipient_name: nome, street: 'Rua Carlos Seidl', number: numero, complement: complemento, cep: '20931002' }, card);
const gurjao = (cod: string, nome: string, numero: string, complemento: string, card: number) =>
  pacote({ tracking_code: cod, recipient_name: nome, street: 'Rua General Gurjão', number: numero, complement: complemento, cep: '20931040' }, card);
const manilha = (cod: string, nome: string, complemento: string, card: number) =>
  pacote({ tracking_code: cod, recipient_name: nome, street: 'Rua B', number: '4', complement: complemento, cep: '20931010' }, card);

function cenario() {
  const ctx = contextoDeTeste();
  aplicarConhecimentoInicial(ctx, CATALOGO);
  importar(ctx, [
    seidl('S1', 'Letinho', '6', 'Deposito do Letinho manilha', 0),
    seidl('S2', 'Ana', '7', 'Casa 2', 1),
    seidl('S3', 'Bia', '8', 'perto da Carlos Seidl', 2),
    seidl('S4', 'Caio', '9', 'Associação da Chatuba', 3),
    seidl('S5', 'Davi', '10', 'Avenida Brasil', 4),
    seidl('S6', 'Edu', '11', 'Rua Leão XIII', 5),
    manilha('M1', 'Fabi', 'manilha casa 3', 6),
    gurjao('G1', 'Gil', '7', 'perto de Manilha', 7),
  ]);
  const cx = (n: string) => ctx.armazem.regioes.listar().find((r) => r.numero === n)!;
  const p = (c: string) => ctx.armazem.pacotes.porChave('jtexpress', c)!;
  const caixaDe = (c: string) => resolvedorDeCaixa(ctx)(p(c));
  return { ctx, cx, p, caixaDe };
}

describe('termos e citações (puro)', () => {
  it('1. termo do nome: tira rua/associação e ligações; termo curto demais não vale', () => {
    expect(termoDoNome('Rua Carlos Seidl')).toBe('carlos seidl');
    expect(termoDoNome('Associação da Chatuba')).toBe('chatuba');
    expect(termoDoNome('Manilha')).toBe('manilha');
    expect(termoDoNome('Rua Leão XIII')).toBe('leao xiii');
    expect(termoDoNome('Rua do Canal')).toBe(''); // "canal" é curto e comum
    expect(termoDoNome('Rua A')).toBe('');
  });

  it('2. cita por palavra inteira, sem diferenciar acento/maiúscula; "manilhao" não é Manilha; a própria caixa não conta', () => {
    const c = [{ id: 'm', termos: ['manilha'] }, { id: 's', termos: ['carlos seidl'] }];
    expect(caixasCitadas('Deposito do Letinho MANILHA', c, 's')).toEqual(['m']);
    expect(caixasCitadas('perto da manilhão', c, 's')).toEqual([]);
    expect(caixasCitadas('Carlos Seidl 6, Manilha', c, 's')).toEqual(['m']); // a caixa atual (s) fica de fora
    expect(caixasCitadas('', c, 's')).toEqual([]);
    expect(caixasCitadas('Casa 2', c, 's')).toEqual([]);
  });
});

describe('o HUB pergunta em vez de decidir pela rua', () => {
  it('3. complemento que cita OUTRA caixa vira pergunta (caso real: Carlos Seidl + "manilha"); não entra na caixa 1', () => {
    const { ctx, cx, caixaDe } = cenario();
    const c = caixaDe('S1');
    expect(c).toMatchObject({ caixa: null, origem: 'pergunta' });
    expect(c.pergunta!.candidatas.map((x) => x.numero)).toEqual(['1', '8']); // a da rua primeiro
    const v = visaoTriagem(ctx);
    const q = v.perguntas.find((x) => x.pacote.codigo === 'S1')!;
    expect(q.opcoes.map((o) => o.numero)).toEqual(['1', '8']);
    expect(q.pacote).toMatchObject({ complemento: 'Deposito do Letinho manilha', origem: 'pergunta', podeMover: true });
    expect(pacotesDaCaixa(ctx, cx('1').id).map((x) => x.codigo)).not.toContain('S1');
  });

  it('4. cita associação ou rua de outra caixa (Leão XIII → Manilha) também pergunta; sempre com a caixa da rua como 1ª opção', () => {
    const { ctx } = cenario();
    const v = visaoTriagem(ctx);
    const por = (cod: string) => v.perguntas.find((x) => x.pacote.codigo === cod)!.opcoes.map((o) => o.numero);
    expect(por('S4')).toEqual(['1', '10.1']);
    expect(por('S6')).toEqual(['1', '8']);
    expect(por('G1')).toEqual(['3', '8']);
  });

  it('5. complemento comum, que cita a própria caixa ou "Avenida Brasil" (Diversos) NÃO pergunta: fica na caixa da rua', () => {
    const { cx, caixaDe } = cenario();
    for (const cod of ['S2', 'S3', 'S5']) expect(caixaDe(cod)).toMatchObject({ origem: 'rua', caixa: { id: cx('1').id } });
    expect(caixaDe('M1')).toMatchObject({ origem: 'rua', caixa: { id: cx('8').id } }); // "manilha" dentro da própria Manilha
  });

  it('6. as perguntas contam como "esperando você" e o pacote com pergunta NÃO vai para ajudante enquanto não for respondido', () => {
    const { ctx, cx, p } = cenario();
    expect(visaoTriagem(ctx).aguardandoRevisao).toBe(4); // S1, S4, S6, G1
    const hugo = criarPerfil(ctx, { nome: 'Hugo' });
    atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: [`regiao:${cx('1').id}`], ator: 'G', chave: 'k' });
    expect(p('S1')).toMatchObject({ estado: 'NAO_ATRIBUIDO', cargaId: null });
    expect(p('S2').cargaId).not.toBeNull(); // quem não tem dúvida vai
  });
});

describe('a resposta vira memória da pessoa', () => {
  it('7. responder "Manilha": o pacote vai para a Manilha; no próximo lote a mesma pessoa vai direto, sem nova pergunta', () => {
    const { ctx, cx, p, caixaDe } = cenario();
    expect(classificarPacote(ctx, { pacoteId: p('S1').id, caixaId: cx('8').id, ator: 'Hugo' })).toMatchObject({ ok: true });
    expect(caixaDe('S1')).toMatchObject({ origem: 'manual', caixa: { id: cx('8').id } });
    expect(visaoTriagem(ctx).perguntas.map((x) => x.pacote.codigo)).not.toContain('S1');
    importar(ctx, [seidl('S7', 'Letinho', '6', 'Deposito do Letinho manilha', 0), seidl('S8', 'Outro Cliente', '6', 'Deposito do Letinho manilha', 1)]);
    expect(caixaDe('S7')).toMatchObject({ origem: 'pessoa', caixa: { id: cx('8').id } }); // lembrou da pessoa
    expect(caixaDe('S8')).toMatchObject({ caixa: null, origem: 'pergunta' }); // outra pessoa: pergunta de novo
  });

  it('8. responder "Carlos Seidl" também é lembrado: a mesma pessoa não é perguntada de novo', () => {
    const { ctx, cx, p, caixaDe } = cenario();
    classificarPacote(ctx, { pacoteId: p('S1').id, caixaId: cx('1').id, ator: 'Hugo' });
    importar(ctx, [seidl('S9', 'Letinho', '6', 'Deposito do Letinho manilha', 0)]);
    expect(caixaDe('S9')).toMatchObject({ origem: 'pessoa', caixa: { id: cx('1').id } });
  });

  it('9. a pergunta só vale para quem foi decidido "pela rua": à mão e pela pessoa mandam antes', () => {
    const { ctx, cx, p, caixaDe } = cenario();
    classificarPacote(ctx, { pacoteId: p('S2').id, caixaId: cx('10.2').id, ator: 'Hugo' }); // Ana (comp. "Casa 2") → associação
    importar(ctx, [seidl('S10', 'Ana', '7', 'Associação da Chatuba', 0)]); // citaria outra caixa, mas a pessoa já tem memória
    expect(caixaDe('S10')).toMatchObject({ origem: 'pessoa', caixa: { id: cx('10.2').id } });
  });
});
