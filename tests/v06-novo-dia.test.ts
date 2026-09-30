/**
 * V0.6 — NOVO DIA (fechar o dia, Retornado/Devolvido), REPASSE NA HORA e o texto da entrega vindo do Street.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { documentoDaCarga, iniciarRota } from '../src/application/cargas';
import { detalharPacote } from '../src/application/consultas';
import { confirmarImportacao, prepararImportacao, verLote } from '../src/application/importacao';
import { detalharDia, encerrarDia, listarDias, previaNovoDia } from '../src/application/novoDia';
import { atribuirRuas, criarPerfil, editarPerfil, listarPerfis, listarUnidades } from '../src/application/orquestracao';
import type { Contexto } from '../src/application/portas';
import { aplicarConhecimentoInicial } from '../src/application/regioes';
import { pendenciasDaRota, repassarRota } from '../src/application/repasseRota';
import { cargasDoPerfil, receberEventosStreet } from '../src/application/transporteStreet';
import { podeFicarProntoParaBaixa } from '../src/domain/confirmacao';
import { abrirBanco } from '../src/infrastructure/sqlite';
import { contextoDeTeste, documento, pacote } from './ajuda';

const CATALOGO = JSON.parse(readFileSync('src/infrastructure/conhecimento/conhecimento-inicial.json', 'utf8'));

let lote = 0;
function importar(ctx: Contexto, pacotes: Record<string, unknown>[]) {
  const r = prepararImportacao(ctx, { arquivo: `lote-${++lote}.json`, conteudo: documento(pacotes, { generated_at: `g${lote}` }) });
  if (!r.ok) throw new Error('import');
  return r.loteId;
}

const seidl = (cod: string, nome: string, numero: string, card: number) =>
  pacote({ tracking_code: cod, recipient_name: nome, street: 'Rua Carlos Seidl', number: numero, cep: '20931002' }, card);
const gurjao = (cod: string, nome: string, numero: string, card: number) =>
  pacote({ tracking_code: cod, recipient_name: nome, street: 'Rua General Gurjão', number: numero, cep: '20931040' }, card);
const manilha = (cod: string, nome: string, numero: string, card: number) =>
  pacote({ tracking_code: cod, recipient_name: nome, street: 'Rua B', number: numero, cep: '20931010' }, card);
const sampaio = (cod: string, nome: string, numero: string, card: number) =>
  pacote({ tracking_code: cod, recipient_name: nome, street: 'Rua General Sampaio', number: numero, cep: '20931350' }, card);

/**
 * Operação no meio do dia: Hugo leva a caixa 1 (Seidl: S1 entregue, S2 insucesso, S3 pendente) e a caixa 3
 * (Gurjão: G1, G2 pendentes); Ana leva a Manilha (M1, M2 pendentes); João está livre e ativo.
 */
function meioDoDia() {
  const ctx = contextoDeTeste();
  aplicarConhecimentoInicial(ctx, CATALOGO);
  confirmarImportacao(
    ctx,
    importar(ctx, [
      seidl('S1', 'Maria', '10', 0), seidl('S2', 'José', '12', 1), seidl('S3', 'Ana Lúcia', '14', 2),
      gurjao('G1', 'Paulo', '5', 3), gurjao('G2', 'Rita', '7', 4),
      manilha('M1', 'Bia', '1', 5), manilha('M2', 'Caio', '2', 6),
    ]),
    'Galpão',
  );
  const hugo = criarPerfil(ctx, { nome: 'Hugo' });
  const ana = criarPerfil(ctx, { nome: 'Ana' });
  const joao = criarPerfil(ctx, { nome: 'João' });
  const caixa = (n: string) => ctx.armazem.regioes.listar().find((r) => r.numero === n)!;
  const cHugo = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: [`regiao:${caixa('1').id}`, `regiao:${caixa('3').id}`], ator: 'G', chave: 'h' }).carga;
  const cAna = atribuirRuas(ctx, { ajudanteId: ana.id, ruas: [`regiao:${caixa('8').id}`], ator: 'G', chave: 'a' }).carga;
  iniciarRota(ctx, cHugo.id, 'G');
  iniciarRota(ctx, cAna.id, 'G');
  const p = (c: string) => ctx.armazem.pacotes.porChave('jtexpress', c)!;
  let n = 0;
  const street = (ajudante: { id: string; nome: string }, carga: string, eventos: Record<string, unknown>[]) =>
    receberEventosStreet(ctx, {
      schema: 'logiscan.street-eventos/v0',
      gerado_em: '2026-09-23T15:00:00.000Z',
      ajudante,
      eventos: eventos.map((e) => ({ id_evento: `ev-${++n}`, carga_id: carga, ocorrido_em: '2026-09-23T14:00:00.000Z', codigo: '', ...e })),
    });
  street(hugo, cHugo.id, [
    { tipo: 'ENTREGA_REGISTRADA', hub_pacote_id: p('S1').id, recebedor: { tipo: 'proprio_morador', detalhes: 'Maria' }, texto: '📦 *Entrega realizada*\n*Cliente:* Maria' },
    { tipo: 'INSUCESSO_REGISTRADO', hub_pacote_id: p('S2').id, motivo: 'Morador ausente', texto: '⚠️ Insucesso\nMorador ausente' },
  ]);
  const entrega = (pacoteId: string) => ({ tipo: 'ENTREGA_REGISTRADA', hub_pacote_id: pacoteId, recebedor: { tipo: 'vizinho', detalhes: 'Vizinho' } });
  return { ctx, hugo, ana, joao, cHugo, cAna, caixa, p, street, entrega };
}

const erro = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as { codigo: string; message: string };
  }
  throw new Error('esperava erro');
};

describe('Novo dia — prévia', () => {
  it('1. conta entregues, insucessos e sobras por ajudante', () => {
    const { ctx } = meioDoDia();
    const v = previaNovoDia(ctx);
    const hugo = v.cargas.find((c) => c.ajudante.nome === 'Hugo')!;
    expect(hugo).toMatchObject({ situacao: 'EM_ROTA', pacotes: 5, entregues: 1, insucessos: 1, sobras: 4 });
    expect(hugo.caixas.sort()).toEqual(['Rua Carlos Seidl', 'Rua General Gurjão']);
    expect(v.cargas.find((c) => c.ajudante.nome === 'Ana')).toMatchObject({ situacao: 'EM_ROTA', sobras: 2 });
    expect(v.totais).toMatchObject({ cargasEmRota: 2, montadas: 0, entregues: 1, sobras: 6 });
    expect(v.dataRef).toBe('2026-09-23');
  });
});

describe('Novo dia — encerrar', () => {
  it('2. "amanhã" → RETORNADO na mesma caixa, sem ajudante, com a etiqueta do dia anterior; o entregue fica entregue', () => {
    const { ctx, hugo, ana, cHugo, p } = meioDoDia();
    ctx.avancar(24 * 60); // o Hugo fecha no dia seguinte
    const r = encerrarDia(ctx, { ator: 'Hugo', chave: 'd1', historico: true, destinos: { [hugo.id]: 'amanha', [ana.id]: 'galpao' } });
    expect(r.dia).toMatchObject({ dataRef: '2026-09-24', historico: true });
    expect(r.dia.resumo.totais).toEqual({ cargas: 2, entregues: 1, amanha: 4, galpao: 2, desfeitas: 0 });
    for (const c of ['S2', 'S3', 'G1', 'G2']) {
      expect(p(c)).toMatchObject({
        estado: 'RETORNADO', responsavelId: null, cargaId: null,
        retornadoDe: { dia: '2026-09-23', carga: cHugo.codigo, ajudante: 'Hugo' },
      });
    }
    expect(p('S1')).toMatchObject({ estado: 'ENTREGUE', responsavelId: hugo.id });
    expect(listarUnidades(ctx).find((u) => u.numero === '1')).toMatchObject({ total: 2, disponiveis: 2, retornados: 2, diasRetornados: ['2026-09-23'] });
    // as cargas fecharam e os ajudantes ficaram livres
    expect(ctx.armazem.cargas.idsAtivas().size).toBe(0);
    expect(ctx.armazem.cargas.ativaDoAjudante(hugo.id)).toBeUndefined();
    expect(listarDias(ctx).map((d) => d.id)).toEqual([r.dia.id]);
    expect(detalharDia(ctx, r.dia.id).resumo.cargas.map((c) => `${c.ajudante.nome}:${c.destino}`).sort()).toEqual(['Ana:galpao', 'Hugo:amanha']);
  });

  it('3. "galpão" → DEVOLVIDO, fora da operação; o mesmo código num lote novo REABRE o pacote', () => {
    const { ctx, hugo, ana, p } = meioDoDia();
    encerrarDia(ctx, { ator: 'Hugo', chave: 'd1', historico: true, destinos: { [hugo.id]: 'amanha', [ana.id]: 'galpao' } });
    expect(p('M1')).toMatchObject({ estado: 'DEVOLVIDO', responsavelId: null, cargaId: null, retornadoDe: null });
    expect(listarUnidades(ctx).find((u) => u.numero === '8')).toBeUndefined(); // saiu da operação

    const loteId = importar(ctx, [manilha('M1', 'Bia', '1', 0)]);
    expect(verLote(ctx, loteId).itens[0]).toMatchObject({ classe: 'REABRIR', entra: true });
    expect(confirmarImportacao(ctx, loteId, 'Galpão')).toMatchObject({ reabertos: 1, criados: 0 });
    expect(p('M1')).toMatchObject({ estado: 'NAO_ATRIBUIDO' });
    expect(listarUnidades(ctx).find((u) => u.numero === '8')).toMatchObject({ total: 1, disponiveis: 1 });
    expect(ctx.armazem.eventos.doPacote(p('M1').id).map((e) => e.tipo).slice(-2)).toEqual(['DIA_ENCERRADO', 'REABERTO_DO_GALPAO']);
  });

  it('4. o RETORNADO é repassável no dia seguinte; a etiqueta sai quando ele volta a ter ajudante', () => {
    const { ctx, hugo, ana, joao, p, caixa } = meioDoDia();
    encerrarDia(ctx, { ator: 'Hugo', chave: 'd1', historico: true, destinos: { [hugo.id]: 'amanha', [ana.id]: 'galpao' } });
    const r = atribuirRuas(ctx, { ajudanteId: joao.id, ruas: [`regiao:${caixa('1').id}`], ator: 'G', chave: 'amanha' });
    expect(r.pacotes).toBe(2);
    expect(p('S3')).toMatchObject({ estado: 'ATRIBUIDO', responsavelId: joao.id, retornadoDe: null });
    const tl = detalharPacote(ctx, p('S3').id).timeline.map((e) => e.descricao);
    expect(tl.some((d) => /Novo dia \(23\/09\): não entregue — voltou para a caixa como Retornado do dia 23\/09/.test(d))).toBe(true);
  });

  it('5. carga montada que nem saiu é desfeita: os pacotes voltam à caixa e o ajudante fica livre', () => {
    const { ctx, hugo, ana, joao, p, caixa } = meioDoDia();
    confirmarImportacao(ctx, importar(ctx, [sampaio('SP1', 'Lia', '3', 0), sampaio('SP2', 'Davi', '5', 1)]), 'Galpão');
    const cJoao = atribuirRuas(ctx, { ajudanteId: joao.id, ruas: [`regiao:${caixa('2').id}`], ator: 'G', chave: 'j' }).carga;
    expect(previaNovoDia(ctx).totais).toMatchObject({ montadas: 1, pacotesMontados: 2 });
    const r = encerrarDia(ctx, { ator: 'G', chave: 'd1', historico: true, destinos: { [hugo.id]: 'amanha', [ana.id]: 'amanha' } });
    expect(p('SP1')).toMatchObject({ estado: 'NAO_ATRIBUIDO', responsavelId: null, cargaId: null });
    expect(r.dia.resumo.totais.desfeitas).toBe(2);
    expect(ctx.armazem.cargas.porId(cJoao.id)?.finalizadaEm).not.toBeNull();
    expect(ctx.armazem.cargas.ativaDoAjudante(joao.id)).toBeUndefined();
    expect(listarUnidades(ctx).find((u) => u.numero === '2')).toMatchObject({ total: 2, disponiveis: 2 });
  });

  it('6. "só memória" marca o dia como TESTE; a memória de caixas e pessoas fica igual', () => {
    const { ctx, hugo, ana, p } = meioDoDia();
    const antes = { ruas: ctx.armazem.regioes.associacoes().size, pessoas: ctx.armazem.pessoas.todas().size, caixas: ctx.armazem.regioes.listar().length };
    const r = encerrarDia(ctx, { ator: 'G', chave: 'd1', historico: false, destinos: { [hugo.id]: 'galpao', [ana.id]: 'galpao' } });
    expect(r.dia.historico).toBe(false);
    expect(detalharDia(ctx, r.dia.id).historico).toBe(false);
    expect({ ruas: ctx.armazem.regioes.associacoes().size, pessoas: ctx.armazem.pessoas.todas().size, caixas: ctx.armazem.regioes.listar().length }).toEqual(antes);
    const ev = ctx.armazem.eventos.doPacote(p('S3').id).find((e) => e.tipo === 'DIA_ENCERRADO')!;
    expect(ev.tipo === 'DIA_ENCERRADO' && ev.dados.historico).toBe(false);
    expect(p('S3').estado).toBe('DEVOLVIDO'); // o pacote continua no banco, só saiu da operação
  });

  it('7. tudo-ou-nada: faltando a escolha de um ajudante com sobras, NADA é gravado', () => {
    const { ctx, hugo, p } = meioDoDia();
    const e = erro(() => encerrarDia(ctx, { ator: 'G', chave: 'd1', historico: true, destinos: { [hugo.id]: 'amanha' } }));
    expect(e.codigo).toBe('FALTA_DESTINO');
    expect(e.message).toMatch(/Ana \(2\)/);
    expect(p('S3').estado).toBe('EM_ROTA');
    expect(ctx.armazem.cargas.idsAtivas().size).toBe(2);
    expect(listarDias(ctx)).toEqual([]);
  });

  it('8. clique repetido (mesma chave) não encerra duas vezes', () => {
    const { ctx, hugo, ana, p } = meioDoDia();
    const entrada = { ator: 'G', chave: 'd1', historico: true, destinos: { [hugo.id]: 'amanha' as const, [ana.id]: 'galpao' as const } };
    const a = encerrarDia(ctx, entrada);
    const b = encerrarDia(ctx, entrada);
    expect(b).toMatchObject({ jaEncerrado: true, dia: { id: a.dia.id } });
    expect(listarDias(ctx)).toHaveLength(1);
    expect(ctx.armazem.eventos.doPacote(p('S3').id).filter((e) => e.tipo === 'DIA_ENCERRADO')).toHaveLength(1);
  });

  it('9. sem carga aberta não há o que encerrar', () => {
    const ctx = contextoDeTeste();
    expect(erro(() => encerrarDia(ctx, { ator: 'G', chave: 'x', historico: true, destinos: {} })).codigo).toBe('NADA_A_ENCERRAR');
  });

  it('10. o histórico de dias é append-only (o banco recusa alterar ou apagar)', () => {
    const db = abrirBanco(':memory:');
    db.prepare("INSERT INTO dias (id, data_ref, encerrado_em, encerrado_por, historico, resumo, chave_idempotencia) VALUES ('d','2026-09-23','2026-09-23T13:00:00Z','G',1,'{}','k')").run();
    expect(() => db.prepare('UPDATE dias SET historico = 0').run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM dias').run()).toThrow(/append-only/);
  });

  it('11. evento atrasado do Street depois do Novo dia é recusado com o motivo claro', () => {
    const { ctx, hugo, ana, cHugo, p, street, entrega } = meioDoDia();
    encerrarDia(ctx, { ator: 'G', chave: 'd1', historico: true, destinos: { [hugo.id]: 'amanha', [ana.id]: 'galpao' } });
    const r = street(hugo, cHugo.id, [entrega(p('S3').id)]);
    expect(r).toMatchObject({ ok: true, aceitos: 0 });
    expect(r.ok && r.recusados[0].motivo).toMatch(/dia foi encerrado e o pacote voltou para a caixa como Retornado/);
  });
});

describe('Street visto (quem está ativo mas nunca conectou)', () => {
  it('12. o HUB sabe quando o Street de cada perfil apareceu; quem nunca conectou fica "nunca"', () => {
    const { ctx, joao } = meioDoDia();
    const visto = () => listarPerfis(ctx).find((x) => x.ajudante.id === joao.id)!.streetVistoEm;
    expect(visto()).toBeNull();
    cargasDoPerfil(ctx, joao.id);
    const primeiro = visto();
    expect(primeiro).toBe(ctx.relogio.agora());
    ctx.avancar(0.1); // 6 s depois: não regrava a cada 15 s
    cargasDoPerfil(ctx, joao.id);
    expect(visto()).toBe(primeiro);
    ctx.avancar(1);
    cargasDoPerfil(ctx, joao.id);
    expect(visto()).toBe(ctx.relogio.agora());
  });
});

describe('Repasse na hora', () => {
  it('13. lista as caixas com pendência e repassa a rota: carga NOVA do João, já em rota; o entregue fica com o Hugo', () => {
    const { ctx, hugo, joao, cHugo, p } = meioDoDia();
    const pend = pendenciasDaRota(ctx, cHugo.id);
    expect(pend.caixas.map((c) => [c.numero, c.pendentes])).toEqual([['1', 1], ['3', 2]]);
    expect(pend.totalPendentes).toBe(3);

    ctx.avancar(30);
    const r = repassarRota(ctx, { cargaId: cHugo.id, paraAjudanteId: joao.id, ator: 'Hugo', chave: 'r1', motivo: 'Hugo caiu da moto' });
    expect(r).toMatchObject({ pacotes: 3, jaFeito: false });
    expect(r.cargaNova).toMatchObject({ ajudante: { id: joao.id }, rotaIniciadaEm: ctx.relogio.agora(), finalizadaEm: null });
    for (const c of ['S3', 'G1', 'G2']) expect(p(c)).toMatchObject({ estado: 'EM_ROTA', responsavelId: joao.id, cargaId: r.cargaNova.id });
    expect(p('S1')).toMatchObject({ estado: 'ENTREGUE', responsavelId: hugo.id, cargaId: cHugo.id });
    expect(p('S2')).toMatchObject({ estado: 'INSUCESSO', responsavelId: hugo.id });
    expect(ctx.armazem.cargas.porId(cHugo.id)!.pacoteIds.sort()).toEqual([p('S1').id, p('S2').id].sort());
    expect(ctx.armazem.cargas.porId(r.cargaNova.id)!.pacoteIds).toHaveLength(3);
    // aviso na timeline do pacote e nas duas cargas
    expect(detalharPacote(ctx, p('S3').id).timeline.some((e) => /Repasse de rota: Hugo → João/.test(e.descricao))).toBe(true);
    const eventosHugo = ctx.armazem.cargas.eventos(cHugo.id).map((e) => e.tipo);
    expect(eventosHugo).toContain('ROTA_REPASSADA');
    expect(ctx.armazem.cargas.eventos(r.cargaNova.id).map((e) => e.tipo)).toEqual(['CARGA_CRIADA', 'ROTA_INICIADA']);
  });

  it('14. o documento da carga avisa o Street dos dois lados ("Repasse do Hugo para João")', () => {
    const { ctx, cHugo, joao } = meioDoDia();
    const r = repassarRota(ctx, { cargaId: cHugo.id, paraAjudanteId: joao.id, ator: 'Hugo', chave: 'r1', motivo: 'acidente' });
    const doJoao = documentoDaCarga(ctx, r.cargaNova, ctx.relogio.agora());
    expect(doJoao.carga).toMatchObject({ situacao: 'EM_ROTA', repassada_de: { carga_codigo: cHugo.codigo, ajudante: { nome: 'Hugo' }, motivo: 'acidente', pacotes: 3 }, repassada_para: null });
    expect(doJoao.pacotes).toHaveLength(3);
    const doHugo = documentoDaCarga(ctx, ctx.armazem.cargas.porId(cHugo.id)!, ctx.relogio.agora());
    expect(doHugo.carga.repassada_para).toMatchObject({ carga_codigo: r.cargaNova.codigo, ajudante: { nome: 'João' }, pacotes: 3 });
    expect(doHugo.pacotes).toHaveLength(0); // nada pendente: o Street do Hugo tira as pendências da tela
    expect(cargasDoPerfil(ctx, joao.id)[0].carga.id).toBe(r.cargaNova.id);
  });

  it('15. os cards mostram o repasse (enviado / recebido)', () => {
    const { ctx, hugo, joao, cHugo } = meioDoDia();
    repassarRota(ctx, { cargaId: cHugo.id, paraAjudanteId: joao.id, ator: 'Hugo', chave: 'r1' });
    const perfis = listarPerfis(ctx);
    expect(perfis.find((x) => x.ajudante.id === hugo.id)!.repasse).toMatchObject({ sentido: 'enviado', com: 'João', pacotes: 3 });
    expect(perfis.find((x) => x.ajudante.id === joao.id)!.repasse).toMatchObject({ sentido: 'recebido', com: 'Hugo', pacotes: 3 });
    expect(perfis.find((x) => x.ajudante.id === joao.id)!.carga?.situacao).toBe('EM_ROTA');
  });

  it('16. repasse parcial: só as caixas escolhidas', () => {
    const { ctx, cHugo, joao, caixa, p } = meioDoDia();
    const r = repassarRota(ctx, { cargaId: cHugo.id, paraAjudanteId: joao.id, caixas: [`regiao:${caixa('3').id}`], ator: 'Hugo', chave: 'r1' });
    expect(r.pacotes).toBe(2);
    expect(r.caixas.map((c) => c.nome)).toEqual(['Rua General Gurjão']);
    expect(p('G1').responsavelId).toBe(joao.id);
    expect(p('S3')).toMatchObject({ estado: 'EM_ROTA', cargaId: cHugo.id }); // continua com o Hugo
  });

  it('17. recusas com motivo claro: inativo, já com carga aberta, mesmo ajudante, nada na rua', () => {
    const { ctx, hugo, ana, joao, cHugo } = meioDoDia();
    editarPerfil(ctx, joao.id, { nome: 'João', ativo: false });
    expect(erro(() => repassarRota(ctx, { cargaId: cHugo.id, paraAjudanteId: joao.id, ator: 'H', chave: 'a' })).codigo).toBe('AJUDANTE_INATIVO');
    editarPerfil(ctx, joao.id, { nome: 'João', ativo: true });
    const comCarga = erro(() => repassarRota(ctx, { cargaId: cHugo.id, paraAjudanteId: ana.id, ator: 'H', chave: 'b' }));
    expect(comCarga.codigo).toBe('DESTINO_COM_CARGA');
    expect(comCarga.message).toMatch(/Ana já tem a carga/);
    expect(erro(() => repassarRota(ctx, { cargaId: cHugo.id, paraAjudanteId: hugo.id, ator: 'H', chave: 'c' })).codigo).toBe('MESMO_AJUDANTE');
    repassarRota(ctx, { cargaId: cHugo.id, paraAjudanteId: joao.id, ator: 'H', chave: 'd' });
    const bia = criarPerfil(ctx, { nome: 'Bia' });
    expect(erro(() => repassarRota(ctx, { cargaId: cHugo.id, paraAjudanteId: bia.id, ator: 'H', chave: 'e' })).codigo).toBe('NADA_A_REPASSAR');
  });

  it('18. carga montada (que nem saiu) não se repassa na hora: usa Remover/Reatribuir', () => {
    const { ctx, joao, caixa } = meioDoDia();
    confirmarImportacao(ctx, importar(ctx, [sampaio('SP1', 'Lia', '3', 0)]), 'Galpão');
    const montada = atribuirRuas(ctx, { ajudanteId: joao.id, ruas: [`regiao:${caixa('2').id}`], ator: 'G', chave: 'j' }).carga;
    const bia = criarPerfil(ctx, { nome: 'Bia' });
    expect(erro(() => repassarRota(ctx, { cargaId: montada.id, paraAjudanteId: bia.id, ator: 'H', chave: 'x' })).codigo).toBe('CARGA_NAO_SAIU');
  });

  it('19. clique repetido (mesma chave) não cria outra carga', () => {
    const { ctx, cHugo, joao } = meioDoDia();
    const a = repassarRota(ctx, { cargaId: cHugo.id, paraAjudanteId: joao.id, ator: 'H', chave: 'r1' });
    const b = repassarRota(ctx, { cargaId: cHugo.id, paraAjudanteId: joao.id, ator: 'H', chave: 'r1' });
    expect(b).toMatchObject({ jaFeito: true, pacotes: 3 });
    expect(b.cargaNova.id).toBe(a.cargaNova.id);
    expect(ctx.armazem.cargas.listar().filter((c) => c.ajudante.id === joao.id)).toHaveLength(1);
  });

  it('20. depois do repasse: o João entrega normalmente; evento atrasado do Hugo é recusado ("repassado para João")', () => {
    const { ctx, hugo, joao, cHugo, p, street, entrega } = meioDoDia();
    const r = repassarRota(ctx, { cargaId: cHugo.id, paraAjudanteId: joao.id, ator: 'Hugo', chave: 'r1' });
    const atrasado = street(hugo, cHugo.id, [entrega(p('S3').id)]);
    expect(atrasado.ok && atrasado.aceitos).toBe(0);
    expect(atrasado.ok && atrasado.recusados[0].motivo).toMatch(/foi repassado para João/);
    const ok = street(joao, r.cargaNova.id, [entrega(p('S3').id)]);
    expect(ok).toMatchObject({ ok: true, aceitos: 1 });
    expect(p('S3')).toMatchObject({ estado: 'ENTREGUE', responsavelId: joao.id });
  });
});

describe('Street → HUB: o texto da entrega', () => {
  it('21. o texto que o ajudante copiou chega no evento de entrega e de insucesso, e a prova continua incompleta', () => {
    const { ctx, p } = meioDoDia();
    const ev = (id: string, tipo: string) => ctx.armazem.eventos.doPacote(id).find((e) => e.tipo === tipo)!;
    const entrega = ev(p('S1').id, 'ENTREGA_REGISTRADA');
    expect(entrega.tipo === 'ENTREGA_REGISTRADA' && entrega.dados.texto).toBe('📦 *Entrega realizada*\n*Cliente:* Maria');
    const insucesso = ev(p('S2').id, 'INSUCESSO_REGISTRADO');
    expect(insucesso.tipo === 'INSUCESSO_REGISTRADO' && insucesso.dados.texto).toBe('⚠️ Insucesso\nMorador ausente');
    expect(p('S1').confirmacaoEntrega?.status).toBe('INCOMPLETA');
    expect(podeFicarProntoParaBaixa(p('S1'))).toBe(false);
  });
});
