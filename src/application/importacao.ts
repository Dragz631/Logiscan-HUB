/**
 * Casos de uso da importação: preparar (prévia) → decidir conflitos → confirmar.
 * Nada entra no inventário antes da confirmação.
 */
import { createHash } from 'node:crypto';
import { lerDocumentoImport, type DocumentoImportV0 } from '../contracts/importV0';
import { resolverDestinoDoPacote, destinoDoEndereco, type ResolucaoDestinoPacote } from '../domain/destinoPacote';
import {
  type DecisaoConflito,
  EFEITO_CLASSE,
  type ResumoPrevia,
  classificarLote,
  resumirPrevia,
} from '../domain/importacao';
import { type DadosPacote, chaveNatural, normalizarCodigo } from '../domain/pacote';
import { ErroAplicacao } from './erros';
import type { Contexto, ItemLote, Lote } from './portas';
import { registrarEvento } from './registrarEvento';

export type ResultadoPreparo =
  | { ok: true; loteId: string; jaRecebido: boolean }
  | { ok: false; erros: string[] };

export function prepararImportacao(ctx: Contexto, entrada: { arquivo: string; conteudo: string }): ResultadoPreparo {
  const validacao = lerDocumentoImport(entrada.conteudo);
  if (!validacao.ok) return { ok: false, erros: validacao.erros };
  const doc = validacao.documento;
  const sha256 = createHash('sha256').update(entrada.conteudo, 'utf8').digest('hex');
  const { armazem } = ctx;

  return armazem.transacao(() => {
    const mesmoArquivo = armazem.lotes.porSha256(sha256);
    if (mesmoArquivo && mesmoArquivo.status !== 'DESCARTADO') {
      return { ok: true as const, loteId: mesmoArquivo.id, jaRecebido: true };
    }
    const lote: Lote = {
      id: ctx.ids.novo(),
      arquivo: entrada.arquivo,
      sha256,
      schema: doc.schema,
      transportadora: doc.source,
      extractor: { nome: doc.extractor.name, versao: doc.extractor.version },
      geradoEm: doc.generated_at,
      recebidoEm: ctx.relogio.agora(),
      status: 'PREVIA',
      confirmadoEm: null,
      confirmadoPor: null,
      documento: doc,
    };
    const itens = classificar(ctx, doc).map((i) => ({ ...i, loteId: lote.id, decisao: null, pacoteId: null }));
    armazem.lotes.criar(lote, itens);
    return { ok: true as const, loteId: lote.id, jaRecebido: false };
  });
}

function classificar(ctx: Contexto, doc: DocumentoImportV0) {
  return classificarLote(doc, (codigo) => {
    const p = ctx.armazem.pacotes.porChave(doc.source, codigo);
    return p ? { id: p.id, dados: p.dados, estado: p.estado } : undefined;
  });
}

/**
 * Enquanto em PRÉVIA, a classificação é refeita contra o inventário ATUAL
 * (ele pode ter mudado desde o upload). Decisões já tomadas são mantidas se o conflito continua.
 */
function atualizarPrevia(ctx: Contexto, lote: Lote): ItemLote[] {
  const antigos = new Map(ctx.armazem.lotes.itens(lote.id).map((i) => [i.indice, i]));
  const novos = classificar(ctx, lote.documento as DocumentoImportV0);
  return novos.map((n) => {
    const a = antigos.get(n.indice);
    const decisao = n.classe === 'CONFLITO' && a?.classe === 'CONFLITO' && a.pacoteExistenteId === n.pacoteExistenteId ? a.decisao : null;
    const item: ItemLote = { ...n, loteId: lote.id, decisao, pacoteId: a?.pacoteId ?? null };
    if (!a || JSON.stringify(a) !== JSON.stringify(item)) ctx.armazem.lotes.atualizarItem(item);
    return item;
  });
}

export interface VisaoLote {
  lote: Omit<Lote, 'documento'>;
  itens: (ItemLote & { entra: boolean; precisaDecisao: boolean; rotulo: string })[];
  resumo: ResumoPrevia;
}

export function verLote(ctx: Contexto, loteId: string): VisaoLote {
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const lote = armazem.lotes.porId(loteId);
    if (!lote) throw new ErroAplicacao('LOTE_INEXISTENTE', 'lote não encontrado', 404);
    const itens = lote.status === 'PREVIA' ? atualizarPrevia(ctx, lote) : armazem.lotes.itens(loteId);
    const decisoes = Object.fromEntries(itens.map((i) => [i.indice, i.decisao ?? undefined]));
    const { documento: _documento, ...semDoc } = lote;
    return {
      lote: semDoc,
      itens: itens.map((i) => ({ ...i, ...EFEITO_CLASSE[i.classe] })),
      resumo: resumirPrevia(itens, decisoes),
    };
  });
}

export function listarLotes(ctx: Contexto): Omit<Lote, 'documento'>[] {
  return ctx.armazem.lotes.listar().map(({ documento: _d, ...l }) => l);
}

export function decidirConflito(ctx: Contexto, loteId: string, indice: number, decisao: DecisaoConflito): void {
  const { armazem } = ctx;
  armazem.transacao(() => {
    const lote = armazem.lotes.porId(loteId);
    if (!lote) throw new ErroAplicacao('LOTE_INEXISTENTE', 'lote não encontrado', 404);
    if (lote.status !== 'PREVIA') throw new ErroAplicacao('LOTE_FECHADO', 'lote já foi confirmado ou descartado', 409);
    const item = atualizarPrevia(ctx, lote).find((i) => i.indice === indice);
    if (!item) throw new ErroAplicacao('ITEM_INEXISTENTE', 'item não encontrado', 404);
    if (item.classe !== 'CONFLITO') throw new ErroAplicacao('SEM_CONFLITO', 'este item não está em conflito', 409);
    armazem.lotes.atualizarItem({ ...item, decisao });
  });
}

export function descartarLote(ctx: Contexto, loteId: string): void {
  const { armazem } = ctx;
  armazem.transacao(() => {
    const lote = armazem.lotes.porId(loteId);
    if (!lote) throw new ErroAplicacao('LOTE_INEXISTENTE', 'lote não encontrado', 404);
    if (lote.status !== 'PREVIA') throw new ErroAplicacao('LOTE_FECHADO', 'só é possível descartar uma prévia', 409);
    armazem.lotes.atualizarStatus(loteId, 'DESCARTADO', null, null);
  });
}

function resolverDestino(ctx: Contexto, dados: DadosPacote, agora: string): ResolucaoDestinoPacote {
  const alvo = destinoDoEndereco(dados);
  const r = resolverDestinoDoPacote(dados, ctx.armazem.destinos.noNumero(alvo.ruaChave, alvo.numeroChave));
  if (r.criar && !ctx.armazem.destinos.porId(r.criar.id)) ctx.armazem.destinos.criar(r.criar, agora);
  return r;
}

export interface ResultadoConfirmacao {
  loteId: string;
  jaConfirmado: boolean;
  criados: number;
  conflitosResolvidos: number;
  /** Códigos devolvidos ao galpão que chegaram de novo e foram reabertos. */
  reabertos: number;
  naoEntraram: number;
}

export function confirmarImportacao(ctx: Contexto, loteId: string, ator: string): ResultadoConfirmacao {
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const lote = armazem.lotes.porId(loteId);
    if (!lote) throw new ErroAplicacao('LOTE_INEXISTENTE', 'lote não encontrado', 404);
    if (lote.status === 'DESCARTADO') throw new ErroAplicacao('LOTE_DESCARTADO', 'lote descartado', 409);
    if (lote.status === 'CONFIRMADO') {
      const itens = armazem.lotes.itens(loteId);
      return {
        loteId,
        jaConfirmado: true,
        criados: itens.filter((i) => i.classe === 'PRONTO').length,
        conflitosResolvidos: itens.filter((i) => i.classe === 'CONFLITO').length,
        reabertos: itens.filter((i) => i.classe === 'REABRIR').length,
        naoEntraram: itens.filter((i) => !EFEITO_CLASSE[i.classe].entra && i.classe !== 'CONFLITO').length,
      };
    }

    const itens = atualizarPrevia(ctx, lote);
    const pendentes = itens.filter((i) => i.classe === 'CONFLITO' && !i.decisao);
    if (pendentes.length > 0) {
      throw new ErroAplicacao(
        'CONFLITOS_PENDENTES',
        `${pendentes.length} conflito(s) sem decisão: ${pendentes.map((p) => p.codigo).join(', ')}`,
        409,
      );
    }

    const agora = ctx.relogio.agora();
    const base = { ator, origem: 'importacao' as const, ocorridoEm: agora, registradoEm: agora };
    let criados = 0;
    let conflitosResolvidos = 0;
    let reabertos = 0;

    for (const item of itens) {
      if (item.classe === 'REABRIR' && item.pacoteExistenteId) {
        registrarEvento(armazem, {
          ...base,
          id: ctx.ids.novo(),
          pacoteId: item.pacoteExistenteId,
          tipo: 'REABERTO_DO_GALPAO',
          chaveIdempotencia: `reaberto:${loteId}:${item.indice}`,
          dados: { loteId, arquivo: lote.arquivo },
        });
        armazem.lotes.atualizarItem({ ...item, pacoteId: item.pacoteExistenteId });
        reabertos++;
        continue;
      }
      if (item.classe === 'PRONTO') {
        const destino = resolverDestino(ctx, item.dados, agora);
        const codigo = normalizarCodigo(item.codigo);
        const r = registrarEvento(armazem, {
          ...base,
          id: ctx.ids.novo(),
          pacoteId: ctx.ids.novo(),
          tipo: 'IMPORTADO',
          chaveIdempotencia: `importado:${chaveNatural(lote.transportadora, codigo)}`,
          dados: {
            transportadora: lote.transportadora,
            codigo,
            dados: item.dados,
            origem: { loteId, arquivo: item.origem.arquivo, card: item.origem.card },
            extractor: lote.extractor,
            destinoId: destino.destinoId,
            destinoCandidatos: destino.candidatos,
          },
        });
        armazem.lotes.atualizarItem({ ...item, pacoteId: r.pacote.id });
        criados++;
      } else if (item.classe === 'CONFLITO' && item.decisao && item.pacoteExistenteId) {
        const atual = armazem.pacotes.porId(item.pacoteExistenteId);
        if (!atual) throw new Error('pacote do conflito sumiu');
        const destino = item.decisao === 'aceitar_novo' ? resolverDestino(ctx, item.dados, agora) : null;
        registrarEvento(armazem, {
          ...base,
          id: ctx.ids.novo(),
          pacoteId: atual.id,
          tipo: 'CONFLITO_RESOLVIDO',
          chaveIdempotencia: `conflito:${loteId}:${item.indice}`,
          dados: {
            decisao: item.decisao,
            loteId,
            antes: atual.dados,
            recebido: item.dados,
            ...(destino ? { destinoId: destino.destinoId, destinoCandidatos: destino.candidatos } : {}),
          },
        });
        armazem.lotes.atualizarItem({ ...item, pacoteId: atual.id });
        conflitosResolvidos++;
      }
    }

    armazem.lotes.atualizarStatus(loteId, 'CONFIRMADO', agora, ator);
    return {
      loteId,
      jaConfirmado: false,
      criados,
      conflitosResolvidos,
      reabertos,
      naoEntraram: itens.length - criados - conflitosResolvidos - reabertos,
    };
  });
}
