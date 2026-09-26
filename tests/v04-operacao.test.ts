/**
 * V0.4 — operação única: unidades de repasse, perfil ativo/inativo, iniciar rota no Orquestrador,
 * identidade da rua (street_id) na carga, retorno Street → HUB e histórico.
 * Numeração = lista de testes do Hugo (itens do Street ficam no SafaSanha).
 */
import { describe, expect, it } from 'vitest';
import { documentoDaCarga, iniciarRota } from '../src/application/cargas';
import { detalharPacote } from '../src/application/consultas';
import { confirmarImportacao, prepararImportacao } from '../src/application/importacao';
import { entregarAoAjudante } from '../src/application/operacao';
import { atribuirRuas, criarPerfil, editarPerfil, listarPerfis, listarUnidades } from '../src/application/orquestracao';
import type { Contexto } from '../src/application/portas';
import { criarRegiao, definirRegiao } from '../src/application/regioes';
import { cargasDoPerfil, confirmarRecebimento, perfisParaStreet, receberEventosStreet } from '../src/application/transporteStreet';
import { podeFicarProntoParaBaixa } from '../src/domain/confirmacao';
import { contextoDeTeste, documento, pacote } from './ajuda';

/**
 * Lote parecido com o real: Manilha (Rua B + Leão XIII), Quinta do Caju (beco ensinado), ruas soltas,
 * grafias da J&T ("PRAIA DO CAJU") e duas ruas parecidas que NÃO são a mesma (Seidl × Seixas).
 */
function operacao() {
  const ctx = contextoDeTeste();
  const manilha = criarRegiao(ctx, 'Manilha', 'Galpão');
  definirRegiao(ctx, { rua: 'Rua B', regiaoId: manilha.id, ator: 'Galpão', prioridade: 1 });
  definirRegiao(ctx, { rua: 'Rua Leão XIII', regiaoId: manilha.id, ator: 'Galpão', prioridade: 2 });
  const quinta = criarRegiao(ctx, 'Quinta do Caju', 'Galpão');
  definirRegiao(ctx, { rua: 'Beco Antônio Faria Salgado', regiaoId: quinta.id, ator: 'Galpão' });
  const r = prepararImportacao(ctx, {
    arquivo: 'lote.json',
    conteudo: documento([
      pacote({ tracking_code: 'M1', street: 'Rua B', number: '5' }, 0),
      pacote({ tracking_code: 'M2', street: 'Rua Leão XIII', number: '24' }, 1),
      pacote({ tracking_code: 'M3', street: 'RUA LEAO XIII', number: '30' }, 2),
      pacote({ tracking_code: 'Q1', street: 'Beco Antônio Faria Salgado', number: '7' }, 3),
      pacote({ tracking_code: 'S1', street: 'Rua Carlos Seidl', number: '10' }, 4),
      pacote({ tracking_code: 'S2', street: 'RUA CARLOS SEIDL', number: '12' }, 5),
      pacote({ tracking_code: 'X1', street: 'Rua Carlos Seixas', number: '3' }, 6),
      pacote({ tracking_code: 'P1', street: 'PRAIA DO CAJU', number: '100' }, 7),
      pacote({ tracking_code: 'P2', street: 'Rua Praia do Caju', number: '102' }, 8),
    ]),
  });
  if (!r.ok) throw new Error('import');
  confirmarImportacao(ctx, r.loteId, 'Galpão');
  const hugo = criarPerfil(ctx, { nome: 'Hugo' });
  const ana = criarPerfil(ctx, { nome: 'Ana' });
  return { ctx, hugo, ana, manilha, quinta };
}

const porCodigo = (ctx: Contexto, codigo: string) => ctx.armazem.pacotes.porChave('jtexpress', codigo)!;
/** Um pacote só com um ajudante (fluxo por pacote), para simular rua dividida. */
const entregarAoAjudanteUm = (ctx: Contexto, codigo: string, ajudanteId: string) =>
  entregarAoAjudante(ctx, { pacoteIds: [porCodigo(ctx, codigo).id], ajudanteId, ator: 'Galpão', chave: `um:${codigo}` });
const unidade = (ctx: Contexto, nome: string) => listarUnidades(ctx).find((u) => u.nome === nome);
const erro = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as { codigo: string; message: string };
  }
  throw new Error('esperava erro');
};

describe('orquestrador: unidades de repasse', () => {
  it('1. região fechada é UM card resumido (quanto tem aqui) — as ruas dela não aparecem soltas', () => {
    const { ctx } = operacao();
    const m = unidade(ctx, 'Manilha')!;
    expect(m).toMatchObject({ tipo: 'regiao', total: 3, disponiveis: 3 });
    expect(m.ruas).toHaveLength(2);
    const nomes = listarUnidades(ctx).map((u) => u.nome);
    expect(nomes).not.toContain('Rua B');
    expect(nomes).not.toContain('Rua Leão XIII');
  });

  it('2. expandir a região mostra as ruas de dentro, com a quantidade de cada uma', () => {
    const { ctx } = operacao();
    expect(unidade(ctx, 'Manilha')!.ruas.map((r) => [r.nome, r.total])).toEqual([['Rua B', 1], ['Rua Leão XIII', 2]]);
    expect(unidade(ctx, 'Quinta do Caju')!.ruas.map((r) => r.nome)).toEqual(['Beco Antônio Faria Salgado']);
  });

  it('3. rua sem região é o próprio card (sem camada extra)', () => {
    const { ctx } = operacao();
    expect(unidade(ctx, 'Rua Carlos Seidl')).toMatchObject({ tipo: 'rua', total: 2 });
  });

  it('3. selecionar a região → todos os pacotes de todas as ruas dela entram na carga', () => {
    const { ctx, hugo, manilha } = operacao();
    const r = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: [`regiao:${manilha.id}`], ator: 'Galpão', chave: 'c1' });
    expect(r.pacotes).toBe(3);
    expect(['M1', 'M2', 'M3'].map((c) => porCodigo(ctx, c).cargaId)).toEqual([r.carga.id, r.carga.id, r.carga.id]);
    expect(porCodigo(ctx, 'S1').cargaId).toBeNull();
  });

  it('4. selecionar uma rua → todos os pacotes daquela rua (e só dela)', () => {
    const { ctx, hugo } = operacao();
    const r = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua Carlos Seidl'], ator: 'Galpão', chave: 'c1' });
    expect(r.pacotes).toBe(2);
    expect(porCodigo(ctx, 'X1').cargaId).toBeNull(); // Carlos Seixas é outra rua
  });

  it('5. região + uma rua dela na mesma seleção não duplica pacotes', () => {
    const { ctx, hugo, manilha } = operacao();
    const r = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: [`regiao:${manilha.id}`, 'Rua B'], ator: 'Galpão', chave: 'c1' });
    expect(r.pacotes).toBe(3);
    expect(new Set(r.carga.pacoteIds).size).toBe(r.carga.pacoteIds.length);
  });

  it('6. rua não pode estar em duas cargas ativas (nem pela região inteira)', () => {
    const { ctx, hugo, ana, manilha } = operacao();
    atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua B'], ator: 'Galpão', chave: 'c1' });
    expect(erro(() => atribuirRuas(ctx, { ajudanteId: ana.id, ruas: ['Rua B'], ator: 'Galpão', chave: 'c2' })).codigo).toBe('RUA_DE_OUTRO');
    // a região inteira para a Ana leva só o que sobrou (Leão XIII); a Rua B continua só com o Hugo
    const r = atribuirRuas(ctx, { ajudanteId: ana.id, ruas: [`regiao:${manilha.id}`], ator: 'Galpão', chave: 'c3' });
    expect(r.ruas.map((x) => x.nome)).toEqual(['Rua Leão XIII']);
    expect(porCodigo(ctx, 'M1').responsavelId).toBe(hugo.id);
  });
});

describe('região inteira com rua dividida (caso real: beco com parte já com outro ajudante)', () => {
  it('entram as ruas que podem ir; a rua dividida fica de fora COM aviso (quantos, com quem)', () => {
    const { ctx, hugo, ana, quinta } = operacao();
    definirRegiao(ctx, { rua: 'Rua Carlos Seidl', regiaoId: quinta.id, ator: 'Galpão' });
    entregarAoAjudanteUm(ctx, 'S1', hugo.id); // S1 com o Hugo; S2 (mesma rua) continua no galpão
    const r = atribuirRuas(ctx, { ajudanteId: ana.id, ruas: [`regiao:${quinta.id}`], ator: 'Galpão', chave: 'c1' });
    expect(r.ruas.map((x) => x.nome)).toEqual(['Beco Antônio Faria Salgado']);
    expect(r.deFora).toEqual([{ rua: 'Rua Carlos Seidl', com: 'Hugo', pacotes: 1 }]);
    expect(porCodigo(ctx, 'S2').cargaId).toBeNull();
  });

  it('rua dividida escolhida SOZINHA continua recusada com erro (nada silencioso)', () => {
    const { ctx, hugo, ana } = operacao();
    entregarAoAjudanteUm(ctx, 'S1', hugo.id);
    expect(erro(() => atribuirRuas(ctx, { ajudanteId: ana.id, ruas: ['Rua Carlos Seidl'], ator: 'Galpão', chave: 'c1' })).codigo).toBe('RUA_DE_OUTRO');
  });
});

describe('ajudantes: perfil ativo/inativo, identidade = helper_id', () => {
  it('7. ajudante INATIVO não recebe carga — e o motivo é explícito', () => {
    const { ctx, hugo } = operacao();
    editarPerfil(ctx, hugo.id, { nome: 'Hugo', ativo: false });
    const e = erro(() => atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua Carlos Seidl'], ator: 'Galpão', chave: 'c1' }));
    expect(e.codigo).toBe('AJUDANTE_INATIVO');
    expect(e.message).toMatch(/INATIVO/);
    expect(porCodigo(ctx, 'S1').cargaId).toBeNull();
  });

  it('8. ajudante ATIVO recebe carga', () => {
    const { ctx, ana } = operacao();
    expect(atribuirRuas(ctx, { ajudanteId: ana.id, ruas: ['Rua Carlos Seidl'], ator: 'Galpão', chave: 'c1' }).pacotes).toBe(2);
  });

  it('9. ativar/desativar muda a disponibilidade (repasse e lista do Street)', () => {
    const { ctx, hugo } = operacao();
    editarPerfil(ctx, hugo.id, { nome: 'Hugo', ativo: false });
    expect(perfisParaStreet(ctx).map((p) => p.id)).not.toContain(hugo.id);
    editarPerfil(ctx, hugo.id, { nome: 'Hugo', ativo: true });
    expect(perfisParaStreet(ctx).map((p) => p.id)).toContain(hugo.id);
    expect(atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua Carlos Seidl'], ator: 'Galpão', chave: 'c1' }).pacotes).toBe(2);
  });

  it('não desativa quem tem carga ativa (diz por quê)', () => {
    const { ctx, hugo } = operacao();
    atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua Carlos Seidl'], ator: 'Galpão', chave: 'c1' });
    expect(erro(() => editarPerfil(ctx, hugo.id, { nome: 'Hugo', ativo: false })).codigo).toBe('TEM_CARGA_ATIVA');
  });

  it('10. helper_id é a identidade: trocar o nome não perde a carga do perfil', () => {
    const { ctx, hugo } = operacao();
    const r = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua Carlos Seidl'], ator: 'Galpão', chave: 'c1' });
    editarPerfil(ctx, hugo.id, { nome: 'Hugo Silva' });
    const [doc] = cargasDoPerfil(ctx, hugo.id);
    expect(doc.carga.id).toBe(r.carga.id);
    expect(doc.ajudante.id).toBe(hugo.id);
  });
});

describe('carga: montada → iniciar rota no Orquestrador → street_id', () => {
  it('11. criar a carga NÃO inicia a rota', () => {
    const { ctx, hugo } = operacao();
    const r = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua Carlos Seidl'], ator: 'Galpão', chave: 'c1' });
    expect(r.carga.rotaIniciadaEm).toBeNull();
    expect(porCodigo(ctx, 'S1').estado).toBe('ATRIBUIDO');
    expect(listarPerfis(ctx).find((p) => p.ajudante.id === hugo.id)?.carga?.situacao).toBe('MONTADA');
  });

  it('12/13. iniciar rota → carga e pacotes EM_ROTA, com o horário real; depois a carga fica FECHADA', () => {
    const { ctx, hugo, manilha } = operacao();
    const r = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua Carlos Seidl'], ator: 'Galpão', chave: 'c1' });
    ctx.avancar(10);
    const agora = ctx.relogio.agora();
    expect(iniciarRota(ctx, r.carga.id, 'Galpão')).toEqual({ jaIniciada: false, rotaIniciadaEm: agora });
    const perfil = listarPerfis(ctx).find((p) => p.ajudante.id === hugo.id)!;
    expect(perfil.carga?.situacao).toBe('EM_ROTA');
    expect(perfil.rotaIniciadaEm).toBe(agora);
    expect(porCodigo(ctx, 'S1').estado).toBe('EM_ROTA');
    expect(documentoDaCarga(ctx, ctx.armazem.cargas.porId(r.carga.id)!, agora).carga).toMatchObject({ situacao: 'EM_ROTA', rota_iniciada_em: agora });
    const e = erro(() => atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: [`regiao:${manilha.id}`], ator: 'Galpão', chave: 'c2' }));
    expect(e.codigo).toBe('JA_EM_ROTA');
    expect(e.message).toMatch(/FECHADA/);
  });

  it('14/15. a carga leva helper_id e itens por rua (street_id + região), não uma lista de nomes', () => {
    const { ctx, hugo, manilha } = operacao();
    const r = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: [`regiao:${manilha.id}`, 'Rua Carlos Seidl', 'Rua Praia do Caju'], ator: 'Galpão', chave: 'c1' });
    const doc = documentoDaCarga(ctx, ctx.armazem.cargas.porId(r.carga.id)!, ctx.relogio.agora());
    expect(doc.ajudante.id).toBe(hugo.id);
    const itens = Object.fromEntries(doc.itens!.map((i) => [i.rua_id, i]));
    expect(itens['rua b']).toMatchObject({ regiao_id: manilha.id, regiao_nome: 'Manilha', pacote_ids: [porCodigo(ctx, 'M1').id] });
    expect(itens['rua leao xiii'].pacote_ids).toHaveLength(2); // "Rua Leão XIII" e "RUA LEAO XIII" = mesma rua
    expect(itens['rua carlos seidl']).toMatchObject({ regiao_id: null, pacote_ids: [porCodigo(ctx, 'S1').id, porCodigo(ctx, 'S2').id] });
    // "PRAIA DO CAJU" (sem tipo) encaixa na única "Rua Praia do Caju": um street_id só
    expect(itens['rua praia do caju'].pacote_ids).toHaveLength(2);
    const p1 = doc.pacotes.find((p) => p.codigo === 'P1')!;
    expect(p1).toMatchObject({ rua: 'PRAIA DO CAJU', rua_id: 'rua praia do caju', rua_nome: 'Rua Praia do Caju' });
  });

  it('19. grafias da mesma rua convergem para um card; ruas parecidas continuam separadas', () => {
    const { ctx } = operacao();
    const nomes = listarUnidades(ctx).map((u) => u.nome);
    expect(nomes.filter((n) => /praia do caju/i.test(n))).toEqual(['Rua Praia do Caju']);
    expect(nomes).toContain('Rua Carlos Seidl');
    expect(nomes).toContain('Rua Carlos Seixas');
  });

  it('região não funde logradouros: Seixas numa região junto com Seidl continua outra rua', () => {
    const { ctx, hugo } = operacao();
    const g = criarRegiao(ctx, 'Rua Carlos Seidl', 'Galpão');
    definirRegiao(ctx, { rua: 'Rua Carlos Seidl', regiaoId: g.id, ator: 'Galpão' });
    definirRegiao(ctx, { rua: 'Rua Carlos Seixas', regiaoId: g.id, ator: 'Galpão' });
    expect(unidade(ctx, 'Rua Carlos Seidl')!.ruas.map((r) => r.nome)).toEqual(['Rua Carlos Seidl', 'Rua Carlos Seixas']);
    const r = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: [`regiao:${g.id}`], ator: 'Galpão', chave: 'c1' });
    const doc = documentoDaCarga(ctx, ctx.armazem.cargas.porId(r.carga.id)!, ctx.relogio.agora());
    expect(doc.itens!.map((i) => i.rua_id).sort()).toEqual(['rua carlos seidl', 'rua carlos seixas']);
  });

  it('nome ensinado sem tipo vale para a mesma rua com tipo (região herdada, identidade única)', () => {
    const ctx = contextoDeTeste();
    const g = criarRegiao(ctx, 'Beira', 'Galpão');
    definirRegiao(ctx, { rua: 'praia do caju', regiaoId: g.id, ator: 'Galpão' });
    const r = prepararImportacao(ctx, {
      arquivo: 'l.json',
      conteudo: documento([pacote({ tracking_code: 'A', street: 'Rua Praia do Caju' }, 0), pacote({ tracking_code: 'B', street: 'PRAIA DO CAJU' }, 1)]),
    });
    if (!r.ok) throw new Error('import');
    confirmarImportacao(ctx, r.loteId, 'Galpão');
    const u = listarUnidades(ctx);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ tipo: 'regiao', nome: 'Beira', total: 2 });
    expect(u[0].ruas.map((x) => x.chave)).toEqual(['rua praia do caju']);
  });
});

describe('retorno Street → HUB (sem provas ainda)', () => {
  function emRota() {
    const o = operacao();
    const r = atribuirRuas(o.ctx, { ajudanteId: o.hugo.id, ruas: ['Rua Carlos Seidl'], ator: 'Galpão', chave: 'c1' });
    o.ctx.avancar(5);
    iniciarRota(o.ctx, r.carga.id, 'Galpão');
    o.ctx.avancar(1);
    confirmarRecebimento(o.ctx, { cargaId: r.carga.id, ajudanteId: o.hugo.id, quantidade: 2 });
    o.ctx.avancar(60);
    return { ...o, carga: r.carga };
  }
  const doc = (ajudante: { id: string; nome: string }, eventos: Record<string, unknown>[]) => ({
    schema: 'logiscan.street-eventos/v0',
    gerado_em: '2026-09-23T15:00:00.000Z',
    ajudante,
    eventos,
  });

  it('22/25. entrega Street → HUB: ENTREGUE, mas PROVA INCOMPLETA (não está pronta para baixa)', () => {
    const { ctx, hugo, carga } = emRota();
    const s1 = porCodigo(ctx, 'S1');
    const r = receberEventosStreet(ctx, doc(hugo, [{
      id_evento: `${s1.id}:entrega:1`, tipo: 'ENTREGA_REGISTRADA', carga_id: carga.id, hub_pacote_id: s1.id, codigo: 'S1',
      ocorrido_em: '2026-09-23T14:32:00.000Z', recebedor: { tipo: 'proprio_morador', detalhes: 'Maria' },
    }]));
    expect(r).toMatchObject({ ok: true, aceitos: 1 });
    const p = porCodigo(ctx, 'S1');
    expect(p.estado).toBe('ENTREGUE');
    expect(p.confirmacaoEntrega).toEqual({ status: 'INCOMPLETA', faltando: ['foto_pacote', 'foto_local'] });
    expect(podeFicarProntoParaBaixa(p)).toBe(false);
    const linha = detalharPacote(ctx, p.id).timeline.find((e) => e.tipo === 'ENTREGA_REGISTRADA')!;
    expect(linha.descricao).toMatch(/Entrega registrada no Street por Hugo — recebido por Maria/);
    expect(linha.aviso).toMatch(/PROVA INCOMPLETA — falta: foto do pacote, foto do local/);
  });

  it('23. insucesso Street → HUB: motivo, horário, ajudante e carga — sem virar entrega', () => {
    const { ctx, hugo, carga } = emRota();
    const s2 = porCodigo(ctx, 'S2');
    receberEventosStreet(ctx, doc(hugo, [{
      id_evento: `${s2.id}:insucesso:1`, tipo: 'INSUCESSO_REGISTRADO', carga_id: carga.id, hub_pacote_id: s2.id, codigo: 'S2',
      ocorrido_em: '2026-09-23T14:40:00.000Z', motivo: 'Destinatário ausente',
    }]));
    const p = porCodigo(ctx, 'S2');
    expect(p.estado).toBe('INSUCESSO');
    expect(p.motivoInsucesso).toBe('Destinatário ausente');
    const ev = ctx.armazem.eventos.doPacote(p.id).find((e) => e.tipo === 'INSUCESSO_REGISTRADO')!;
    expect(ev).toMatchObject({ ocorridoEm: '2026-09-23T14:40:00.000Z', origem: 'street', ator: 'Hugo' });
    expect(ev.tipo === 'INSUCESSO_REGISTRADO' && ev.dados).toMatchObject({ motivo: 'Destinatário ausente', carga: { id: carga.id }, ajudante: { id: hugo.id } });
    expect(ctx.armazem.eventos.doPacote(p.id).some((e) => e.tipo === 'ENTREGA_REGISTRADA')).toBe(false);
  });

  it('24. retry do mesmo evento não duplica', () => {
    const { ctx, hugo, carga } = emRota();
    const s1 = porCodigo(ctx, 'S1');
    const d = doc(hugo, [{ id_evento: 'e-1', tipo: 'ENTREGA_REGISTRADA', carga_id: carga.id, hub_pacote_id: s1.id, codigo: 'S1', ocorrido_em: '2026-09-23T14:32:00.000Z' }]);
    receberEventosStreet(ctx, d);
    expect(receberEventosStreet(ctx, d)).toMatchObject({ ok: true, aceitos: 0, repetidos: 1 });
    expect(ctx.armazem.eventos.doPacote(s1.id).filter((e) => e.tipo === 'ENTREGA_REGISTRADA')).toHaveLength(1);
  });

  it('26–31. timeline completa: importado → atribuído → carga montada → rota iniciada → recebido no Street → entrega / insucesso', () => {
    const { ctx, hugo, carga } = emRota();
    const [s1, s2] = [porCodigo(ctx, 'S1'), porCodigo(ctx, 'S2')];
    receberEventosStreet(ctx, doc(hugo, [
      { id_evento: 'e-1', tipo: 'ENTREGA_REGISTRADA', carga_id: carga.id, hub_pacote_id: s1.id, codigo: 'S1', ocorrido_em: '2026-09-23T14:32:00.000Z' },
      { id_evento: 'e-2', tipo: 'INSUCESSO_REGISTRADO', carga_id: carga.id, hub_pacote_id: s2.id, codigo: 'S2', ocorrido_em: '2026-09-23T14:40:00.000Z', motivo: 'Fechado' },
    ]));
    const tipos = (id: string) => detalharPacote(ctx, id).timeline.map((e) => e.tipo);
    expect(tipos(s1.id)).toEqual(['IMPORTADO', 'ATRIBUIDO', 'INCLUIDO_EM_CARGA', 'SAIU_PARA_ROTA', 'RECEBIDA_NO_STREET', 'ENTREGA_REGISTRADA']);
    expect(tipos(s2.id)).toEqual(['IMPORTADO', 'ATRIBUIDO', 'INCLUIDO_EM_CARGA', 'SAIU_PARA_ROTA', 'RECEBIDA_NO_STREET', 'INSUCESSO_REGISTRADO']);
    expect(detalharPacote(ctx, s1.id).timeline.find((e) => e.tipo === 'RECEBIDA_NO_STREET')?.descricao).toMatch(/recebido no Street de Hugo/);
  });
});
