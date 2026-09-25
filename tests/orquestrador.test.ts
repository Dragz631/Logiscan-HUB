/**
 * V0.2 — Orquestração operacional: regiões, perfis, cargas por rua, ponte e histórico.
 * Numeração = lista de testes combinada com o Hugo.
 */
import { describe, expect, it } from 'vitest';
import { detalharCarga, iniciarRota } from '../src/application/cargas';
import { confirmarImportacao, prepararImportacao } from '../src/application/importacao';
import { entregarAoAjudante } from '../src/application/operacao';
import {
  atribuirRuas,
  criarPerfil,
  detalharPerfil,
  editarPerfil,
  finalizarRota,
  listarPerfis,
  listarRuas,
  removerRuaDaCarga,
} from '../src/application/orquestracao';
import type { Contexto } from '../src/application/portas';
import { consultorDeRegioes, criarRegiao, definirRegiao } from '../src/application/regioes';
import { cargasDoPerfil, confirmarRecebimento, perfisParaStreet, receberEventosStreet } from '../src/application/transporteStreet';
import { DocumentoCargaV0 } from '../src/contracts/cargaV0';
import { reconstruir } from '../src/domain/eventos';
import { contextoDeTeste, documento, pacote } from './ajuda';

/** Operação com 5 ruas; Rua X tem 3 locais no nº 120 (casa, loja, condomínio). */
function operacao() {
  const ctx = contextoDeTeste();
  const r = prepararImportacao(ctx, {
    arquivo: 'lote.json',
    conteudo: documento([
      pacote({ tracking_code: 'X1', street: 'Rua X', number: '120' }, 0),
      pacote({ tracking_code: 'X2', street: 'Rua X', number: '120', complement: 'Loja ABC' }, 1),
      pacote({ tracking_code: 'X3', street: 'RUA X', number: '120', complement: 'Condomínio XYZ Apto 101' }, 2),
      pacote({ tracking_code: 'S1', street: 'Rua Carlos Seidl', number: '10' }, 3),
      pacote({ tracking_code: 'S2', street: 'Rua Carlos Seidl', number: '12' }, 4),
      pacote({ tracking_code: 'L1', street: 'Rua Leão XIII', number: '24' }, 5),
      pacote({ tracking_code: 'T1', street: 'Travessa X', number: '3' }, 6),
      pacote({ tracking_code: 'G1', street: 'Rua General Gurjão', number: '448' }, 7),
    ]),
  });
  if (!r.ok) throw new Error('import');
  confirmarImportacao(ctx, r.loteId, 'Galpão');
  const hugo = criarPerfil(ctx, { nome: 'Hugo', veiculo: 'Moto', capacidade: 5 });
  const ana = criarPerfil(ctx, { nome: 'Ana', capacidade: 30 });
  return { ctx, hugo, ana };
}

const porCodigo = (ctx: Contexto, codigo: string) => ctx.armazem.pacotes.porChave('jtexpress', codigo)!;
const tipos = (ctx: Contexto, codigo: string) => ctx.armazem.eventos.doPacote(porCodigo(ctx, codigo).id).map((e) => e.tipo);

function retorno(ajudante: { id: string; nome: string }, eventos: Record<string, unknown>[]) {
  return {
    schema: 'logiscan.street-eventos/v0',
    gerado_em: '2026-09-23T15:00:00.000Z',
    ajudante,
    eventos: eventos.map((e, i) => ({ id_evento: `ev-${i}`, tipo: 'ENTREGA_REGISTRADA', codigo: '', ocorrido_em: '2026-09-23T14:00:00.000Z', ...e })),
  };
}

describe('regiões (memória operacional do HUB)', () => {
  it('2. rua desconhecida → região a definir (revisão)', () => {
    const { ctx } = operacao();
    expect(listarRuas(ctx).find((r) => r.nome === 'Travessa X')?.regiao).toEqual({ status: 'desconhecida' });
  });

  it('1/3/4. confirmação vira memória; rua conhecida → região automática na próxima importação', () => {
    const { ctx } = operacao();
    const quinta = criarRegiao(ctx, 'Quinta do Caju', 'Galpão');
    expect(definirRegiao(ctx, { rua: 'Travessa X', regiaoId: quinta.id, ator: 'Galpão' })).toEqual({ ok: true, mudou: true });
    expect(ctx.armazem.regioes.associacao('travessa x')).toMatchObject({ regiaoId: quinta.id, definidaPor: 'Galpão' });

    // nova importação com a mesma rua (grafia diferente): associação automática, sem pedir de novo
    const r = prepararImportacao(ctx, {
      arquivo: 'outro.json',
      conteudo: documento([pacote({ tracking_code: 'T2', street: 'TRAVESSA X', number: '9' })], { generated_at: 'outro' }),
    });
    if (!r.ok) throw new Error('import');
    confirmarImportacao(ctx, r.loteId, 'Galpão');
    const rua = listarRuas(ctx).find((x) => x.chave === 'travessa x')!;
    expect(rua.total).toBe(2);
    expect(rua.regiao).toEqual({ status: 'conhecida', id: quinta.id, nome: 'Quinta do Caju' });
  });

  it('"deixar sem região" também é lembrado (não pergunta de novo)', () => {
    const { ctx } = operacao();
    definirRegiao(ctx, { rua: 'Rua General Gurjão', regiaoId: null, ator: 'Galpão' });
    expect(consultorDeRegioes(ctx)('rua general gurjao')).toEqual({ status: 'sem_regiao' });
  });

  it('5/6. a mesma rua não fica em duas regiões: mudança sem confirmação vira CONFLITO para revisão', () => {
    const { ctx } = operacao();
    const quinta = criarRegiao(ctx, 'Quinta do Caju', 'Galpão');
    const manilha = criarRegiao(ctx, 'Manilha', 'Galpão');
    definirRegiao(ctx, { rua: 'Travessa X', regiaoId: quinta.id, ator: 'Galpão' });

    const r = definirRegiao(ctx, { rua: 'Travessa X', regiaoId: manilha.id, ator: 'Galpão' });
    expect(r).toEqual({ ok: false, conflito: { rua: 'Travessa X', atual: { id: quinta.id, nome: 'Quinta do Caju' } } });
    expect(ctx.armazem.regioes.associacao('travessa x')?.regiaoId).toBe(quinta.id); // nada sobrescrito

    expect(definirRegiao(ctx, { rua: 'Travessa X', regiaoId: manilha.id, ator: 'Galpão', substituir: true })).toEqual({ ok: true, mudou: true });
    expect(ctx.armazem.regioes.associacao('travessa x')?.regiaoId).toBe(manilha.id);
    // histórico guarda as duas decisões
    expect(ctx.armazem.regioes.eventos('travessa x').map((e) => [e.dados.de, e.dados.para])).toEqual([
      [undefined, quinta.id],
      [quinta.id, manilha.id],
    ]);
    // repetir a mesma decisão não gera evento
    expect(definirRegiao(ctx, { rua: 'Travessa X', regiaoId: manilha.id, ator: 'Galpão' })).toEqual({ ok: true, mudou: false });
    expect(ctx.armazem.regioes.eventos('travessa x')).toHaveLength(2);
  });

  it('25. região não altera destino nem pacote', () => {
    const { ctx } = operacao();
    const antes = ctx.armazem.pacotes.listar();
    const eventosAntes = antes.map((p) => ctx.armazem.eventos.doPacote(p.id).length);
    definirRegiao(ctx, { rua: 'Rua X', regiaoId: criarRegiao(ctx, 'Caju', 'Galpão').id, ator: 'Galpão' });
    expect(ctx.armazem.pacotes.listar()).toEqual(antes);
    expect(ctx.armazem.pacotes.listar().map((p) => ctx.armazem.eventos.doPacote(p.id).length)).toEqual(eventosAntes);
  });
});

describe('perfis', () => {
  it('perfil tem veículo e capacidade; capacidade só avisa, não bloqueia', () => {
    const { ctx, hugo } = operacao();
    expect(hugo).toMatchObject({ nome: 'Hugo', veiculo: 'Moto', capacidade: 5, ativo: true });
    atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua X', 'Rua Carlos Seidl', 'Rua Leão XIII'], ator: 'Galpão', chave: 'k' });
    const p = listarPerfis(ctx).find((x) => x.ajudante.id === hugo.id)!;
    expect(p).toMatchObject({ pacotes: 6, ruas: 3, excesso: true });
    expect(editarPerfil(ctx, hugo.id, { nome: 'Hugo S.', capacidade: 10 })).toMatchObject({ nome: 'Hugo S.', capacidade: 10, veiculo: null });
  });

  it('não dá para desativar perfil com carga ativa', () => {
    const { ctx, hugo } = operacao();
    atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua X'], ator: 'Galpão', chave: 'k' });
    expect(() => editarPerfil(ctx, hugo.id, { nome: 'Hugo', ativo: false })).toThrow(/carga ativa/);
  });

  it('7/8. perfil Hugo recebe só a carga do Hugo; Ana não recebe a carga do Hugo', () => {
    const { ctx, hugo, ana } = operacao();
    atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua X'], ator: 'Galpão', chave: 'k' });
    expect(perfisParaStreet(ctx).map((p) => p.nome)).toEqual(['Ana', 'Hugo']);
    const [doc] = cargasDoPerfil(ctx, hugo.id);
    expect(doc.ajudante).toEqual({ id: hugo.id, nome: 'Hugo' });
    expect(cargasDoPerfil(ctx, ana.id)).toEqual([]);
    expect(() => confirmarRecebimento(ctx, { cargaId: doc.carga.id, ajudanteId: ana.id, quantidade: 3 })).toThrow(/não deste perfil/);
  });
});

describe('cargas por rua', () => {
  it('11/13. selecionar 3 ruas → carga MONTADA com TODOS os pacotes dessas ruas', () => {
    const { ctx, hugo } = operacao();
    const r = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua X', 'Rua Carlos Seidl', 'Rua Leão XIII'], ator: 'Galpão', chave: 'k1' });
    expect(r.pacotes).toBe(6);
    expect(r.ruas.map((x) => [x.nome, x.quantidade])).toEqual([['Rua X', 3], ['Rua Carlos Seidl', 2], ['Rua Leão XIII', 1]]);
    const d = detalharCarga(ctx, r.carga.id);
    expect(d.situacao).toBe('MONTADA');
    expect(d.pacotes.map((p) => p.codigo).sort()).toEqual(['L1', 'S1', 'S2', 'X1', 'X2', 'X3']);
    expect(d.pacotes.every((p) => p.estado === 'ATRIBUIDO' && p.responsavelId === hugo.id)).toBe(true);
    expect(d.ruas.map((x) => x.nome)).toEqual(['Rua Carlos Seidl', 'Rua Leão XIII', 'Rua X']);
    expect(listarRuas(ctx).find((x) => x.chave === 'rua x')).toMatchObject({ estado: 'ATRIBUIDA', responsaveis: [hugo.id], disponiveis: 0 });
  });

  it('12/16. uma rua não entra em duas cargas ativas; um pacote só em uma carga ativa', () => {
    const { ctx, hugo, ana } = operacao();
    atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua X'], ator: 'Galpão', chave: 'k1' });
    expect(() => atribuirRuas(ctx, { ajudanteId: ana.id, ruas: ['Rua X'], ator: 'Galpão', chave: 'k2' })).toThrow(/com Hugo/);
    // tudo ou nada: a Rua Carlos Seidl pedida junto não foi para a Ana
    expect(() => atribuirRuas(ctx, { ajudanteId: ana.id, ruas: ['Rua Carlos Seidl', 'Rua X'], ator: 'Galpão', chave: 'k3' })).toThrow();
    expect(porCodigo(ctx, 'S1').responsavelId).toBeNull();
    // mesma rua de novo para o próprio Hugo: nada disponível, não duplica
    expect(() => atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua X'], ator: 'Galpão', chave: 'k4' })).toThrow(/não tem pacotes disponíveis/);
    const naCarga = ctx.armazem.pacotes.listar().filter((p) => p.cargaId !== null);
    expect(new Set(naCarga.map((p) => p.cargaId)).size).toBe(1);
  });

  it('pacotes novos de uma rua já montada entram na MESMA carga ativa (perfil não mistura duas cargas)', () => {
    const { ctx, hugo } = operacao();
    const c1 = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua X'], ator: 'Galpão', chave: 'k1' }).carga;
    const c2 = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua Leão XIII'], ator: 'Galpão', chave: 'k2' }).carga;
    expect(c2.id).toBe(c1.id);
    expect(detalharCarga(ctx, c1.id).total).toBe(4);
  });

  it('retry do mesmo clique de atribuir não duplica nada', () => {
    const { ctx, hugo } = operacao();
    atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua X'], ator: 'Galpão', chave: 'mesma' });
    const antes = tipos(ctx, 'X1');
    const r = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua X'], ator: 'Galpão', chave: 'mesma' });
    expect(r.pacotes).toBe(3);
    expect(tipos(ctx, 'X1')).toEqual(antes);
  });

  it('14/15. iniciar rota → carga e pacotes EM_ROTA, com horários separados; em rota não recebe ruas novas', () => {
    const { ctx, hugo } = operacao();
    const { carga } = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua X'], ator: 'Galpão', chave: 'k1' });
    ctx.avancar(55);
    iniciarRota(ctx, carga.id, 'Operador');
    const d = detalharCarga(ctx, carga.id);
    expect(d).toMatchObject({ situacao: 'EM_ROTA', criadaEm: '2026-09-23T13:00:00.000Z', rotaIniciadaEm: '2026-09-23T13:55:00.000Z' });
    expect(d.pacotes.every((p) => p.estado === 'EM_ROTA')).toBe(true);
    expect(listarRuas(ctx).find((x) => x.chave === 'rua x')?.estado).toBe('EM_ROTA');
    expect(detalharPerfil(ctx, hugo.id)).toMatchObject({ carga: { situacao: 'EM_ROTA' }, rotaIniciadaEm: '2026-09-23T13:55:00.000Z' });
    expect(() => atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua Leão XIII'], ator: 'Galpão', chave: 'k2' })).toThrow(/já está em rota/);
    expect(() => removerRuaDaCarga(ctx, { cargaId: carga.id, rua: 'Rua X', ator: 'Galpão' })).toThrow(/antes de iniciar/);
  });

  it('remover rua antes da rota: pacotes voltam ao galpão sem responsável, com eventos', () => {
    const { ctx, hugo } = operacao();
    const { carga } = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua X', 'Rua Leão XIII'], ator: 'Galpão', chave: 'k1' });
    removerRuaDaCarga(ctx, { cargaId: carga.id, rua: 'RUA X', ator: 'Galpão' });
    expect(porCodigo(ctx, 'X1')).toMatchObject({ estado: 'NAO_ATRIBUIDO', responsavelId: null, cargaId: null });
    expect(tipos(ctx, 'X1')).toEqual(['IMPORTADO', 'ATRIBUIDO', 'INCLUIDO_EM_CARGA', 'RETIRADO_DA_CARGA', 'DESATRIBUIDO']);
    expect(detalharCarga(ctx, carga.id).historico.map((e) => e.tipo)).toEqual(['CARGA_CRIADA', 'RUAS_ADICIONADAS', 'RUA_REMOVIDA']);
    expect(listarRuas(ctx).find((x) => x.chave === 'rua x')?.estado).toBe('DISPONIVEL');
  });

  it('finalizar rota exige desfecho de todos; depois a carga deixa de ser ativa', () => {
    const { ctx, hugo } = operacao();
    const { carga } = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua Leão XIII'], ator: 'Galpão', chave: 'k1' });
    iniciarRota(ctx, carga.id, 'Galpão');
    expect(() => finalizarRota(ctx, carga.id, 'Galpão')).toThrow(/sem desfecho/);
    receberEventosStreet(ctx, retorno(hugo, [{ carga_id: carga.id, hub_pacote_id: porCodigo(ctx, 'L1').id }]));
    finalizarRota(ctx, carga.id, 'Galpão');
    expect(detalharCarga(ctx, carga.id)).toMatchObject({ situacao: 'FINALIZADA', finalizadaPor: 'Galpão' });
    expect(detalharPerfil(ctx, hugo.id).carga).toBeNull();
    expect(cargasDoPerfil(ctx, hugo.id)).toEqual([]);
  });
});

describe('ponte HUB ↔ Street (transporte direto)', () => {
  it('17/19. carga enviada ao perfil; reenvio é idempotente e registra o recebimento uma vez', () => {
    const { ctx, hugo } = operacao();
    const { carga } = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua X'], ator: 'Galpão', chave: 'k1' });
    const [doc] = cargasDoPerfil(ctx, hugo.id);
    expect(DocumentoCargaV0.safeParse(doc).success).toBe(true);
    expect(doc.carga).toMatchObject({ id: carga.id, situacao: 'MONTADA', rota_iniciada_em: null });
    expect(doc.pacotes.map((p) => p.codigo).sort()).toEqual(['X1', 'X2', 'X3']);
    expect(confirmarRecebimento(ctx, { cargaId: carga.id, ajudanteId: hugo.id, quantidade: 3 })).toEqual({ registrado: true });
    expect(confirmarRecebimento(ctx, { cargaId: carga.id, ajudanteId: hugo.id, quantidade: 3 })).toEqual({ registrado: false });
    expect(cargasDoPerfil(ctx, hugo.id)).toEqual([{ ...doc, gerado_em: expect.any(String) }]);
    expect(detalharCarga(ctx, carga.id).historico.filter((e) => e.tipo === 'RECEBIDA_NO_STREET')).toHaveLength(1);
  });

  it('20. evento retornado pelo transporte continua idempotente; entrega antes de iniciar rota é recusada', () => {
    const { ctx, hugo } = operacao();
    const { carga } = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua Leão XIII'], ator: 'Galpão', chave: 'k1' });
    const ev = retorno(hugo, [{ carga_id: carga.id, hub_pacote_id: porCodigo(ctx, 'L1').id }]);
    expect(receberEventosStreet(ctx, ev)).toMatchObject({ ok: true, aceitos: 0, recusados: [{ motivo: expect.stringMatching(/ainda não foi iniciada/) }] });
    iniciarRota(ctx, carga.id, 'Galpão');
    expect(receberEventosStreet(ctx, ev)).toEqual({ ok: true, aceitos: 1, repetidos: 0, recusados: [] });
    expect(receberEventosStreet(ctx, ev)).toEqual({ ok: true, aceitos: 0, repetidos: 1, recusados: [] });
  });
});

describe('histórico', () => {
  it('21/22/23/24. atribuição, reatribuição e início de rota geram eventos; nada anterior é destruído', () => {
    const { ctx, hugo, ana } = operacao();
    const { carga } = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua X'], ator: 'Galpão', chave: 'k1' });
    const x1 = porCodigo(ctx, 'X1').id;
    const snapshot = ctx.armazem.eventos.doPacote(x1);

    removerRuaDaCarga(ctx, { cargaId: carga.id, rua: 'Rua X', ator: 'Galpão', paraAjudanteId: ana.id });
    const depois = ctx.armazem.eventos.doPacote(x1);
    expect(depois.slice(0, snapshot.length)).toEqual(snapshot);
    expect(depois.map((e) => e.tipo)).toEqual([
      'IMPORTADO', 'ATRIBUIDO', 'INCLUIDO_EM_CARGA', 'RETIRADO_DA_CARGA', 'REATRIBUIDO', 'INCLUIDO_EM_CARGA',
    ]);
    expect(depois[4]).toMatchObject({ dados: { de: { id: hugo.id }, para: { id: ana.id } } });
    expect(porCodigo(ctx, 'X1').responsavelId).toBe(ana.id);

    const cargaAna = detalharPerfil(ctx, ana.id).carga!;
    iniciarRota(ctx, cargaAna.id, 'Galpão');
    expect(tipos(ctx, 'X1').at(-1)).toBe('SAIU_PARA_ROTA');
    expect(detalharCarga(ctx, carga.id).historico.at(-1)).toMatchObject({ tipo: 'RUA_REMOVIDA', dados: { motivo: 'reatribuida', para: { nome: 'Ana' } } });
    for (const p of ctx.armazem.pacotes.listar()) {
      expect(reconstruir(ctx.armazem.eventos.doPacote(p.id))).toEqual(p);
    }
  });

  it('reatribuição por pacote (fluxo antigo) continua gerando evento', () => {
    const { ctx, hugo, ana } = operacao();
    const g1 = porCodigo(ctx, 'G1').id;
    entregarAoAjudante(ctx, { pacoteIds: [g1], ajudanteId: hugo.id, ator: 'Galpão', chave: 'a' });
    entregarAoAjudante(ctx, { pacoteIds: [g1], ajudanteId: ana.id, ator: 'Galpão', chave: 'b' });
    expect(tipos(ctx, 'G1')).toEqual(['IMPORTADO', 'ATRIBUIDO', 'REATRIBUIDO']);
  });
});

describe('destino continua intacto na orquestração', () => {
  it('26/27. mesmo nº com casa, loja e condomínio: 3 destinos na rua e na carga; rua+nº não substitui contexto', () => {
    const { ctx, hugo } = operacao();
    const rua = listarRuas(ctx).find((x) => x.chave === 'rua x')!;
    expect(rua).toMatchObject({ total: 3, destinos: 3 });
    atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua X'], ator: 'Galpão', chave: 'k1' });
    const [doc] = cargasDoPerfil(ctx, hugo.id);
    expect(doc.pacotes.map((p) => p.destino_id).sort()).toEqual([
      'rua x|120|',
      'rua x|120|comercio:loja abc',
      'rua x|120|condominio:xyz',
    ]);
  });
});
