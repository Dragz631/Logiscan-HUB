/**
 * V0.5 — o HUB como a mesa de triagem do Hugo: CAIXAS oficiais, memória por PESSOA (nome + rua),
 * CEP tirando dúvida de digitação, triagem do que não sabe e repasse por caixa.
 * Casos tirados do lote real de 29/09 (270 pacotes).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { documentoDaCarga, iniciarRota } from '../src/application/cargas';
import { detalharPacote } from '../src/application/consultas';
import { confirmarImportacao, prepararImportacao } from '../src/application/importacao';
import { atribuirRuas, criarPerfil, listarUnidades } from '../src/application/orquestracao';
import type { Contexto } from '../src/application/portas';
import { aplicarConhecimentoInicial, criarRegiao, definirRegiao, mapaDeRegioes, resolvedorDeCaixa } from '../src/application/regioes';
import { classificarPacote, classificarRua, pacotesDaCaixa, visaoTriagem } from '../src/application/triagem';
import { reconstruir } from '../src/domain/eventos';
import { contextoDeTeste, documento, pacote } from './ajuda';

const CATALOGO = JSON.parse(readFileSync('src/infrastructure/conhecimento/conhecimento-inicial.json', 'utf8'));

let lote = 0;
function importar(ctx: Contexto, pacotes: Record<string, unknown>[]) {
  const r = prepararImportacao(ctx, { arquivo: `lote-${++lote}.json`, conteudo: documento(pacotes, { generated_at: `g${lote}` }) });
  if (!r.ok) throw new Error('import');
  confirmarImportacao(ctx, r.loteId, 'Galpão');
}

/** Dia 1 de operação com o catálogo de caixas do Hugo. */
function dia1() {
  const ctx = contextoDeTeste();
  aplicarConhecimentoInicial(ctx, CATALOGO);
  importar(ctx, [
    pacote({ tracking_code: 'S1', recipient_name: 'Mariana Alves', street: 'Rua Carlos Seidl', number: '16', cep: '20931002' }, 0),
    pacote({ tracking_code: 'S2', recipient_name: 'João Souza', street: 'RUA CARLOS SEIDL', number: '30', cep: '20931002' }, 1),
    pacote({ tracking_code: 'SI', recipient_name: 'Pedro Lima', street: 'Rua Carlos Seidi', number: '40', cep: '20931002' }, 2),
    pacote({ tracking_code: 'SX', recipient_name: 'Ana Paula', street: 'Rua Carlos Seixas', number: '3', cep: '20931007' }, 3),
    pacote({ tracking_code: 'LP', recipient_name: 'Carla Dias', street: 'Rua Luiz Pimenta', number: '25', cep: '20931004' }, 4),
    pacote({ tracking_code: 'M1', recipient_name: 'Rita Gomes', street: 'Rua Monsenhor Manoel Gomes', number: '10', cep: '20931670' }, 5),
    pacote({ tracking_code: 'M2', recipient_name: 'Luiz Neto', street: 'Rua Monsenhor Manuel Gomes', number: '12', cep: '20931670' }, 6),
    pacote({ tracking_code: 'PL', recipient_name: 'Hugo', street: 'Rua Peter Lund', number: '5', cep: '20930390' }, 7),
    pacote({ tracking_code: 'RB', recipient_name: 'Zé', street: 'Rua Leão XIII', number: '24', complement: 'Rua B casa 5', cep: '20931030' }, 8),
    pacote({ tracking_code: 'PA', recipient_name: 'Bia', street: 'Rua Paraíso', number: '1', cep: '20920460' }, 9),
  ]);
  const hugo = criarPerfil(ctx, { nome: 'Hugo' });
  const ana = criarPerfil(ctx, { nome: 'Ana' });
  return { ctx, hugo, ana, caixa: (numero: string) => ctx.armazem.regioes.listar().find((r) => r.numero === numero)! };
}

const porCodigo = (ctx: Contexto, codigo: string) => ctx.armazem.pacotes.porChave('jtexpress', codigo)!;
const caixaDo = (ctx: Contexto, codigo: string) => resolvedorDeCaixa(ctx)(porCodigo(ctx, codigo));

describe('caixas do Hugo e o que o HUB sabe sozinho', () => {
  it('rua explícita no catálogo → vai sozinha para a caixa (caixa 1, 1.2, 8 com a rua operacional)', () => {
    const { ctx } = dia1();
    expect(caixaDo(ctx, 'S1')).toMatchObject({ caixa: { numero: '1' }, origem: 'rua' });
    expect(caixaDo(ctx, 'S2')).toMatchObject({ caixa: { numero: '1' } }); // caixa alta = mesma rua
    expect(caixaDo(ctx, 'PL')).toMatchObject({ caixa: { numero: '1.2', nome: 'Rua Peter Lund' } });
    expect(caixaDo(ctx, 'RB')).toMatchObject({ caixa: { numero: '8' }, rua: { nome: 'Rua B' } });
  });

  it('CEP tira dúvida de digitação: "Seidi" e "Manuel" com o mesmo CEP entram na caixa certa', () => {
    const { ctx } = dia1();
    expect(caixaDo(ctx, 'SI')).toMatchObject({ caixa: { numero: '1' }, rua: { nome: 'Rua Carlos Seidl' } });
    expect(caixaDo(ctx, 'M2')).toMatchObject({ caixa: { numero: '6', nome: 'Rua Monsenhor Manoel Gomes' }, rua: { nome: 'Rua Monsenhor Manoel Gomes' } });
  });

  it('CEP sozinho não junta: Luiz Pimenta (mesmo CEP da Seidl) e Seixas (CEP diferente) vão para a triagem', () => {
    const { ctx } = dia1();
    expect(caixaDo(ctx, 'LP').caixa).toBeNull();
    expect(caixaDo(ctx, 'SX').caixa).toBeNull();
    const t = visaoTriagem(ctx);
    expect(t.semCaixa.map((g) => g.ruaNome).sort()).toEqual(['Rua Carlos Seixas', 'Rua Luiz Pimenta', 'Rua Paraíso']);
    expect(t).toMatchObject({ totalPacotes: 10, nasCaixas: 7, aguardandoRevisao: 3 });
  });

  it('sem caixa não vai para ajudante (espera a revisão do Hugo)', () => {
    const { ctx, hugo } = dia1();
    expect(() => atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['sem:rua paraiso'], ator: 'G', chave: 'a' })).toThrow(/triagem/);
    expect(() => atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: ['Rua Paraíso'], ator: 'G', chave: 'b' })).toThrow(/triagem/);
    expect(porCodigo(ctx, 'PA').responsavelId).toBeNull();
  });
});

describe('triagem: o Hugo diz a caixa e o HUB lembra', () => {
  it('rua → caixa: todos os pacotes dela entram; no dia seguinte é automático', () => {
    const { ctx, caixa } = dia1();
    expect(classificarRua(ctx, { rua: 'Rua Paraíso', caixaId: caixa('11').id, ator: 'Hugo' })).toEqual({ ok: true, mudou: true });
    expect(caixaDo(ctx, 'PA')).toMatchObject({ caixa: { nome: 'Fora & Diversos' }, origem: 'rua' });
    importar(ctx, [pacote({ tracking_code: 'PA2', recipient_name: 'Outro', street: 'RUA PARAISO', number: '9', cep: '20920460' })]);
    expect(caixaDo(ctx, 'PA2').caixa?.numero).toBe('11');
  });

  it('pessoa vence a rua: Mariana (Carlos Seidl) vai na Associação; amanhã ela vai sozinha, os vizinhos não', () => {
    const { ctx, caixa } = dia1();
    const chatuba = caixa('10.1');
    expect(classificarPacote(ctx, { pacoteId: porCodigo(ctx, 'S1').id, caixaId: chatuba.id, ator: 'Hugo' })).toEqual({ ok: true, mudou: true });
    expect(caixaDo(ctx, 'S1')).toMatchObject({ caixa: { nome: 'Associação da Chatuba' }, origem: 'manual' });
    expect(caixaDo(ctx, 'S2').caixa?.numero).toBe('1'); // vizinho na mesma rua continua na caixa 1
    importar(ctx, [
      pacote({ tracking_code: 'S1B', recipient_name: 'MARIANA ALVES', street: 'Rua Carlos Seidl', number: '16', cep: '20931002' }),
      pacote({ tracking_code: 'S1C', recipient_name: 'Mariana Alves', street: 'Rua General Sampaio', number: '8', cep: '20931350' }),
    ]);
    expect(caixaDo(ctx, 'S1B')).toMatchObject({ caixa: { nome: 'Associação da Chatuba' }, origem: 'pessoa' });
    // mesmo nome em OUTRA rua: não é "a mesma pessoa" para a memória → segue a rua
    expect(caixaDo(ctx, 'S1C')).toMatchObject({ caixa: { numero: '2' }, origem: 'rua' });
  });

  it('mudar a caixa de uma pessoa já lembrada é conflito: só com confirmação (e fica no histórico)', () => {
    const { ctx, caixa } = dia1();
    classificarPacote(ctx, { pacoteId: porCodigo(ctx, 'S1').id, caixaId: caixa('10.1').id, ator: 'Hugo' });
    importar(ctx, [pacote({ tracking_code: 'S1B', recipient_name: 'Mariana Alves', street: 'Rua Carlos Seidl', number: '16', cep: '20931002' })]);
    const r = classificarPacote(ctx, { pacoteId: porCodigo(ctx, 'S1B').id, caixaId: caixa('10.2').id, ator: 'Hugo' });
    expect(r).toMatchObject({ ok: false, conflito: { pessoa: 'Mariana Alves', atual: { numero: '10.1' } } });
    expect(classificarPacote(ctx, { pacoteId: porCodigo(ctx, 'S1B').id, caixaId: caixa('10.2').id, ator: 'Hugo', substituir: true })).toEqual({ ok: true, mudou: true });
    const chave = resolvedorDeCaixa(ctx)(porCodigo(ctx, 'S1B')).pessoa;
    expect(ctx.armazem.pessoas.eventos(chave).map((e) => [e.dados.de, e.dados.para])).toEqual([
      [null, caixa('10.1').id],
      [caixa('10.1').id, caixa('10.2').id],
    ]);
  });

  it('caixa que só agrupa (Associações) não recebe pacote direto', () => {
    const { ctx, caixa } = dia1();
    expect(() => classificarPacote(ctx, { pacoteId: porCodigo(ctx, 'S1').id, caixaId: caixa('10').id, ator: 'Hugo' })).toThrow(/escolha uma delas/);
  });

  it('CAIXA_DEFINIDA fica na timeline, é reconstruível, e não muda depois que o pacote saiu', () => {
    const { ctx, hugo, caixa } = dia1();
    const s1 = porCodigo(ctx, 'S1');
    classificarPacote(ctx, { pacoteId: s1.id, caixaId: caixa('10.1').id, ator: 'Hugo', motivo: 'entregue na associação' });
    const t = detalharPacote(ctx, s1.id).timeline.find((e) => e.tipo === 'CAIXA_DEFINIDA')!;
    expect(t.descricao).toBe('Triagem: colocado na caixa 10.1 · Associação da Chatuba (estava em 1 · Rua Carlos Seidl) — entregue na associação');
    expect(reconstruir(ctx.armazem.eventos.doPacote(s1.id))).toEqual(porCodigo(ctx, 'S1'));
    atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: [`regiao:${caixa('10.1').id}`], ator: 'G', chave: 'a' });
    expect(() => classificarPacote(ctx, { pacoteId: s1.id, caixaId: caixa('1').id, ator: 'Hugo' })).toThrow(/só muda na triagem/);
  });

  it('a mesa mostra o que tem dentro de cada caixa', () => {
    const { ctx, caixa } = dia1();
    expect(pacotesDaCaixa(ctx, caixa('1').id).map((p) => p.codigo).sort()).toEqual(['S1', 'S2', 'SI']);
    expect(pacotesDaCaixa(ctx, caixa('1').id).every((p) => p.origem === 'rua' && p.podeMover)).toBe(true);
  });
});

describe('repasse por caixa e a prova de em qual caixa saiu', () => {
  it('a caixa vai INTEIRA; Associações inteira leva as sub-caixas com pacote', () => {
    const { ctx, hugo, ana, caixa } = dia1();
    classificarPacote(ctx, { pacoteId: porCodigo(ctx, 'S1').id, caixaId: caixa('10.1').id, ator: 'Hugo' });
    classificarRua(ctx, { rua: 'Rua Luiz Pimenta', caixaId: caixa('10.2').id, ator: 'Hugo' });
    const u = listarUnidades(ctx).find((x) => x.numero === '10')!;
    expect(u).toMatchObject({ tipo: 'grupo', total: 2 });
    expect(u.subcaixas.map((s) => s.numero)).toEqual(['10.1', '10.2']);
    const r = atribuirRuas(ctx, { ajudanteId: ana.id, ruas: [u.chave], ator: 'G', chave: 'a' });
    expect(r.ruas.map((x) => x.nome)).toEqual(['Associação da Chatuba', 'Associação São Sebastião']);
    const c1 = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: [`regiao:${caixa('1').id}`], ator: 'G', chave: 'b' });
    expect(c1.pacotes).toBe(2); // S2 e SI (digitação) — a S1 foi para a associação
    expect(listarUnidades(ctx).map((x) => x.numero)).toEqual(['1', '1.2', '6', '8', '10']); // em ordem de caixa
  });

  it('INCLUIDO_EM_CARGA registra a caixa; a carga leva a caixa (com o nome antigo, para o Street achar o card)', () => {
    const ctx = contextoDeTeste();
    const antiga = criarRegiao(ctx, 'Rua Monsenhor Manuel Gomes', 'Hugo'); // região que o Hugo criou antes das caixas
    definirRegiao(ctx, { rua: 'Rua Monsenhor Manuel Gomes', regiaoId: antiga.id, ator: 'Hugo' });
    aplicarConhecimentoInicial(ctx, CATALOGO);
    expect(mapaDeRegioes(ctx).regioes.filter((r) => /Monsenhor/.test(r.nome)).map((r) => [r.id, r.numero, r.nome])).toEqual([
      [antiga.id, '6', 'Rua Monsenhor Manoel Gomes'],
    ]);
    importar(ctx, [pacote({ tracking_code: 'M1', recipient_name: 'Rita', street: 'Rua Monsenhor Manoel Gomes', number: '10', cep: '20931670' })]);
    const hugo = criarPerfil(ctx, { nome: 'Hugo' });
    const r = atribuirRuas(ctx, { ajudanteId: hugo.id, ruas: [`regiao:${antiga.id}`], ator: 'G', chave: 'a' });
    const inc = ctx.armazem.eventos.doPacote(porCodigo(ctx, 'M1').id).find((e) => e.tipo === 'INCLUIDO_EM_CARGA')!;
    expect(inc.tipo === 'INCLUIDO_EM_CARGA' && inc.dados.caixa).toEqual({ id: antiga.id, numero: '6', nome: 'Rua Monsenhor Manoel Gomes' });
    iniciarRota(ctx, r.carga.id, 'G');
    const doc = documentoDaCarga(ctx, ctx.armazem.cargas.porId(r.carga.id)!, ctx.relogio.agora());
    expect(doc.pacotes[0].caixa).toEqual({ id: antiga.id, numero: '6', nome: 'Rua Monsenhor Manoel Gomes', pai: null, nomes_anteriores: ['Rua Monsenhor Manuel Gomes'] });
    expect(doc.itens![0].caixa?.numero).toBe('6');
    expect(detalharPacote(ctx, porCodigo(ctx, 'M1').id).timeline.find((e) => e.tipo === 'INCLUIDO_EM_CARGA')?.descricao).toMatch(/saiu na caixa 6 · Rua Monsenhor Manoel Gomes/);
  });

  it('catálogo absorve as regiões antigas sem duplicar e é idempotente', () => {
    const ctx = contextoDeTeste();
    const diversos = criarRegiao(ctx, 'Diversos', 'Hugo', true);
    const quinta = criarRegiao(ctx, 'Quinta do caju', 'Hugo');
    const r1 = aplicarConhecimentoInicial(ctx, CATALOGO);
    expect(ctx.armazem.regioes.porId(diversos.id)).toMatchObject({ nome: 'Fora & Diversos', numero: '11' });
    expect(ctx.armazem.regioes.porId(quinta.id)).toMatchObject({ nome: 'Quinta do Caju', numero: '9' });
    expect(r1.regioesCriadas).not.toContain('Fora & Diversos');
    expect(ctx.armazem.regioes.listar()).toHaveLength(16);
    expect(aplicarConhecimentoInicial(ctx, CATALOGO)).toMatchObject({ regioesCriadas: [], ruasAssociadas: 0, caixasConfiguradas: [] });
  });
});
