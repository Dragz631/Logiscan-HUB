/**
 * Casos de uso da ponte HUB → CARGA → STREET → HUB.
 *
 *  1. criarCarga        : pacotes ATRIBUIDOS a um ajudante saem para a rua (EM_ROTA) numa carga identificável.
 *  2. exportarCarga     : gera o documento `logiscan.carga/v0` (só os pacotes daquele ajudante).
 *  3. receberRetorno    : aplica os eventos `logiscan.street-eventos/v0` na timeline de cada pacote,
 *                         de forma idempotente; o que não puder ser aplicado é RECUSADO com motivo.
 */
import { SCHEMA_CARGA_V0, type DocumentoCargaV0 } from '../contracts/cargaV0';
import { lerDocumentoStreetEventos, type EventoStreetV0 } from '../contracts/streetEventosV0';
import { type Carga, type EventoCarga, type SituacaoCarga, codigoCarga, descreverEventoCarga, prefixoCarga, situacaoCarga } from '../domain/carga';
import { ErroDominio } from '../domain/eventos';
import type { EstadoPacote, Pacote } from '../domain/pacote';
import { ErroAplicacao } from './erros';
import type { Contexto } from './portas';
import { registrarEvento } from './registrarEvento';

/** Pacotes que podem entrar numa carga nova do ajudante: com ele e ainda no galpão. */
export function pacotesParaCarga(ctx: Contexto, ajudanteId: string): Pacote[] {
  return ctx.armazem.pacotes.listar({ responsavelId: ajudanteId, estado: 'ATRIBUIDO' });
}

export function criarCarga(ctx: Contexto, entrada: { ajudanteId: string; pacoteIds: string[]; ator: string }): Carga {
  const ids = [...new Set(entrada.pacoteIds)];
  if (ids.length === 0) throw new ErroAplicacao('CARGA_VAZIA', 'selecione ao menos um pacote para a carga');
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const ajudante = armazem.ajudantes.porId(entrada.ajudanteId);
    if (!ajudante) throw new ErroAplicacao('AJUDANTE_INEXISTENTE', 'ajudante não encontrado', 404);
    const agora = ctx.relogio.agora();
    const prefixo = prefixoCarga(agora, ajudante.nome);
    const carga: Carga = {
      id: ctx.ids.novo(),
      codigo: codigoCarga(agora, ajudante.nome, armazem.cargas.contarPorPrefixo(prefixo) + 1),
      ajudante: { id: ajudante.id, nome: ajudante.nome },
      pacoteIds: ids,
      criadaEm: agora,
      criadaPor: entrada.ator,
    };
    // Valida TODOS antes de gravar qualquer coisa: carga é tudo ou nada.
    for (const id of ids) {
      const p = armazem.pacotes.porId(id);
      if (!p) throw new ErroAplicacao('PACOTE_INEXISTENTE', `pacote ${id} não encontrado`, 404);
      if (p.responsavelId !== ajudante.id) {
        throw new ErroAplicacao('NAO_E_DO_AJUDANTE', `pacote ${p.codigo} não está com ${ajudante.nome}`, 409);
      }
      if (p.estado !== 'ATRIBUIDO') {
        throw new ErroAplicacao('FORA_DO_GALPAO', `pacote ${p.codigo} está em ${p.estado}: só entra em carga pacote atribuído e no galpão`, 409);
      }
    }
    armazem.cargas.criar(carga);
    armazem.cargas.anexarEvento({
      id: ctx.ids.novo(),
      cargaId: carga.id,
      tipo: 'CARGA_CRIADA',
      dados: { ajudante: carga.ajudante, quantidade: ids.length },
      ator: entrada.ator,
      ocorridoEm: agora,
      registradoEm: agora,
    });
    for (const pacoteId of ids) {
      registrarEvento(armazem, {
        id: ctx.ids.novo(),
        pacoteId,
        tipo: 'SAIU_PARA_ROTA',
        dados: { carga: { id: carga.id, codigo: carga.codigo }, ajudante: carga.ajudante },
        ator: entrada.ator,
        origem: 'hub',
        ocorridoEm: agora,
        registradoEm: agora,
        chaveIdempotencia: `carga:${carga.id}:${pacoteId}`,
      });
    }
    return carga;
  });
}

/** Documento para o Street. Leva só o que ainda está na rua (reexportar é seguro: o Street ignora o que já tem). */
export function exportarCarga(ctx: Contexto, cargaId: string, ator: string): { arquivo: string; documento: DocumentoCargaV0 } {
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const carga = armazem.cargas.porId(cargaId);
    if (!carga) throw new ErroAplicacao('CARGA_INEXISTENTE', 'carga não encontrada', 404);
    const agora = ctx.relogio.agora();
    const pacotes = carga.pacoteIds
      .map((id) => armazem.pacotes.porId(id))
      .filter((p): p is Pacote => !!p && p.estado === 'EM_ROTA' && p.cargaId === carga.id);
    const arquivo = `carga-${carga.codigo}.json`;
    armazem.cargas.anexarEvento({
      id: ctx.ids.novo(),
      cargaId: carga.id,
      tipo: 'CARGA_EXPORTADA',
      dados: { arquivo },
      ator,
      ocorridoEm: agora,
      registradoEm: agora,
    });
    return {
      arquivo,
      documento: {
        schema: SCHEMA_CARGA_V0,
        gerado_em: agora,
        carga: { id: carga.id, codigo: carga.codigo, criada_em: carga.criadaEm, criada_por: carga.criadaPor },
        ajudante: carga.ajudante,
        pacotes: pacotes.map((p) => ({
          hub_pacote_id: p.id,
          transportadora: p.transportadora,
          codigo: p.codigo,
          destinatario: p.dados.destinatario,
          rua: p.dados.rua,
          rua_detalhe: p.dados.ruaDetalhe,
          numero: p.dados.numero,
          complemento: p.dados.complemento,
          bairro: p.dados.bairro,
          cidade: p.dados.cidade,
          uf: p.dados.uf,
          cep: p.dados.cep,
          destino_id: p.destinoId,
        })),
      },
    };
  });
}

export interface ResultadoRetorno {
  ok: true;
  aceitos: number;
  repetidos: number;
  recusados: { idEventoStreet: string; codigo: string; motivo: string }[];
}

export function receberRetornoStreet(
  ctx: Contexto,
  entrada: { arquivo: string; conteudo: string },
): ResultadoRetorno | { ok: false; erros: string[] } {
  const leitura = lerDocumentoStreetEventos(entrada.conteudo);
  if (!leitura.ok) return leitura;
  const doc = leitura.documento;
  const { armazem } = ctx;

  return armazem.transacao(() => {
    const agora = ctx.relogio.agora();
    const porCarga = new Map<string, { aceitos: number; repetidos: number; recusados: ResultadoRetorno['recusados'] }>();
    const total: ResultadoRetorno = { ok: true, aceitos: 0, repetidos: 0, recusados: [] };
    const conta = (cargaId: string) => {
      if (!porCarga.has(cargaId)) porCarga.set(cargaId, { aceitos: 0, repetidos: 0, recusados: [] });
      return porCarga.get(cargaId)!;
    };

    for (const ev of doc.eventos) {
      const recusar = (motivo: string, cargaConhecida: boolean) => {
        const r = { idEventoStreet: ev.id_evento, codigo: ev.codigo, motivo };
        total.recusados.push(r);
        if (cargaConhecida) conta(ev.carga_id).recusados.push(r);
      };
      const carga = armazem.cargas.porId(ev.carga_id);
      if (!carga) {
        recusar(`carga ${ev.carga_id} não existe no HUB`, false);
        continue;
      }
      const chave = `street:${ev.id_evento}`;
      if (armazem.eventos.porChave(chave)) {
        total.repetidos++;
        conta(carga.id).repetidos++;
        continue;
      }
      const motivo = validarEvento(ev, carga, doc.ajudante.id);
      if (motivo) {
        recusar(motivo, true);
        continue;
      }
      try {
        registrarEvento(armazem, {
          id: ctx.ids.novo(),
          pacoteId: ev.hub_pacote_id,
          tipo: 'ENTREGA_REGISTRADA',
          dados: {
            carga: { id: carga.id, codigo: carga.codigo },
            ajudante: carga.ajudante,
            idEventoStreet: ev.id_evento,
            recebedor: ev.recebedor ? { tipo: ev.recebedor.tipo, detalhes: ev.recebedor.detalhes } : null,
          },
          ator: carga.ajudante.nome,
          origem: 'street',
          ocorridoEm: new Date(ev.ocorrido_em).toISOString(),
          registradoEm: agora,
          chaveIdempotencia: chave,
        });
        total.aceitos++;
        conta(carga.id).aceitos++;
      } catch (e) {
        if (!(e instanceof ErroDominio)) throw e;
        recusar(e.message, true);
      }
    }

    for (const [cargaId, c] of porCarga) {
      armazem.cargas.anexarEvento({
        id: ctx.ids.novo(),
        cargaId,
        tipo: 'RETORNO_RECEBIDO',
        dados: { arquivo: entrada.arquivo, ...c },
        ator: doc.ajudante.nome,
        ocorridoEm: doc.gerado_em && !Number.isNaN(Date.parse(doc.gerado_em)) ? new Date(doc.gerado_em).toISOString() : agora,
        registradoEm: agora,
      });
    }
    return total;
  });
}

function validarEvento(ev: EventoStreetV0, carga: Carga, ajudanteDoArquivo: string): string | null {
  if (ev.tipo !== 'ENTREGA_REGISTRADA') return `tipo de evento "${ev.tipo}" ainda não é aceito pelo HUB`;
  if (ajudanteDoArquivo !== carga.ajudante.id) return `a carga ${carga.codigo} é de ${carga.ajudante.nome}, não de quem enviou o arquivo`;
  if (!carga.pacoteIds.includes(ev.hub_pacote_id)) return `pacote não faz parte da carga ${carga.codigo}`;
  if (Number.isNaN(Date.parse(ev.ocorrido_em))) return `data/hora inválida: "${ev.ocorrido_em}"`;
  return null;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export interface ResumoCarga {
  id: string;
  codigo: string;
  ajudante: { id: string; nome: string };
  criadaEm: string;
  criadaPor: string;
  situacao: SituacaoCarga;
  total: number;
  porEstado: Partial<Record<EstadoPacote, number>>;
}

function resumir(ctx: Contexto, c: Carga): ResumoCarga & { pacotes: Pacote[] } {
  const pacotes = c.pacoteIds.map((id) => ctx.armazem.pacotes.porId(id)).filter((p): p is Pacote => !!p);
  const porEstado: Partial<Record<EstadoPacote, number>> = {};
  for (const p of pacotes) porEstado[p.estado] = (porEstado[p.estado] ?? 0) + 1;
  return {
    id: c.id,
    codigo: c.codigo,
    ajudante: c.ajudante,
    criadaEm: c.criadaEm,
    criadaPor: c.criadaPor,
    situacao: situacaoCarga(pacotes.map((p) => p.estado)),
    total: pacotes.length,
    porEstado,
    pacotes,
  };
}

export function listarCargas(ctx: Contexto): ResumoCarga[] {
  return ctx.armazem.cargas.listar().map((c) => {
    const { pacotes: _p, ...r } = resumir(ctx, c);
    return r;
  });
}

export interface DetalheCarga extends ResumoCarga {
  pacotes: Pacote[];
  historico: (EventoCarga & { descricao: string })[];
}

export function detalharCarga(ctx: Contexto, cargaId: string): DetalheCarga {
  const c = ctx.armazem.cargas.porId(cargaId);
  if (!c) throw new ErroAplicacao('CARGA_INEXISTENTE', 'carga não encontrada', 404);
  return {
    ...resumir(ctx, c),
    historico: ctx.armazem.cargas.eventos(c.id).map((e) => ({ ...e, descricao: descreverEventoCarga(e) })),
  };
}
