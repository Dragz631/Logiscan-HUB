/**
 * Ponte HUB → CARGA → STREET → HUB (com dados locais).
 * O "Street" aqui é simulado pelo documento `logiscan.street-eventos/v0` que ele produz.
 */
import { describe, expect, it } from 'vitest';
import {
  criarCarga,
  detalharCarga,
  exportarCarga,
  iniciarRota,
  listarCargas,
  pacotesParaCarga,
  receberRetornoStreet,
  registrarCorrecao,
} from '../src/application/cargas';
import { detalharPacote } from '../src/application/consultas';
import { confirmarImportacao, prepararImportacao } from '../src/application/importacao';
import { cadastrarAjudante, entregarAoAjudante } from '../src/application/operacao';
import type { Contexto } from '../src/application/portas';
import { DocumentoCargaV0 } from '../src/contracts/cargaV0';
import { podeFicarProntoParaBaixa } from '../src/domain/confirmacao';
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

type EvStreet = Partial<{
  id_evento: string; tipo: string; carga_id: string; hub_pacote_id: string; codigo: string; ocorrido_em: string; motivo: string;
}>;

/** Monta o arquivo de retorno exatamente como o Street monta. */
function retornoStreet(ajudante: { id: string; nome: string }, eventos: EvStreet[]) {
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

describe('carga montada ≠ em rota', () => {
  it('1. criar carga NÃO coloca pacote em EM_ROTA: carga MONTADA, pacotes ATRIBUIDOS', () => {
    const { ctx, hugo, a, b } = cenario();
    expect(pacotesParaCarga(ctx, hugo.id).map((p) => p.codigo)).toEqual(['A', 'B']);
    const carga = criarCarga(ctx, { ajudanteId: hugo.id, pacoteIds: [a.id, b.id], ator: 'Galpão' });
    expect(carga.codigo).toBe('C-20260923-HUGO-1');
    const d = detalharCarga(ctx, carga.id);
    expect(d).toMatchObject({ ajudante: { nome: 'Hugo' }, criadaPor: 'Galpão', total: 2, situacao: 'MONTADA', rotaIniciadaEm: null });
    expect(d.pacotes.every((p) => p.estado === 'ATRIBUIDO' && p.cargaId === carga.id)).toBe(true);
    expect(d.historico.map((e) => e.tipo)).toEqual(['CARGA_CRIADA']);
    expect(d.historico[0].descricao).toBe('Carga montada para Hugo com 2 pacote(s)');
    expect(eventosDo(ctx, a.id)).toEqual(['IMPORTADO', 'ATRIBUIDO', 'INCLUIDO_EM_CARGA']);
    // já está numa carga montada: não entra em outra
    expect(pacotesParaCarga(ctx, hugo.id)).toEqual([]);
    expect(() => criarCarga(ctx, { ajudanteId: hugo.id, pacoteIds: [a.id], ator: 'Galpão' })).toThrow(/já está em outra carga/);
  });

  it('2. iniciar rota coloca carga e pacotes em EM_ROTA', () => {
    const { ctx, hugo, a, b } = cenario();
    const carga = criarCarga(ctx, { ajudanteId: hugo.id, pacoteIds: [a.id, b.id], ator: 'Galpão' });
    const r = iniciarRota(ctx, carga.id, 'Galpão');
    expect(r.jaIniciada).toBe(false);
    const d = detalharCarga(ctx, carga.id);
    expect(d.situacao).toBe('EM_ROTA');
    expect(d.pacotes.every((p) => p.estado === 'EM_ROTA')).toBe(true);
    expect(d.historico.map((e) => e.tipo)).toEqual(['CARGA_CRIADA', 'ROTA_INICIADA']);
    expect(eventosDo(ctx, a.id)).toEqual(['IMPORTADO', 'ATRIBUIDO', 'INCLUIDO_EM_CARGA', 'SAIU_PARA_ROTA']);
    // retry do clique: nada novo
    expect(iniciarRota(ctx, carga.id, 'Galpão').jaIniciada).toBe(true);
    expect(eventosDo(ctx, a.id)).toHaveLength(4);
  });

  it('3. os dois horários (montada 07:10 / rota 08:05) ficam separados', () => {
    const { ctx, hugo, a } = cenario();
    const carga = criarCarga(ctx, { ajudanteId: hugo.id, pacoteIds: [a.id], ator: 'Galpão' });
    ctx.avancar(55);
    iniciarRota(ctx, carga.id, 'Operador');
    const d = detalharCarga(ctx, carga.id);
    expect(d.criadaEm).toBe('2026-09-23T13:00:00.000Z');
    expect(d.rotaIniciadaEm).toBe('2026-09-23T13:55:00.000Z');
    expect(d.rotaIniciadaPor).toBe('Operador');
    expect(d.historico.map((e) => e.ocorridoEm)).toEqual(['2026-09-23T13:00:00.000Z', '2026-09-23T13:55:00.000Z']);
    const t = detalharPacote(ctx, a.id).timeline;
    expect(t.find((e) => e.tipo === 'INCLUIDO_EM_CARGA')?.ocorridoEm).toBe('2026-09-23T13:00:00.000Z');
    expect(t.find((e) => e.tipo === 'SAIU_PARA_ROTA')?.ocorridoEm).toBe('2026-09-23T13:55:00.000Z');
  });

  it('entrega do Street com a rota ainda não iniciada é recusada', () => {
    const { ctx, hugo, a } = cenario();
    const carga = criarCarga(ctx, { ajudanteId: hugo.id, pacoteIds: [a.id], ator: 'Galpão' });
    const r = receberRetornoStreet(ctx, { arquivo: 'r', conteudo: retornoStreet(hugo, [{ carga_id: carga.id, hub_pacote_id: a.id }]) });
    expect(r.ok && r.recusados[0].motivo).toMatch(/rota da carga .* ainda não foi iniciada/);
    expect(ctx.armazem.pacotes.porId(a.id)?.estado).toBe('ATRIBUIDO');
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
    expect(ctx.armazem.pacotes.porId(a.id)).toMatchObject({ estado: 'ATRIBUIDO', cargaId: null });
  });

  it('pacote em carga (montada ou na rua) não pode ser reatribuído', () => {
    const { ctx, hugo, ana, a } = cenario();
    const carga = criarCarga(ctx, { ajudanteId: hugo.id, pacoteIds: [a.id], ator: 'Galpão' });
    expect(() => entregarAoAjudante(ctx, { pacoteIds: [a.id], ajudanteId: ana.id, ator: 'Galpão', chave: 'x' })).toThrow(/carga montada/);
    iniciarRota(ctx, carga.id, 'Galpão');
    expect(() => entregarAoAjudante(ctx, { pacoteIds: [a.id], ajudanteId: ana.id, ator: 'Galpão', chave: 'y' })).toThrow(/EM_ROTA/);
  });

  it('exporta documento logiscan.carga/v0 válido, só com os pacotes da carga (também montada)', () => {
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
  function naRua() {
    const s = cenario();
    const carga = criarCarga(s.ctx, { ajudanteId: s.hugo.id, pacoteIds: [s.a.id, s.b.id], ator: 'Galpão' });
    iniciarRota(s.ctx, carga.id, 'Galpão');
    return { ...s, carga };
  }

  it('entrega de teste vira ENTREGUE e aparece na timeline com quem/quando', () => {
    const { ctx, hugo, a, carga } = naRua();
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

  it('6. entrega registrada NÃO significa PRONTO_PARA_BAIXA: ENTREGUE + confirmação INCOMPLETA', () => {
    const { ctx, hugo, a, carga } = naRua();
    receberRetornoStreet(ctx, { arquivo: 'r', conteudo: retornoStreet(hugo, [{ carga_id: carga.id, hub_pacote_id: a.id }]) });
    const p = ctx.armazem.pacotes.porId(a.id)!;
    expect(p.estado).toBe('ENTREGUE');
    expect(p.confirmacaoEntrega).toEqual({ status: 'INCOMPLETA', faltando: ['foto_pacote', 'foto_local'] });
    expect(podeFicarProntoParaBaixa(p)).toBe(false);
  });

  it('4. insucesso gera evento com motivo, horário, ajudante, pacote e carga', () => {
    const { ctx, hugo, a, carga } = naRua();
    const r = receberRetornoStreet(ctx, {
      arquivo: 'r',
      conteudo: retornoStreet(hugo, [
        { carga_id: carga.id, hub_pacote_id: a.id, tipo: 'INSUCESSO_REGISTRADO', motivo: 'Morador ausente', ocorrido_em: '2026-09-24T15:02:00.000Z' },
      ]),
    });
    expect(r).toMatchObject({ ok: true, aceitos: 1 });
    const d = detalharPacote(ctx, a.id);
    expect(d.pacote).toMatchObject({ estado: 'INSUCESSO', motivoInsucesso: 'Morador ausente', confirmacaoEntrega: null });
    const ev = d.timeline.at(-1)!;
    expect(ev).toMatchObject({
      tipo: 'INSUCESSO_REGISTRADO',
      pacoteId: a.id,
      ator: 'Hugo',
      origem: 'street',
      ocorridoEm: '2026-09-24T15:02:00.000Z',
      dados: { motivo: 'Morador ausente', carga: { id: carga.id }, ajudante: { id: hugo.id } },
    });
    expect(ev.descricao).toBe('Insucesso registrado no Street por Hugo — motivo: Morador ausente');
  });

  it('insucesso sem motivo é recusado', () => {
    const { ctx, hugo, a, carga } = naRua();
    const r = receberRetornoStreet(ctx, {
      arquivo: 'r',
      conteudo: retornoStreet(hugo, [{ carga_id: carga.id, hub_pacote_id: a.id, tipo: 'INSUCESSO_REGISTRADO', motivo: '  ' }]),
    });
    expect(r.ok && r.recusados[0].motivo).toBe('insucesso sem motivo');
  });

  it('5. insucesso não vira entrega (e o motivo permanece no histórico)', () => {
    const { ctx, hugo, a, carga } = naRua();
    receberRetornoStreet(ctx, {
      arquivo: 'r1',
      conteudo: retornoStreet(hugo, [{ id_evento: 'i1', carga_id: carga.id, hub_pacote_id: a.id, tipo: 'INSUCESSO_REGISTRADO', motivo: 'Endereço fechado' }]),
    });
    const r = receberRetornoStreet(ctx, {
      arquivo: 'r2',
      conteudo: retornoStreet(hugo, [{ id_evento: 'e1', carga_id: carga.id, hub_pacote_id: a.id }]),
    });
    expect(r.ok && r.recusados[0].motivo).toMatch(/insucesso não vira entrega/);
    const d = detalharPacote(ctx, a.id);
    expect(d.pacote.estado).toBe('INSUCESSO');
    expect(d.timeline.filter((e) => e.tipo === 'INSUCESSO_REGISTRADO').map((e) => e.dados)).toMatchObject([{ motivo: 'Endereço fechado' }]);
  });

  it('carga fica CONCLUIDA quando todos os pacotes têm desfecho (entrega ou insucesso)', () => {
    const { ctx, hugo, a, b, carga } = naRua();
    receberRetornoStreet(ctx, {
      arquivo: 'r.json',
      conteudo: retornoStreet(hugo, [
        { carga_id: carga.id, hub_pacote_id: a.id },
        { carga_id: carga.id, hub_pacote_id: b.id, tipo: 'INSUCESSO_REGISTRADO', motivo: 'Recusado' },
      ]),
    });
    expect(detalharCarga(ctx, carga.id)).toMatchObject({ situacao: 'CONCLUIDA', porEstado: { ENTREGUE: 1, INSUCESSO: 1 } });
  });

  it('7. correção nunca apaga o histórico: evento novo aponta para o antigo', () => {
    const { ctx, hugo, a, carga } = naRua();
    receberRetornoStreet(ctx, { arquivo: 'r', conteudo: retornoStreet(hugo, [{ carga_id: carga.id, hub_pacote_id: a.id }]) });
    const entrega = ctx.armazem.eventos.doPacote(a.id).at(-1)!;
    const antes = ctx.armazem.eventos.doPacote(a.id);

    registrarCorrecao(ctx, { pacoteId: a.id, eventoId: entrega.id, motivo: 'baixa no pacote errado', ator: 'Galpão', chave: 'c1' });

    const depois = ctx.armazem.eventos.doPacote(a.id);
    expect(depois.slice(0, antes.length)).toEqual(antes); // o passado está intacto
    expect(depois.at(-1)).toMatchObject({
      tipo: 'CORRECAO_REGISTRADA',
      dados: { eventoCorrigido: { id: entrega.id, tipo: 'ENTREGA_REGISTRADA' }, motivo: 'baixa no pacote errado' },
    });
    expect(ctx.armazem.pacotes.porId(a.id)).toMatchObject({ estado: 'EM_ROTA', confirmacaoEntrega: null });
    expect(reconstruir(depois)).toEqual(ctx.armazem.pacotes.porId(a.id));
    // o mesmo desfecho não pode ser corrigido duas vezes; retry com a mesma chave não duplica
    expect(() => registrarCorrecao(ctx, { pacoteId: a.id, eventoId: entrega.id, motivo: 'de novo', ator: 'Galpão', chave: 'c2' })).toThrow(/último desfecho/);
    expect(ctx.armazem.eventos.doPacote(a.id)).toHaveLength(depois.length);
  });

  it('9. retry continua idempotente (mesmo arquivo 2x, entrega e insucesso)', () => {
    const { ctx, hugo, a, b, carga } = naRua();
    const conteudo = retornoStreet(hugo, [
      { carga_id: carga.id, hub_pacote_id: a.id },
      { carga_id: carga.id, hub_pacote_id: b.id, tipo: 'INSUCESSO_REGISTRADO', motivo: 'Ausente' },
    ]);
    receberRetornoStreet(ctx, { arquivo: 'retorno.json', conteudo });
    const r2 = receberRetornoStreet(ctx, { arquivo: 'retorno.json', conteudo });
    expect(r2).toEqual({ ok: true, aceitos: 0, repetidos: 2, recusados: [] });
    expect(eventosDo(ctx, a.id).filter((t) => t === 'ENTREGA_REGISTRADA')).toHaveLength(1);
    expect(eventosDo(ctx, b.id).filter((t) => t === 'INSUCESSO_REGISTRADO')).toHaveLength(1);
  });

  it('8. separação entre ajudantes: retorno da Ana não mexe na carga do Hugo', () => {
    const { ctx, ana, a, carga } = naRua();
    const r = receberRetornoStreet(ctx, { arquivo: 'r2.json', conteudo: retornoStreet(ana, [{ carga_id: carga.id, hub_pacote_id: a.id }]) });
    expect(r.ok && r.recusados[0].motivo).toMatch(/é de Hugo/);
    expect(ctx.armazem.pacotes.porId(a.id)?.estado).toBe('EM_ROTA');
  });

  it('recusa com motivo (e registra no histórico da carga) o que não pode ser aplicado', () => {
    const { ctx, hugo, a, c, carga } = naRua();
    const r = receberRetornoStreet(ctx, {
      arquivo: 'r.json',
      conteudo: retornoStreet(hugo, [
        { carga_id: carga.id, hub_pacote_id: c.id, codigo: 'C' }, // pacote da Ana, fora da carga
        { carga_id: carga.id, hub_pacote_id: a.id, tipo: 'RETORNADO_AO_GALPAO' }, // tipo ainda não aceito
        { carga_id: 'nao-existe', hub_pacote_id: a.id }, // carga desconhecida
        { carga_id: carga.id, hub_pacote_id: a.id, ocorrido_em: 'ontem' }, // data inválida
      ]),
    });
    if (!r.ok) throw new Error('esperava ok');
    expect(r.aceitos).toBe(0);
    expect(r.recusados.map((x) => x.motivo)).toEqual([
      'pacote não faz parte da carga C-20260923-HUGO-1',
      'tipo de evento "RETORNADO_AO_GALPAO" ainda não é aceito pelo HUB',
      'carga nao-existe não existe no HUB',
      'data/hora inválida: "ontem"',
    ]);
    const hist = detalharCarga(ctx, carga.id).historico.at(-1)!;
    expect(hist.tipo === 'RETORNO_RECEBIDO' && hist.dados.recusados).toHaveLength(3);
    expect(ctx.armazem.pacotes.porId(a.id)?.estado).toBe('EM_ROTA');
  });

  it('segunda entrega do mesmo pacote (outro id) é recusada, não reescreve a primeira', () => {
    const { ctx, hugo, a, carga } = naRua();
    receberRetornoStreet(ctx, { arquivo: 'r.json', conteudo: retornoStreet(hugo, [{ carga_id: carga.id, hub_pacote_id: a.id, id_evento: 'x1' }]) });
    const r = receberRetornoStreet(ctx, {
      arquivo: 'r.json',
      conteudo: retornoStreet(hugo, [{ carga_id: carga.id, hub_pacote_id: a.id, id_evento: 'x2' }]),
    });
    expect(r.ok && r.recusados[0].motivo).toMatch(/já teve desfecho/);
  });

  it('arquivo que não segue o contrato é recusado inteiro', () => {
    const { ctx } = naRua();
    expect(receberRetornoStreet(ctx, { arquivo: 'x', conteudo: '{"schema":"logiscan.carga/v0"}' })).toMatchObject({ ok: false });
    expect(receberRetornoStreet(ctx, { arquivo: 'x', conteudo: 'nada' })).toMatchObject({ ok: false });
  });
});
