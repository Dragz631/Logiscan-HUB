/**
 * V0.7 — o PERFIL do ajudante no HUB é o Street dele visto de fora: só as CAIXAS que ele recebeu, e dentro de cada
 * caixa os NÚMEROS em ordem crescente, com vários pacotes no mesmo número agrupados e o status por pacote.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { iniciarRota } from '../src/application/cargas';
import { confirmarImportacao, prepararImportacao } from '../src/application/importacao';
import { atribuirRuas, criarPerfil, detalharPerfil } from '../src/application/orquestracao';
import { aplicarConhecimentoInicial } from '../src/application/regioes';
import { receberEventosStreet } from '../src/application/transporteStreet';
import { contextoDeTeste, documento, pacote } from './ajuda';

const CATALOGO = JSON.parse(readFileSync('src/infrastructure/conhecimento/conhecimento-inicial.json', 'utf8'));

const seidl = (cod: string, nome: string, numero: string, card: number) =>
  pacote({ tracking_code: cod, recipient_name: nome, street: 'Rua Carlos Seidl', number: numero, cep: '20931002' }, card);
const gurjao = (cod: string, nome: string, numero: string, card: number) =>
  pacote({ tracking_code: cod, recipient_name: nome, street: 'Rua General Gurjão', number: numero, cep: '20931040' }, card);

function cenario() {
  const ctx = contextoDeTeste();
  aplicarConhecimentoInicial(ctx, CATALOGO);
  const r = prepararImportacao(ctx, {
    arquivo: 'lote.json',
    conteudo: documento([
      seidl('S14', 'Paulo', '14', 0), seidl('S10A', 'Maria', '10', 1), seidl('S9', 'Rita', '9', 2), seidl('S10B', 'José', '10', 3), seidl('S100', 'Caio', '100', 4),
      gurjao('G7', 'Bia', '7', 5), gurjao('G5', 'Lia', '5', 6),
    ]),
  });
  if (!r.ok) throw new Error('import');
  confirmarImportacao(ctx, r.loteId, 'Galpão');
  const hugo = criarPerfil(ctx, { nome: 'Hugo' });
  const outro = criarPerfil(ctx, { nome: 'Outro' });
  const caixa = (n: string) => ctx.armazem.regioes.listar().find((x) => x.numero === n)!;
  // Só as caixas 3 e 1 (nessa ordem de pedido); a caixa 2 não é dele
  const carga = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: [`regiao:${caixa('3').id}`, `regiao:${caixa('1').id}`], ator: 'G', chave: 'h' }).carga;
  return { ctx, hugo, outro, carga, p: (c: string) => ctx.armazem.pacotes.porChave('jtexpress', c)! };
}

describe('perfil do ajudante = o Street dele', () => {
  it('1. só as caixas que ele recebeu, na ordem das caixas (1 antes de 3), com a numeração da caixa', () => {
    const { ctx, hugo, outro } = cenario();
    const d = detalharPerfil(ctx, hugo.id);
    expect(d.caixasRecebidas.map((c) => [c.numero, c.nome, c.total, c.pendentes])).toEqual([
      ['1', 'Rua Carlos Seidl', 5, 5],
      ['3', 'Rua General Gurjão', 2, 2],
    ]);
    expect(detalharPerfil(ctx, outro.id).caixasRecebidas).toEqual([]);
  });

  it('2. dentro da caixa os números vêm em sequência CRESCENTE (9, 10, 14, 100 — não em ordem de texto)', () => {
    const { ctx, hugo } = cenario();
    const seidlCx = detalharPerfil(ctx, hugo.id).caixasRecebidas[0];
    expect(seidlCx.numeros.map((n) => n.numero)).toEqual(['9', '10', '14', '100']);
    expect(detalharPerfil(ctx, hugo.id).caixasRecebidas[1].numeros.map((n) => n.numero)).toEqual(['5', '7']);
  });

  it('3. vários pacotes no mesmo número ficam juntos: "2 pacotes neste número" e 2 pendentes', () => {
    const { ctx, hugo } = cenario();
    const n10 = detalharPerfil(ctx, hugo.id).caixasRecebidas[0].numeros.find((n) => n.numero === '10')!;
    expect(n10).toMatchObject({ total: 2, pendentes: 2, entregues: 0, insucessos: 0 });
    expect(n10.destinos.flatMap((dd) => dd.pacotes.map((x) => x.destinatario)).sort()).toEqual(['José', 'Maria']);
  });

  it('4. o status por pacote acompanha o Street: entregue e insucesso contam à parte, e a caixa soma', () => {
    const { ctx, hugo, carga, p } = cenario();
    iniciarRota(ctx, carga.id, 'G');
    receberEventosStreet(ctx, {
      schema: 'logiscan.street-eventos/v0',
      gerado_em: '2026-09-23T15:00:00.000Z',
      ajudante: { id: hugo.id, nome: hugo.nome },
      eventos: [
        { id_evento: 'e1', carga_id: carga.id, ocorrido_em: '2026-09-23T14:00:00.000Z', codigo: 'S10A', tipo: 'ENTREGA_REGISTRADA', hub_pacote_id: p('S10A').id, recebedor: { tipo: 'proprio_morador', detalhes: 'Maria' } },
        { id_evento: 'e2', carga_id: carga.id, ocorrido_em: '2026-09-23T14:05:00.000Z', codigo: 'S9', tipo: 'INSUCESSO_REGISTRADO', hub_pacote_id: p('S9').id, motivo: 'Morador ausente' },
      ],
    });
    const cx = detalharPerfil(ctx, hugo.id).caixasRecebidas[0];
    expect(cx).toMatchObject({ total: 5, entregues: 1, insucessos: 1, pendentes: 3 });
    const n10 = cx.numeros.find((n) => n.numero === '10')!;
    expect(n10).toMatchObject({ total: 2, entregues: 1, pendentes: 1 });
    expect(cx.numeros.find((n) => n.numero === '9')).toMatchObject({ insucessos: 1, pendentes: 0 });
    expect(n10.destinos.flatMap((dd) => dd.pacotes).map((x) => [x.destinatario, x.estado]).sort()).toEqual([['José', 'EM_ROTA'], ['Maria', 'ENTREGUE']]);
  });
});
