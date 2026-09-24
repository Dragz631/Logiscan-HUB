/**
 * Testes mínimos do primeiro vertical slice (lista combinada com o Hugo).
 * Rodam contra o SQLite real (em memória), passando pelos casos de uso.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detalharPacote, listarPacotes, resumoInventario } from '../src/application/consultas';
import {
  confirmarImportacao,
  decidirConflito,
  prepararImportacao,
  verLote,
} from '../src/application/importacao';
import { cadastrarAjudante, confirmarDestino, entregarAoAjudante } from '../src/application/operacao';
import type { Contexto } from '../src/application/portas';
import { lerDocumentoImport } from '../src/contracts/importV0';
import { reconstruir } from '../src/domain/eventos';
import { contextoDeTeste, documento, pacote } from './ajuda';

function importar(ctx: Contexto, conteudo: string, arquivo = 'lote.json') {
  const r = prepararImportacao(ctx, { arquivo, conteudo });
  if (!r.ok) throw new Error(r.erros.join('; '));
  return r;
}

function importarEConfirmar(ctx: Contexto, conteudo: string, arquivo = 'lote.json') {
  const r = importar(ctx, conteudo, arquivo);
  return { ...confirmarImportacao(ctx, r.loteId, 'Hugo'), loteId: r.loteId };
}

describe('contrato logiscan.import/v0', () => {
  it('JSON válido é aceito', () => {
    const r = lerDocumentoImport(documento([pacote({ tracking_code: 'A' })]));
    expect(r.ok).toBe(true);
  });

  it('arquivo que não é JSON é recusado com motivo', () => {
    const r = lerDocumentoImport('{ isso não é json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros[0]).toMatch(/não é um JSON válido/);
  });

  it('schema diferente é recusado', () => {
    const r = lerDocumentoImport(JSON.stringify({ schema: 'outra.coisa/v9', packages: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros[0]).toMatch(/schema não suportado/);
  });

  it('campo com tipo errado reprova o documento inteiro e aponta o caminho', () => {
    const r = lerDocumentoImport(documento([pacote({}), { ...pacote({}), tracking_code: 123 }]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.join('\n')).toContain('packages.1.tracking_code');
  });

  it('JSON inválido não grava nada no HUB', () => {
    const ctx = contextoDeTeste();
    const r = prepararImportacao(ctx, { arquivo: 'x.json', conteudo: '[]' });
    expect(r.ok).toBe(false);
    expect(ctx.armazem.lotes.listar()).toHaveLength(0);
  });
});

describe('prévia da importação', () => {
  it('pacote sem código não entra no inventário e aparece na prévia', () => {
    const ctx = contextoDeTeste();
    const { loteId } = importar(ctx, documento([pacote({ tracking_code: '' }), pacote({ tracking_code: 'A' }, 1)]));
    const v = verLote(ctx, loteId);
    expect(v.itens[0].classe).toBe('SEM_CODIGO');
    expect(v.itens[0].origem).toEqual({ arquivo: 'IMG_0001.PNG', card: 0 });
    expect(v.resumo.entram).toBe(1);
    confirmarImportacao(ctx, loteId, 'Hugo');
    expect(ctx.armazem.pacotes.listar().map((p) => p.codigo)).toEqual(['A']);
  });

  it('revisão ainda aberta no extractor não entra (revisar lá e reimportar)', () => {
    const ctx = contextoDeTeste();
    const revisao = [{ reason: 'campo ausente: número', code: 'NUMBER_MISSING', field: 'number' }];
    const { loteId } = importar(ctx, documento([pacote({ tracking_code: 'A', review_items: revisao })]));
    const v = verLote(ctx, loteId);
    expect(v.itens[0].classe).toBe('REVISAO_EXTRACTOR');
    expect(v.itens[0].motivos).toEqual(['campo ausente: número']);
    expect(v.resumo.entram).toBe(0);
  });

  it('pacote válido não exige revisão', () => {
    const ctx = contextoDeTeste();
    const { loteId } = importar(ctx, documento([pacote({ tracking_code: 'A' })]));
    const v = verLote(ctx, loteId);
    expect(v.itens[0]).toMatchObject({ classe: 'PRONTO', entra: true, precisaDecisao: false });
  });

  it('duplicidade no arquivo: repetição idêntica conta uma vez', () => {
    const ctx = contextoDeTeste();
    const { loteId } = importar(ctx, documento([pacote({ tracking_code: 'A' }), pacote({ tracking_code: ' a ' }, 1)]));
    expect(verLote(ctx, loteId).itens.map((i) => i.classe)).toEqual(['PRONTO', 'DUPLICADO_NO_ARQUIVO']);
    confirmarImportacao(ctx, loteId, 'Hugo');
    expect(ctx.armazem.pacotes.listar()).toHaveLength(1);
  });

  it('duplicidade no arquivo com dados diferentes: nenhum dos dois entra', () => {
    const ctx = contextoDeTeste();
    const { loteId } = importar(
      ctx,
      documento([pacote({ tracking_code: 'A', number: '100' }), pacote({ tracking_code: 'A', number: '200' }, 1)]),
    );
    expect(verLote(ctx, loteId).itens.map((i) => i.classe)).toEqual(['CONFLITO_NO_ARQUIVO', 'CONFLITO_NO_ARQUIVO']);
    confirmarImportacao(ctx, loteId, 'Hugo');
    expect(ctx.armazem.pacotes.listar()).toHaveLength(0);
  });
});

describe('importação confirmada e reimportação', () => {
  it('confirmação persiste os pacotes, NAO_ATRIBUIDO, com evento IMPORTADO e origem', () => {
    const ctx = contextoDeTeste();
    const r = importarEConfirmar(ctx, documento([pacote({ tracking_code: 'A' }), pacote({ tracking_code: 'B' }, 1)]));
    expect(r.criados).toBe(2);
    const [a] = listarPacotes(ctx, { busca: 'A' });
    expect(a).toMatchObject({ estado: 'NAO_ATRIBUIDO', responsavelId: null, transportadora: 'jtexpress' });
    expect(a.origem).toEqual({ loteId: r.loteId, arquivo: 'IMG_0001.PNG', card: 0 });
    const d = detalharPacote(ctx, a.id);
    expect(d.timeline.map((e) => e.tipo)).toEqual(['IMPORTADO']);
    expect(d.timeline[0].descricao).toMatch(/Importado da jtexpress \(IMG_0001.PNG, card 1\)/);
    expect(verLote(ctx, r.loteId).lote.status).toBe('CONFIRMADO');
  });

  it('confirmar o mesmo lote duas vezes não cria nada de novo', () => {
    const ctx = contextoDeTeste();
    const r = importarEConfirmar(ctx, documento([pacote({ tracking_code: 'A' })]));
    const de_novo = confirmarImportacao(ctx, r.loteId, 'Hugo');
    expect(de_novo.jaConfirmado).toBe(true);
    expect(ctx.armazem.pacotes.listar()).toHaveLength(1);
    expect(ctx.armazem.eventos.doPacote(ctx.armazem.pacotes.listar()[0].id)).toHaveLength(1);
  });

  it('o mesmo arquivo de novo cai no lote já recebido', () => {
    const ctx = contextoDeTeste();
    const conteudo = documento([pacote({ tracking_code: 'A' })]);
    const r1 = importarEConfirmar(ctx, conteudo);
    const r2 = importar(ctx, conteudo, 'copia.json');
    expect(r2).toEqual({ ok: true, loteId: r1.loteId, jaRecebido: true });
  });

  it('reimportação do mesmo pacote em outro arquivo não duplica (JA_EXISTE)', () => {
    const ctx = contextoDeTeste();
    importarEConfirmar(ctx, documento([pacote({ tracking_code: 'A' })]));
    // outro arquivo: mesmo pacote (outro print) + um novo; maiúsculas/acentos não são conflito
    const r = importar(
      ctx,
      documento([pacote({ tracking_code: 'A', recipient_name: 'JOAO' }, 3), pacote({ tracking_code: 'B' })], {
        generated_at: 'outro',
      }),
    );
    expect(verLote(ctx, r.loteId).itens.map((i) => i.classe)).toEqual(['JA_EXISTE', 'PRONTO']);
    const c = confirmarImportacao(ctx, r.loteId, 'Hugo');
    expect(c.criados).toBe(1);
    expect(ctx.armazem.pacotes.listar()).toHaveLength(2);
  });
});

describe('conflito de dados', () => {
  function cenario() {
    const ctx = contextoDeTeste();
    importarEConfirmar(ctx, documento([pacote({ tracking_code: 'A', number: '100' })]));
    const r = importar(ctx, documento([pacote({ tracking_code: 'A', number: '180' })]), 'segundo.json');
    return { ctx, loteId: r.loteId };
  }

  it('mostra o conflito com antes/depois e NÃO sobrescreve sozinho', () => {
    const { ctx, loteId } = cenario();
    const [item] = verLote(ctx, loteId).itens;
    expect(item.classe).toBe('CONFLITO');
    expect(item.diferencas).toEqual([{ campo: 'numero', atual: '100', novo: '180' }]);
    expect(() => confirmarImportacao(ctx, loteId, 'Hugo')).toThrow(/conflito\(s\) sem decisão/);
    expect(ctx.armazem.pacotes.listar()[0].dados.numero).toBe('100');
  });

  it('manter atual: dados ficam, a divergência fica registrada no histórico', () => {
    const { ctx, loteId } = cenario();
    decidirConflito(ctx, loteId, 0, 'manter_atual');
    confirmarImportacao(ctx, loteId, 'Hugo');
    const [p] = ctx.armazem.pacotes.listar();
    expect(p.dados.numero).toBe('100');
    expect(detalharPacote(ctx, p.id).timeline.map((e) => e.tipo)).toEqual(['IMPORTADO', 'CONFLITO_RESOLVIDO']);
  });

  it('aceitar novo: dados mudam, o antes fica guardado no evento', () => {
    const { ctx, loteId } = cenario();
    decidirConflito(ctx, loteId, 0, 'aceitar_novo');
    confirmarImportacao(ctx, loteId, 'Hugo');
    const [p] = ctx.armazem.pacotes.listar();
    expect(p.dados.numero).toBe('180');
    expect(p.destinoId).toBe('rua x|180|');
    const ev = detalharPacote(ctx, p.id).timeline[1];
    expect(ev.tipo === 'CONFLITO_RESOLVIDO' && ev.dados.antes.numero).toBe('100');
  });
});

describe('entrega ao ajudante (atribuição / reatribuição)', () => {
  function cenario() {
    const ctx = contextoDeTeste();
    importarEConfirmar(ctx, documento([pacote({ tracking_code: 'A' }), pacote({ tracking_code: 'B' }, 1)]));
    const hugo = cadastrarAjudante(ctx, 'Hugo');
    const ana = cadastrarAjudante(ctx, 'Ana');
    const [a, b] = ctx.armazem.pacotes.listar();
    return { ctx, hugo, ana, a, b };
  }

  it('atribuição: pacote passa a estar com o ajudante e gera evento ATRIBUIDO', () => {
    const { ctx, hugo, a } = cenario();
    const r = entregarAoAjudante(ctx, { pacoteIds: [a.id], ajudanteId: hugo.id, ator: 'Hugo', chave: 'c1' });
    expect(r[0].resultado).toBe('ATRIBUIDO');
    const d = detalharPacote(ctx, a.id);
    expect(d.pacote.estado).toBe('ATRIBUIDO');
    expect(d.responsavel?.nome).toBe('Hugo');
    expect(d.timeline[1]).toMatchObject({ tipo: 'ATRIBUIDO', dados: { ajudante: { id: hugo.id } } });
  });

  it('reatribuição: guarda antigo e novo; histórico permanece', () => {
    const { ctx, hugo, ana, a } = cenario();
    entregarAoAjudante(ctx, { pacoteIds: [a.id], ajudanteId: hugo.id, ator: 'Hugo', chave: 'c1' });
    const r = entregarAoAjudante(ctx, { pacoteIds: [a.id], ajudanteId: ana.id, ator: 'Hugo', chave: 'c2' });
    expect(r[0].resultado).toBe('REATRIBUIDO');
    const d = detalharPacote(ctx, a.id);
    expect(d.responsavel?.nome).toBe('Ana');
    expect(d.timeline.map((e) => e.tipo)).toEqual(['IMPORTADO', 'ATRIBUIDO', 'REATRIBUIDO']);
    expect(d.timeline[2]).toMatchObject({ dados: { de: { id: hugo.id, nome: 'Hugo' }, para: { id: ana.id, nome: 'Ana' } } });
  });

  it('retry da mesma ação (mesma chave) não gera dois eventos', () => {
    const { ctx, hugo, a } = cenario();
    entregarAoAjudante(ctx, { pacoteIds: [a.id], ajudanteId: hugo.id, ator: 'Hugo', chave: 'c1' });
    const r = entregarAoAjudante(ctx, { pacoteIds: [a.id], ajudanteId: hugo.id, ator: 'Hugo', chave: 'c1' });
    expect(r[0].resultado).toBe('REPETIDO');
    expect(ctx.armazem.eventos.doPacote(a.id)).toHaveLength(2);
  });

  it('inventário responde quantos sem responsável e quantos com cada ajudante', () => {
    const { ctx, hugo, a } = cenario();
    entregarAoAjudante(ctx, { pacoteIds: [a.id], ajudanteId: hugo.id, ator: 'Hugo', chave: 'c1' });
    const r = resumoInventario(ctx);
    expect(r).toMatchObject({ total: 2, semResponsavel: 1, revisaoPendente: 0 });
    expect(r.porAjudante.find((x) => x.ajudante.id === hugo.id)?.quantidade).toBe(1);
    expect(listarPacotes(ctx, { semResponsavel: true })).toHaveLength(1);
  });
});

describe('histórico', () => {
  it('é append-only no banco: UPDATE e DELETE são recusados', () => {
    const ctx = contextoDeTeste();
    importarEConfirmar(ctx, documento([pacote({ tracking_code: 'A' })]));
    // acesso direto ao banco, simulando um erro de programação
    const db = (ctx.armazem.eventos as unknown as { db: import('node:sqlite').DatabaseSync }).db;
    expect(() => db.exec("UPDATE eventos SET ator = 'outro'")).toThrow(/append-only/);
    expect(() => db.exec('DELETE FROM eventos')).toThrow(/append-only/);
  });

  it('o estado atual é reconstruível a partir dos eventos', () => {
    const ctx = contextoDeTeste();
    importarEConfirmar(ctx, documento([pacote({ tracking_code: 'A' })]));
    const hugo = cadastrarAjudante(ctx, 'Hugo');
    const ana = cadastrarAjudante(ctx, 'Ana');
    const [a] = ctx.armazem.pacotes.listar();
    entregarAoAjudante(ctx, { pacoteIds: [a.id], ajudanteId: hugo.id, ator: 'Hugo', chave: '1' });
    entregarAoAjudante(ctx, { pacoteIds: [a.id], ajudanteId: ana.id, ator: 'Hugo', chave: '2' });
    expect(reconstruir(ctx.armazem.eventos.doPacote(a.id))).toEqual(ctx.armazem.pacotes.porId(a.id));
  });
});

describe('identidade do pacote e destino', () => {
  it('mesmo endereço e nome, códigos diferentes → dois pacotes, mesmo destino', () => {
    const ctx = contextoDeTeste();
    importarEConfirmar(ctx, documento([pacote({ tracking_code: 'A' }), pacote({ tracking_code: 'B' }, 1)]));
    const lista = ctx.armazem.pacotes.listar();
    expect(lista.map((p) => p.codigo)).toEqual(['A', 'B']);
    expect(new Set(lista.map((p) => p.id)).size).toBe(2);
    expect(lista[0].destinoId).toBe(lista[1].destinoId);
    expect(detalharPacote(ctx, lista[0].id).mesmoDestino.map((p) => p.codigo)).toEqual(['B']);
  });

  it('dois destinos diferentes no mesmo número (Loja ABC × Condomínio XYZ)', () => {
    const ctx = contextoDeTeste();
    importarEConfirmar(
      ctx,
      documento([
        pacote({ tracking_code: 'A', complement: 'Loja ABC' }),
        pacote({ tracking_code: 'B', complement: 'Condomínio XYZ Apto 101' }, 1),
      ]),
    );
    const [a, b] = ctx.armazem.pacotes.listar().sort((x, y) => x.codigo.localeCompare(y.codigo));
    expect(a.destinoId).toBe('rua x|100|comercio:loja abc');
    expect(b.destinoId).toBe('rua x|100|condominio:xyz');
    expect(a.pendencias).toEqual([]);
  });

  it('número sem contexto diante de dois destinos nomeados → não chuta: pede confirmação', () => {
    const ctx = contextoDeTeste();
    importarEConfirmar(
      ctx,
      documento([
        pacote({ tracking_code: 'A', complement: 'Loja ABC' }),
        pacote({ tracking_code: 'B', complement: 'Condomínio XYZ' }, 1),
      ]),
    );
    importarEConfirmar(ctx, documento([pacote({ tracking_code: 'C' })]), 'segundo.json');
    const c = ctx.armazem.pacotes.porChave('jtexpress', 'C')!;
    expect(c.destinoId).toBeNull();
    expect(c.pendencias).toEqual(['DESTINO_A_CONFIRMAR']);
    expect(c.destinoCandidatos.sort()).toEqual(['rua x|100|comercio:loja abc', 'rua x|100|condominio:xyz']);
    expect(resumoInventario(ctx).revisaoPendente).toBe(1);

    confirmarDestino(ctx, { pacoteId: c.id, destinoId: 'rua x|100|comercio:loja abc', ator: 'Hugo', chave: 'd1' });
    const depois = ctx.armazem.pacotes.porId(c.id)!;
    expect(depois).toMatchObject({ destinoId: 'rua x|100|comercio:loja abc', pendencias: [] });
    expect(detalharPacote(ctx, c.id).timeline.map((e) => e.tipo)).toEqual(['IMPORTADO', 'DESTINO_CONFIRMADO']);
  });
});

// Documento REAL gerado pelo JT-Extractor (lido da pasta vizinha, só se existir; nada é copiado).
const REAL = '../JT-Extractor/saida/jt_import.json';
describe.skipIf(!existsSync(REAL))('contrato real do JT-Extractor', () => {
  it('valida, classifica e importa sem perder nenhum pacote', () => {
    const ctx = contextoDeTeste();
    const conteudo = readFileSync(REAL, 'utf8');
    const bruto = JSON.parse(conteudo) as { packages: { tracking_code: string; review_items: unknown[] }[] };
    const { loteId } = importar(ctx, conteudo, 'jt_import.json');
    const v = verLote(ctx, loteId);
    expect(v.resumo.total).toBe(bruto.packages.length);
    const esperadosProntos = bruto.packages.filter((p) => p.tracking_code && p.review_items.length === 0).length;
    expect(v.resumo.entram).toBe(esperadosProntos);
    const r = confirmarImportacao(ctx, loteId, 'Hugo');
    expect(r.criados).toBe(esperadosProntos);
    expect(r.criados + r.naoEntraram).toBe(bruto.packages.length);
  });
});
