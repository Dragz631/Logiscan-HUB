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
  confirmarRepasses,
  criarPerfil,
  detalharPerfil,
  editarPerfil,
  finalizarRota,
  listarPerfis,
  listarRuas,
  listarUnidades,
  removerRuaDaCarga,
} from '../src/application/orquestracao';
import type { Contexto } from '../src/application/portas';
import {
  aplicarConhecimentoInicial,
  consultorDeRegioes,
  criarRegiao,
  definirRegiao,
  mapaDeRegioes,
} from '../src/application/regioes';
import { readFileSync } from 'node:fs';
import { ruaOperacional } from '../src/domain/regioes';
import { confirmarRecebimento as recebido } from '../src/application/transporteStreet';
import { cargasDoPerfil, confirmarRecebimento, perfisParaStreet, receberEventosStreet } from '../src/application/transporteStreet';
import { DocumentoCargaV0 } from '../src/contracts/cargaV0';
import { reconstruir } from '../src/domain/eventos';
import { caixaParaCadaRua, contextoDeTeste, documento, pacote } from './ajuda';

/**
 * Operação com 5 ruas; Rua X tem 3 locais no nº 120 (casa, loja, condomínio).
 * V0.5: por padrão cada rua já está na SUA caixa (caixas de rua); `caixas=false` = ruas ainda sem caixa (triagem).
 */
function operacao(caixas = true) {
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
  if (caixas) caixaParaCadaRua(ctx);
  const hugo = criarPerfil(ctx, { nome: 'Hugo', veiculo: 'Moto' });
  const ana = criarPerfil(ctx, { nome: 'Ana' });
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
    const { ctx } = operacao(false);
    expect(listarRuas(ctx).find((r) => r.nome === 'Travessa X')?.regiao).toEqual({ status: 'desconhecida' });
  });

  it('1/3/4. confirmação vira memória; rua conhecida → região automática na próxima importação', () => {
    const { ctx } = operacao(false);
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
    // a rua entrou sozinha na caixa Quinta do Caju (as duas grafias)
    const caixa = listarRuas(ctx).find((x) => x.chave === `regiao:${quinta.id}`)!;
    expect(caixa.total).toBe(2);
    expect(caixa.regiao).toEqual({ status: 'conhecida', id: quinta.id, nome: 'Quinta do Caju' });
  });

  it('"deixar sem região" também é lembrado (não pergunta de novo)', () => {
    const { ctx } = operacao(false);
    definirRegiao(ctx, { rua: 'Rua General Gurjão', regiaoId: null, ator: 'Galpão' });
    expect(consultorDeRegioes(ctx)('rua general gurjao')).toEqual({ status: 'sem_regiao' });
  });

  it('5/6. a mesma rua não fica em duas regiões: mudança sem confirmação vira CONFLITO para revisão', () => {
    const { ctx } = operacao(false);
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
    const { ctx } = operacao(false);
    const antes = ctx.armazem.pacotes.listar();
    const eventosAntes = antes.map((p) => ctx.armazem.eventos.doPacote(p.id).length);
    definirRegiao(ctx, { rua: 'Rua X', regiaoId: criarRegiao(ctx, 'Caju', 'Galpão').id, ator: 'Galpão' });
    expect(ctx.armazem.pacotes.listar()).toEqual(antes);
    expect(ctx.armazem.pacotes.listar().map((p) => ctx.armazem.eventos.doPacote(p.id).length)).toEqual(eventosAntes);
  });
});

describe('perfis', () => {
  it('12/13. card do ajudante: só pacotes e ruas; nenhuma regra de capacidade/lotação bloqueia', () => {
    const { ctx, hugo } = operacao();
    expect(hugo).toMatchObject({ nome: 'Hugo', veiculo: 'Moto', ativo: true });
    expect(hugo).not.toHaveProperty('capacidade');
    atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua X', 'Rua Carlos Seidl', 'Rua Leão XIII'], ator: 'Galpão', chave: 'k' });
    atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua General Gurjão', 'Travessa X'], ator: 'Galpão', chave: 'k2' }); // muitos pacotes: nada bloqueia
    const p = listarPerfis(ctx).find((x) => x.ajudante.id === hugo.id)!;
    expect(p).toMatchObject({ pacotes: 8, ruas: 5 });
    expect(p).not.toHaveProperty('excesso');
    expect(editarPerfil(ctx, hugo.id, { nome: 'Hugo S.' })).toMatchObject({ nome: 'Hugo S.', veiculo: null });
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
    expect(listarRuas(ctx).find((x) => x.nome === 'Rua X')).toMatchObject({ estado: 'ATRIBUIDA', responsaveis: [hugo.id], disponiveis: 0 });
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
    expect(listarRuas(ctx).find((x) => x.nome === 'Rua X')?.estado).toBe('EM_ROTA');
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
    expect(listarRuas(ctx).find((x) => x.nome === 'Rua X')?.estado).toBe('DISPONIVEL');
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
    const rua = listarRuas(ctx).find((x) => x.nome === 'Rua X')!;
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

describe('repasse em lote (tela Orquestrador de Repasse)', () => {
  it('confirma o plano inteiro: várias ruas para vários ajudantes, cada um com sua carga MONTADA', () => {
    const { ctx, hugo, ana } = operacao();
    const r = confirmarRepasses(ctx, {
      repasses: [
        { ajudanteId: hugo.id, ruas: ['Rua X', 'Rua Carlos Seidl'] },
        { ajudanteId: ana.id, ruas: ['Rua Leão XIII'] },
      ],
      ator: 'Galpão',
      chave: 'plano-1',
    });
    expect(r.cargas).toEqual([
      { ajudante: 'Hugo', codigo: 'C-20260923-HUGO-1', pacotes: 5, ruas: 2 },
      { ajudante: 'Ana', codigo: 'C-20260923-ANA-1', pacotes: 1, ruas: 1 },
    ]);
    expect(porCodigo(ctx, 'L1').responsavelId).toBe(ana.id);
  });

  it('tudo ou nada: um repasse inválido não deixa nenhum outro gravado', () => {
    const { ctx, hugo, ana } = operacao();
    atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua X'], ator: 'Galpão', chave: 'antes' });
    expect(() =>
      confirmarRepasses(ctx, {
        repasses: [
          { ajudanteId: ana.id, ruas: ['Rua Leão XIII'] },
          { ajudanteId: ana.id, ruas: ['Rua X'] }, // já é do Hugo
        ],
        ator: 'Galpão',
        chave: 'plano-2',
      }),
    ).toThrow(/com Hugo/);
    expect(porCodigo(ctx, 'L1').responsavelId).toBeNull();
    expect(detalharPerfil(ctx, ana.id).carga).toBeNull();
  });

  it('a mesma rua não pode estar planejada para dois ajudantes', () => {
    const { ctx, hugo, ana } = operacao();
    expect(() =>
      confirmarRepasses(ctx, {
        repasses: [{ ajudanteId: hugo.id, ruas: ['Rua X'] }, { ajudanteId: ana.id, ruas: ['RUA X'] }],
        ator: 'Galpão',
        chave: 'plano-3',
      }),
    ).toThrow(/mais de um ajudante/);
  });

  it('retry do mesmo plano (mesma chave) não duplica', () => {
    const { ctx, hugo } = operacao();
    const plano = { repasses: [{ ajudanteId: hugo.id, ruas: ['Rua X'] }], ator: 'Galpão', chave: 'plano-4' };
    confirmarRepasses(ctx, plano);
    const antes = tipos(ctx, 'X1');
    expect(confirmarRepasses(ctx, plano).cargas[0].pacotes).toBe(3);
    expect(tipos(ctx, 'X1')).toEqual(antes);
  });
});

// ---------------------------------------------------------------------------
// V0.3 — conhecimento operacional (Manilha configurável, Quinta aprendida, Diversos), carga e perfil
// ---------------------------------------------------------------------------

const CONHECIMENTO = JSON.parse(readFileSync('src/infrastructure/conhecimento/conhecimento-inicial.json', 'utf8'));

/** Operação com endereços da Manilha misturados como a J&T faz. */
function operacaoManilha() {
  const ctx = contextoDeTeste();
  aplicarConhecimentoInicial(ctx, CONHECIMENTO);
  const r = prepararImportacao(ctx, {
    arquivo: 'manilha.json',
    conteudo: documento([
      pacote({ tracking_code: 'M1', street: 'Rua Leão XIII', number: '5', complement: 'Rua B casa 5' }, 0), // → Rua B
      pacote({ tracking_code: 'M2', street: 'Rua B', number: '7' }, 1),
      pacote({ tracking_code: 'M3', street: 'Rua Leão XIII', number: '24', complement: 'Loja ABC' }, 2), // fica na Leão XIII
      pacote({ tracking_code: 'M4', street: 'Rua Leão XIII', number: '30', complement: 'Rua B / Rua D fundos' }, 3), // empate: não inventa
      pacote({ tracking_code: 'F1', street: 'Rua Franco de Almeida', number: '10' }, 4),
      pacote({ tracking_code: 'F2', street: 'Avenida Brasil', number: '2000' }, 5),
      pacote({ tracking_code: 'Q1', street: 'Travessa X', number: '20', complement: 'Loja' }, 6),
    ]),
  });
  if (!r.ok) throw new Error('import');
  confirmarImportacao(ctx, r.loteId, 'Galpão');
  const hugo = criarPerfil(ctx, { nome: 'Hugo' });
  const ana = criarPerfil(ctx, { nome: 'Ana' });
  return { ctx, hugo, ana };
}

describe('conhecimento operacional configurável', () => {
  it('catálogo de caixas vem do ARQUIVO: Manilha com 14 ruas e prioridade; Quinta começa vazia; associações dentro da 10', () => {
    const { ctx } = operacaoManilha();
    const { regioes } = mapaDeRegioes(ctx);
    const manilha = regioes.find((r) => r.nome === 'Manilha')!;
    expect(manilha.ruas.map((r) => r.nome)).toHaveLength(14);
    expect(manilha.ruas.find((r) => r.nome === 'Rua B')?.prioridade).toBe(1);
    expect(manilha.ruas.find((r) => r.nome === 'Rua Leão XIII')?.prioridade).toBe(2);
    expect(regioes.find((r) => r.nome === 'Quinta do Caju')?.ruas).toEqual([]);
    // V0.5: catálogo de caixas do Hugo — número, ordem e agrupamento das associações
    expect(regioes.map((r) => [r.numero, r.nome])).toEqual([
      ['1', 'Rua Carlos Seidl'], ['1.2', 'Rua Peter Lund'], ['2', 'Rua General Sampaio'], ['3', 'Rua General Gurjão'],
      ['4', 'Rua Praia do Caju'], ['5', 'Rua Tavares Guerra'], ['6', 'Rua Monsenhor Manoel Gomes'], ['7', 'Vila Militar'],
      ['8', 'Manilha'], ['9', 'Quinta do Caju'], ['10', 'Associações'], ['10.1', 'Associação da Chatuba'],
      ['10.2', 'Associação São Sebastião'], ['10.3', 'Associação da Cremente'], ['10.4', 'Associação do Parque Alegria'],
      ['11', 'Fora & Diversos'],
    ]);
    const assoc = regioes.find((r) => r.numero === '10')!;
    expect(regioes.filter((r) => r.paiId === assoc.id).map((r) => r.numero)).toEqual(['10.1', '10.2', '10.3', '10.4']);
    expect(regioes.find((r) => r.nome === 'Fora & Diversos')?.ruas).toEqual([]);
  });

  it('aplicar o conhecimento de novo é idempotente e NUNCA sobrescreve decisão do operador', () => {
    const ctx = contextoDeTeste();
    const quinta = criarRegiao(ctx, 'Quinta do Caju', 'Hugo');
    definirRegiao(ctx, { rua: 'Rua do Canal', regiaoId: quinta.id, ator: 'Hugo' }); // decisão do operador (hipotética)
    const r1 = aplicarConhecimentoInicial(ctx, CONHECIMENTO);
    expect(r1.conflitos).toEqual(['Rua do Canal: já decidido como Quinta do Caju']);
    expect(ctx.armazem.regioes.associacao('rua do canal')?.regiaoId).toBe(quinta.id);
    const r2 = aplicarConhecimentoInicial(ctx, CONHECIMENTO);
    expect(r2).toMatchObject({ regioesCriadas: [], ruasAssociadas: 0 });
  });

  it('rua operacional: "Rua Leão XIII" + "Rua B" no endereço → Rua B (mais específica, por DADO de prioridade)', () => {
    const conhecidas = new Map([
      ['rua b', { chave: 'rua b', nome: 'Rua B', regiaoId: 'm', prioridade: 1 }],
      ['rua d', { chave: 'rua d', nome: 'Rua D', regiaoId: 'm', prioridade: 1 }],
      ['rua leao xiii', { chave: 'rua leao xiii', nome: 'Rua Leão XIII', regiaoId: 'm', prioridade: 2 }],
    ]);
    expect(ruaOperacional({ rua: 'Rua Leão XIII', complemento: 'Rua B casa 5' }, conhecidas)).toMatchObject({ chave: 'rua b', ajustada: true });
    expect(ruaOperacional({ rua: 'Rua Leão XIII', complemento: 'Loja ABC' }, conhecidas)).toMatchObject({ chave: 'rua leao xiii', ajustada: false });
    // duas mais específicas ao mesmo tempo: conflito → não inventa
    expect(ruaOperacional({ rua: 'Rua Leão XIII', complemento: 'Rua B / Rua D' }, conhecidas)).toMatchObject({ chave: 'rua leao xiii', ajustada: false });
    // "rua b" não casa dentro de "rua barao"
    expect(ruaOperacional({ rua: 'Rua Leão XIII', complemento: 'perto da Rua Barão' }, conhecidas).ajustada).toBe(false);
  });

  it('1/4. no orquestrador a Manilha aparece como região, com a rua operacional certa', () => {
    const { ctx } = operacaoManilha();
    // V0.5: a Manilha é UMA caixa; as ruas de dentro (com a rua operacional certa) aparecem ao expandir
    const manilha = listarUnidades(ctx).find((u) => u.nome === 'Manilha')!;
    expect(manilha).toMatchObject({ tipo: 'caixa', total: 4 });
    expect(manilha.ruas.map((r) => [r.nome, r.total])).toEqual([['Rua B', 2], ['Rua Leão XIII', 2]]); // M3 + M4 (empate)
  });

  it('2/3/4. Quinta do Caju: rua desconhecida → revisão; operador ensina → memória → próxima vez automático', () => {
    const { ctx } = operacaoManilha();
    // rua que o HUB não conhece: SEM CAIXA (aguarda a revisão do Hugo na triagem)
    expect(listarRuas(ctx).find((r) => r.chave === 'sem:travessa x')?.regiao).toEqual({ status: 'desconhecida' });
    const quinta = ctx.armazem.regioes.porNome('Quinta do Caju')!;
    definirRegiao(ctx, { rua: 'Travessa X', regiaoId: quinta.id, ator: 'Hugo' });
    const r = prepararImportacao(ctx, { arquivo: 'novo.json', conteudo: documento([pacote({ tracking_code: 'Q2', street: 'TRAVESSA X', number: '8' })], { generated_at: 'x' }) });
    if (!r.ok) throw new Error('import');
    confirmarImportacao(ctx, r.loteId, 'Galpão');
    expect(listarRuas(ctx).find((x) => x.chave === `regiao:${quinta.id}`)).toMatchObject({ total: 2, regiao: { status: 'conhecida', nome: 'Quinta do Caju' } });
  });

  it('6. região (e rua operacional) não altera destino: loja no nº 20 continua loja', () => {
    const { ctx } = operacaoManilha();
    const antes = porCodigo(ctx, 'M1').destinoId;
    definirRegiao(ctx, { rua: 'Travessa X', regiaoId: ctx.armazem.regioes.porNome('Quinta do Caju')!.id, ator: 'Hugo' });
    expect(porCodigo(ctx, 'Q1').destinoId).toBe('travessa x|20|comercio:loja');
    expect(porCodigo(ctx, 'M1').destinoId).toBe(antes);
    expect(porCodigo(ctx, 'M1').dados.rua).toBe('Rua Leão XIII'); // o dado do card não muda
  });

  it('Fora & Diversos: ruas fora da área, ensinadas pelo operador, vão JUNTAS na mesma caixa', () => {
    const { ctx, hugo } = operacaoManilha();
    const diversos = ctx.armazem.regioes.porNome('Fora & Diversos')!;
    definirRegiao(ctx, { rua: 'Rua Franco de Almeida', regiaoId: diversos.id, ator: 'Hugo' });
    definirRegiao(ctx, { rua: 'Avenida Brasil', regiaoId: diversos.id, ator: 'Hugo' });
    const grupo = listarRuas(ctx).find((r) => r.chave === `regiao:${diversos.id}`)!;
    expect(grupo).toMatchObject({ nome: 'Fora & Diversos', total: 2, logradouros: ['Avenida Brasil', 'Rua Franco de Almeida'] });
    const r = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: [grupo.chave], ator: 'Galpão', chave: 'd' });
    expect(r.pacotes).toBe(2);
    expect([porCodigo(ctx, 'F1'), porCodigo(ctx, 'F2')].every((p) => p.responsavelId === hugo.id)).toBe(true);
  });
});

describe('repasse, carga e perfil (V0.3)', () => {
  it('7/8 (V0.5). pedir uma rua = a CAIXA inteira dela; rua sem caixa não sai (triagem)', () => {
    const { ctx, hugo, ana } = operacaoManilha();
    // Rua B está na caixa Manilha: vai a Manilha inteira (Rua B + Leão XIII)
    expect(atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['rua b'], ator: 'Galpão', chave: 'a' }).pacotes).toBe(4);
    // Travessa X ainda não tem caixa: recusado com motivo, nada gravado
    expect(() => atribuirRuas(ctx, { ajudanteId: ana.id, ruas: ['travessa x'], ator: 'Galpão', chave: 'b' })).toThrow(/triagem/);
    definirRegiao(ctx, { rua: 'Travessa X', regiaoId: ctx.armazem.regioes.porNome('Quinta do Caju')!.id, ator: 'Hugo' });
    expect(atribuirRuas(ctx, { ajudanteId: ana.id, ruas: ['travessa x'], ator: 'Galpão', chave: 'c' }).pacotes).toBe(1);
  });

  it('17. uma carga pertence a um único ajudante', () => {
    const { ctx, hugo, ana } = operacaoManilha();
    const c = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['rua b'], ator: 'Galpão', chave: 'a' }).carga;
    expect(c.ajudante.id).toBe(hugo.id);
    expect(() => atribuirRuas(ctx, { ajudanteId: ana.id, ruas: ['rua b'], ator: 'Galpão', chave: 'b' })).toThrow(/com Hugo/);
    expect(detalharCarga(ctx, c.id).pacotes.every((p) => p.responsavelId === hugo.id)).toBe(true);
  });

  it('perfil: sem carga → nada a acompanhar; carga fora do Street → sem paradas; carga no Street → sequência de paradas', () => {
    const { ctx, hugo } = operacaoManilha();
    expect(detalharPerfil(ctx, hugo.id)).toMatchObject({ carga: null, paradas: [], recebidaNoStreetEm: null });
    const c = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['rua b', 'rua leao xiii'], ator: 'Galpão', chave: 'a' }).carga;
    const montada = detalharPerfil(ctx, hugo.id);
    expect(montada).toMatchObject({ pacotes: 4, ruas: 2, recebidaNoStreetEm: null, paradas: [] });
    expect(montada.ruasDaCarga.every((r) => r.regiao.status === 'conhecida')).toBe(true);
    recebido(ctx, { cargaId: c.id, ajudanteId: hugo.id, quantidade: 4 });
    const noStreet = detalharPerfil(ctx, hugo.id);
    expect(noStreet.recebidaNoStreetEm).not.toBeNull();
    expect(noStreet.paradas.map((x) => [x.rua, x.numero, x.pacotes.length])).toEqual([
      ['Rua B', '5', 1],
      ['Rua B', '7', 1],
      ['Rua Leão XIII', '24', 1],
      ['Rua Leão XIII', '30', 1],
    ]);
  });
});
