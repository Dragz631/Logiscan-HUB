/**
 * Ponte HUB → CARGA → STREET → HUB (com dados locais).
 * O "Street" aqui é simulado pelo documento `logiscan.street-eventos/v0` que ele produz.
 */
import { describe, expect, it } from 'vitest';
import {
  criarCarga,
  detalharCarga,
  exportarCarga,
  listarCargas,
  pacotesParaCarga,
  receberRetornoStreet,
} from '../src/application/cargas';
import { detalharPacote } from '../src/application/consultas';
import { confirmarImportacao, prepararImportacao } from '../src/application/importacao';
import { cadastrarAjudante, entregarAoAjudante } from '../src/application/operacao';
import type { Contexto } from '../src/application/portas';
import { DocumentoCargaV0 } from '../src/contracts/cargaV0';
import { reconstruir } from '../src/domain/eventos';
import { contextoDeTeste, documento, pacote } from './ajuda';

function cenario() {
  const ctx = contextoDeTeste();
  const r = prepararImportacao(ctx, {
    arquivo: 'lote.json',
    conteudo: documento([
      pacote({ tracking_code: 'A' }, 0),
      pacote({ tracking_code: 'B', number: '200' }, 1),
      pacote({ tracking_code: 'C', number: '300' }, 2),
    ]),
  });
  if (!r.ok) throw new Error('import');
  confirmarImportacao(ctx, r.loteId, 'Galpão');
  const hugo = cadastrarAjudante(ctx, 'Hugo');
  const ana = cadastrarAjudante(ctx, 'Ana');
  const [a, b, c] = ctx.armazem.pacotes.listar().sort((x, y) => x.codigo.localeCompare(y.codigo));
  entregarAoAjudante(ctx, { pacoteIds: [a.id, b.id], ajudanteId: hugo.id, ator: 'Galpão', chave: 'h' });
  entregarAoAjudante(ctx, { pacoteIds: [c.id], ajudanteId: ana.id, ator: 'Galpão', chave: 'a' });
  return { ctx, hugo, ana, a, b, c };
}

/** Monta o arquivo de retorno exatamente como o Street monta. */
function retornoStreet(
  ajudante: { id: string; nome: string },
  eventos: Partial<{ id_evento: string; tipo: string; carga_id: string; hub_pacote_id: string; codigo: string; ocorrido_em: string }>[],
) {
  return JSON.stringify({
    schema: 'logiscan.street-eventos/v0',
    gerado_em: '2026-09-24T17:40:00.000Z',
    ajudante,
    eventos: eventos.map((e, i) => ({
      id_evento: `ev-${i}`,
      tipo: 'ENTREGA_REGISTRADA',
      codigo: '',
      ocorrido_em: '2026-09-24T17:37:00.000Z',
      recebedor: { tipo: 'proprio_morador', detalhes: 'João' },
      ...e,
    })),
  });
}

function eventosDo(ctx: Contexto, pacoteId: string) {
  return detalharPacote(ctx, pacoteId).timeline.map((e) => e.tipo);
}

describe('carga (HUB)', () => {
  it('é identificável, tem ajudante, timestamps, histórico e só os pacotes dele', () => {
    const { ctx, hugo, a, b } = cenario();
    expect(pacotesParaCarga(ctx, hugo.id).map((p) => p.codigo)).toEqual(['A', 'B']);
    const carga = criarCarga(ctx, { ajudanteId: hugo.id, pacoteIds: [a.id, b.id], ator: 'Galpão' });
    expect(carga.codigo).toBe('C-20260923-HUGO-1');
    const d = detalharCarga(ctx, carga.id);
    expect(d).toMatchObject({ ajudante: { nome: 'Hugo' }, criadaPor: 'Galpão', total: 2, situacao: 'EM_ROTA' });
    expect(d.criadaEm).toBe('2026-09-23T13:00:00.000Z');
    expect(d.historico.map((e) => e.tipo)).toEqual(['CARGA_CRIADA']);
    expect(d.pacotes.every((p) => p.estado === 'EM_ROTA' && p.cargaId === carga.id)).toBe(true);
    expect(eventosDo(ctx, a.id)).toEqual(['IMPORTADO', 'ATRIBUIDO', 'SAIU_PARA_ROTA']);
    expect(pacotesParaCarga(ctx, hugo.id)).toEqual([]);
  });

  it('segunda carga do mesmo ajudante no dia ganha sequência nova', () => {
    const { ctx, hugo, a, b } = cenario();
    criarCarga(ctx, { ajudanteId: hugo.id, pacoteIds: [a.id], ator: 'Galpão' });
    const c2 = criarCarga(ctx, { ajudanteId: hugo.id, pacoteIds: [b.id], ator: 'Galpão' });
    expect(c2.codigo).toBe('C-20260923-HUGO-2');
    expect(listarCargas(ctx).map((c) => c.codigo).sort()).toEqual(['C-20260923-HUGO-1', 'C-20260923-HUGO-2']);
  });

  it('recusa pacote de outro ajudante — e não grava nada (tudo ou nada)', () => {
    const { ctx, hugo, a, c } = cenario();
    expect(() => criarCarga(ctx, { ajudanteId: hugo.id, pacoteIds: [a.id, c.id], ator: 'Galpão' })).toThrow(/não está com Hugo/);
    expect(listarCargas(ctx)).toEqual([]);
    expect(ctx.armazem.pacotes.porId(a.id)?.estado).toBe('ATRIBUIDO');
  });

  it('pacote na rua não pode entrar em outra carga nem ser reatribuído', () => {
    const { ctx, hugo, ana, a } = cenario();
    criarCarga(ctx, { ajudanteId: hugo.id, pacoteIds: [a.id], ator: 'Galpão' });
    expect(() => criarCarga(ctx, { ajudanteId: hugo.id, pacoteIds: [a.id], ator: 'Galpão' })).toThrow(/EM_ROTA/);
    expect(() => entregarAoAjudante(ctx, { pacoteIds: [a.id], ajudanteId: ana.id, ator: 'Galpão', chave: 'x' })).toThrow(/EM_ROTA/);
  });

  it('exporta documento logiscan.carga/v0 válido, só com os pacotes da carga', () => {
    const { ctx, hugo, a, b } = cenario();
    const carga = criarCarga(ctx, { ajudanteId: hugo.id, pacoteIds: [a.id, b.id], ator: 'Galpão' });
    const { arquivo, documento: doc } = exportarCarga(ctx, carga.id, 'Galpão');
    expect(arquivo).toBe('carga-C-20260923-HUGO-1.json');
    expect(DocumentoCargaV0.safeParse(doc).success).toBe(true);
    expect(doc.ajudante).toEqual({ id: hugo.id, nome: 'Hugo' });
    expect(doc.pacotes.map((p) => p.codigo)).toEqual(['A', 'B']);
    expect(doc.pacotes[0]).toMatchObject({ hub_pacote_id: a.id, rua: 'Rua X', numero: '100', destino_id: 'rua x|100|' });
    expect(detalharCarga(ctx, carga.id).historico.map((e) => e.tipo)).toEqual(['CARGA_CRIADA', 'CARGA_EXPORTADA']);
  });
});

describe('retorno do Street → timeline do HUB', () => {
  function comCarga() {
    const s = cenario();
    const carga = criarCarga(s.ctx, { ajudanteId: s.hugo.id, pacoteIds: [s.a.id, s.b.id], ator: 'Galpão' });
    return { ...s, carga };
  }

  it('entrega de teste vira ENTREGUE e aparece na timeline com quem/quando', () => {
    const { ctx, hugo, a, carga } = comCarga();
    const r = receberRetornoStreet(ctx, {
      arquivo: 'retorno.json',
      conteudo: retornoStreet(hugo, [{ carga_id: carga.id, hub_pacote_id: a.id, codigo: 'A' }]),
    });
    expect(r).toEqual({ ok: true, aceitos: 1, repetidos: 0, recusados: [] });
    const d = detalharPacote(ctx, a.id);
    expect(d.pacote.estado).toBe('ENTREGUE');
    const ultimo = d.timeline.at(-1)!;
    expect(ultimo).toMatchObject({ tipo: 'ENTREGA_REGISTRADA', ator: 'Hugo', origem: 'street', ocorridoEm: '2026-09-24T17:37:00.000Z' });
    expect(ultimo.descricao).toBe('Entrega registrada no Street por Hugo — recebido por João (proprio morador)');
    expect(reconstruir(ctx.armazem.eventos.doPacote(a.id))).toEqual(ctx.armazem.pacotes.porId(a.id));
    expect(detalharCarga(ctx, carga.id).historico.at(-1)?.tipo).toBe('RETORNO_RECEBIDO');
  });

  it('reenviar o mesmo retorno não duplica a entrega (idempotente)', () => {
    const { ctx, hugo, a, carga } = comCarga();
    const conteudo = retornoStreet(hugo, [{ carga_id: carga.id, hub_pacote_id: a.id }]);
    receberRetornoStreet(ctx, { arquivo: 'retorno.json', conteudo });
    const r2 = receberRetornoStreet(ctx, { arquivo: 'retorno.json', conteudo });
    expect(r2).toEqual({ ok: true, aceitos: 0, repetidos: 1, recusados: [] });
    expect(eventosDo(ctx, a.id).filter((t) => t === 'ENTREGA_REGISTRADA')).toHaveLength(1);
  });

  it('carga fica CONCLUIDA quando todos os pacotes têm desfecho', () => {
    const { ctx, hugo, a, b, carga } = comCarga();
    receberRetornoStreet(ctx, {
      arquivo: 'r.json',
      conteudo: retornoStreet(hugo, [
        { carga_id: carga.id, hub_pacote_id: a.id },
        { carga_id: carga.id, hub_pacote_id: b.id },
      ]),
    });
    expect(detalharCarga(ctx, carga.id)).toMatchObject({ situacao: 'CONCLUIDA', porEstado: { ENTREGUE: 2 } });
  });

  it('recusa com motivo (e registra no histórico da carga) o que não pode ser aplicado', () => {
    const { ctx, hugo, ana, a, c, carga } = comCarga();
    const r = receberRetornoStreet(ctx, {
      arquivo: 'r.json',
      conteudo: retornoStreet(hugo, [
        { carga_id: carga.id, hub_pacote_id: c.id, codigo: 'C' }, // pacote da Ana, fora da carga
        { carga_id: carga.id, hub_pacote_id: a.id, tipo: 'INSUCESSO_REGISTRADO' }, // tipo ainda não aceito
        { carga_id: 'nao-existe', hub_pacote_id: a.id }, // carga desconhecida
        { carga_id: carga.id, hub_pacote_id: a.id, ocorrido_em: 'ontem' }, // data inválida
      ]),
    });
    if (!r.ok) throw new Error('esperava ok');
    expect(r.aceitos).toBe(0);
    expect(r.recusados.map((x) => x.motivo)).toEqual([
      'pacote não faz parte da carga C-20260923-HUGO-1',
      'tipo de evento "INSUCESSO_REGISTRADO" ainda não é aceito pelo HUB',
      'carga nao-existe não existe no HUB',
      'data/hora inválida: "ontem"',
    ]);
    const hist = detalharCarga(ctx, carga.id).historico.at(-1)!;
    expect(hist.tipo === 'RETORNO_RECEBIDO' && hist.dados.recusados).toHaveLength(3);
    expect(ctx.armazem.pacotes.porId(a.id)?.estado).toBe('EM_ROTA');

    const outro = receberRetornoStreet(ctx, {
      arquivo: 'r2.json',
      conteudo: retornoStreet(ana, [{ carga_id: carga.id, hub_pacote_id: a.id }]),
    });
    expect(outro.ok && outro.recusados[0].motivo).toMatch(/é de Hugo/);
  });

  it('segunda entrega do mesmo pacote (outro id) é recusada, não reescreve a primeira', () => {
    const { ctx, hugo, a, carga } = comCarga();
    receberRetornoStreet(ctx, { arquivo: 'r.json', conteudo: retornoStreet(hugo, [{ carga_id: carga.id, hub_pacote_id: a.id, id_evento: 'x1' }]) });
    const r = receberRetornoStreet(ctx, {
      arquivo: 'r.json',
      conteudo: retornoStreet(hugo, [{ carga_id: carga.id, hub_pacote_id: a.id, id_evento: 'x2' }]),
    });
    expect(r.ok && r.recusados[0].motivo).toMatch(/ENTREGUE não pode ser dado como entregue/);
  });

  it('arquivo que não segue o contrato é recusado inteiro', () => {
    const { ctx } = comCarga();
    expect(receberRetornoStreet(ctx, { arquivo: 'x', conteudo: '{"schema":"logiscan.carga/v0"}' })).toMatchObject({ ok: false });
    expect(receberRetornoStreet(ctx, { arquivo: 'x', conteudo: 'nada' })).toMatchObject({ ok: false });
  });
});
