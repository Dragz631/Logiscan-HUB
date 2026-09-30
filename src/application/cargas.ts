/**
 * Casos de uso da ponte HUB → CARGA → STREET → HUB.
 *
 *  1. criarCarga        : MONTA a carga — pacotes ATRIBUIDOS do ajudante entram nela e continuam no galpão.
 *  2. iniciarRota       : ação explícita do operador — carga e pacotes passam para EM_ROTA (horário próprio).
 *  3. exportarCarga     : gera o documento `logiscan.carga/v0` (só os pacotes daquele ajudante).
 *  4. receberRetorno    : aplica ENTREGA/INSUCESSO de `logiscan.street-eventos/v0` na timeline de cada pacote,
 *                         de forma idempotente; o que não puder ser aplicado é RECUSADO com motivo.
 *  5. registrarCorrecao : reverte um desfecho com um evento NOVO (o original nunca é apagado).
 */
import { type CaixaCargaV0, SCHEMA_CARGA_V0, type DocumentoCargaV0, type ItemCargaV0 } from '../contracts/cargaV0';
import type { Regiao } from '../domain/regioes';
import { lerDocumentoStreetEventos, type EventoStreetV0 } from '../contracts/streetEventosV0';
import { type Carga, type EventoCarga, type SituacaoCarga, codigoCarga, descreverEventoCarga, prefixoCarga, situacaoCarga } from '../domain/carga';
import { ErroDominio } from '../domain/eventos';
import type { EstadoPacote, Pacote } from '../domain/pacote';
import { ErroAplicacao } from './erros';
import type { Contexto } from './portas';
import { type RuaDoPerfil, ruasDaCarga } from './orquestracao';
import { identidadeDaRua, resolvedorDeRua } from './regioes';
import { registrarEvento } from './registrarEvento';

/** Pacotes que podem entrar numa carga nova do ajudante: com ele, no galpão e fora de outra carga. */
export function pacotesParaCarga(ctx: Contexto, ajudanteId: string): Pacote[] {
  return ctx.armazem.pacotes.listar({ responsavelId: ajudanteId, estado: 'ATRIBUIDO' }).filter((p) => p.cargaId === null);
}

export function criarCarga(ctx: Contexto, entrada: { ajudanteId: string; pacoteIds: string[]; ator: string }): Carga {
  const ids = [...new Set(entrada.pacoteIds)];
  if (ids.length === 0) throw new ErroAplicacao('CARGA_VAZIA', 'selecione ao menos um pacote para a carga');
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const ajudante = armazem.ajudantes.porId(entrada.ajudanteId);
    if (!ajudante) throw new ErroAplicacao('AJUDANTE_INEXISTENTE', 'ajudante não encontrado', 404);
    const ativa = armazem.cargas.ativaDoAjudante(ajudante.id);
    if (ativa) {
      throw new ErroAplicacao('JA_TEM_CARGA_ATIVA', `${ajudante.nome} já tem a carga ${ativa.codigo} ativa: um perfil não mistura duas cargas`, 409);
    }
    const agora = ctx.relogio.agora();
    const prefixo = prefixoCarga(agora, ajudante.nome);
    const carga: Carga = {
      id: ctx.ids.novo(),
      codigo: codigoCarga(agora, ajudante.nome, armazem.cargas.contarPorPrefixo(prefixo) + 1),
      ajudante: { id: ajudante.id, nome: ajudante.nome },
      pacoteIds: ids,
      criadaEm: agora,
      criadaPor: entrada.ator,
      rotaIniciadaEm: null,
      rotaIniciadaPor: null,
      finalizadaEm: null,
      finalizadaPor: null,
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
      if (p.cargaId !== null) {
        throw new ErroAplicacao('JA_EM_CARGA', `pacote ${p.codigo} já está em outra carga montada`, 409);
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
        tipo: 'INCLUIDO_EM_CARGA',
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

/**
 * O operador INICIA A ROTA: só aqui a carga e os pacotes vão para EM_ROTA.
 * Repetir (retry/clique duplo) não muda nada nem cria eventos novos.
 */
export function iniciarRota(ctx: Contexto, cargaId: string, ator: string): { jaIniciada: boolean; rotaIniciadaEm: string } {
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const carga = armazem.cargas.porId(cargaId);
    if (!carga) throw new ErroAplicacao('CARGA_INEXISTENTE', 'carga não encontrada', 404);
    if (carga.rotaIniciadaEm) return { jaIniciada: true, rotaIniciadaEm: carga.rotaIniciadaEm };
    const agora = ctx.relogio.agora();
    for (const pacoteId of carga.pacoteIds) {
      try {
        registrarEvento(armazem, {
          id: ctx.ids.novo(),
          pacoteId,
          tipo: 'SAIU_PARA_ROTA',
          dados: { carga: { id: carga.id, codigo: carga.codigo }, ajudante: carga.ajudante },
          ator,
          origem: 'hub',
          ocorridoEm: agora,
          registradoEm: agora,
          chaveIdempotencia: `rota:${carga.id}:${pacoteId}`,
        });
      } catch (e) {
        if (e instanceof ErroDominio) throw new ErroAplicacao(e.codigo, `pacote ${armazem.pacotes.porId(pacoteId)?.codigo ?? pacoteId}: ${e.message}`, 409);
        throw e;
      }
    }
    armazem.cargas.marcarRotaIniciada(carga.id, agora, ator);
    armazem.cargas.anexarEvento({
      id: ctx.ids.novo(),
      cargaId: carga.id,
      tipo: 'ROTA_INICIADA',
      dados: { quantidade: carga.pacoteIds.length },
      ator,
      ocorridoEm: agora,
      registradoEm: agora,
    });
    return { jaIniciada: false, rotaIniciadaEm: agora };
  });
}

/**
 * Documento para o Street: os pacotes da carga ainda sem desfecho (montada ou na rua — o ajudante pode
 * carregar o celular no galpão). Reexportar é seguro: o Street ignora o que já tem.
 */
export function exportarCarga(ctx: Contexto, cargaId: string, ator: string): { arquivo: string; documento: DocumentoCargaV0 } {
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const carga = armazem.cargas.porId(cargaId);
    if (!carga) throw new ErroAplicacao('CARGA_INEXISTENTE', 'carga não encontrada', 404);
    const agora = ctx.relogio.agora();
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
    return { arquivo, documento: documentoDaCarga(ctx, carga, agora) };
  });
}

/**
 * Documento `logiscan.carga/v0` da carga: SÓ os pacotes dela, do ajudante dono dela, ainda sem desfecho.
 * Usado pelo arquivo (fallback/diagnóstico) e pelo transporte direto HUB → Street.
 */
export function documentoDaCarga(ctx: Contexto, carga: Carga, agora: string): DocumentoCargaV0 {
  const pacotes = carga.pacoteIds
    .map((id) => ctx.armazem.pacotes.porId(id))
    .filter((p): p is Pacote => !!p && p.cargaId === carga.id && (p.estado === 'EM_ROTA' || p.estado === 'ATRIBUIDO'));
  const identidade = identidadeDaRua(ctx);
  const caixaDoc = caixaParaCarga(ctx);
  const eventosCarga = ctx.armazem.cargas.eventos(carga.id);
  const criada = eventosCarga.find((e) => e.tipo === 'CARGA_CRIADA');
  const de = criada && criada.tipo === 'CARGA_CRIADA' ? criada.dados.repassadaDe : undefined;
  const repassos = eventosCarga.filter((e) => e.tipo === 'ROTA_REPASSADA');
  const ultimoRepasso = repassos.at(-1);
  const repassadaPara =
    ultimoRepasso && ultimoRepasso.tipo === 'ROTA_REPASSADA'
      ? {
          carga_codigo: ultimoRepasso.dados.paraCarga.codigo,
          ajudante: ultimoRepasso.dados.para,
          em: ultimoRepasso.ocorridoEm,
          motivo: ultimoRepasso.dados.motivo,
          pacotes: repassos.reduce((n, e) => n + (e.tipo === 'ROTA_REPASSADA' ? e.dados.pacotes : 0), 0),
        }
      : null;
  const itens = new Map<string, ItemCargaV0>();
  const linhas = pacotes.map((p) => {
    const rua = identidade(p);
    const caixa = rua.caixa ? caixaDoc(rua.caixa) : null;
    // um item = uma rua DENTRO de uma caixa (a mesma rua pode ter pessoas em caixas diferentes)
    const k = `${caixa?.id ?? ''}|${rua.ruaId}`;
    const item = itens.get(k) ?? {
      rua_id: rua.ruaId, rua_nome: rua.ruaNome, regiao_id: rua.regiao?.id ?? null, regiao_nome: rua.regiao?.nome ?? null, caixa, pacote_ids: [],
    };
    item.pacote_ids.push(p.id);
    itens.set(k, item);
    return {
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
      rua_id: rua.ruaId,
      rua_nome: rua.ruaNome,
      regiao: rua.regiao ? { id: rua.regiao.id, nome: rua.regiao.nome, repasse_unico: rua.regiao.repasseUnico } : null,
      caixa,
    };
  });
  return {
    schema: SCHEMA_CARGA_V0,
    gerado_em: agora,
    carga: {
      id: carga.id,
      codigo: carga.codigo,
      criada_em: carga.criadaEm,
      criada_por: carga.criadaPor,
      situacao: carga.rotaIniciadaEm ? 'EM_ROTA' : 'MONTADA',
      rota_iniciada_em: carga.rotaIniciadaEm,
      repassada_de: de
        ? { carga_codigo: de.carga.codigo, ajudante: de.ajudante, em: criada!.ocorridoEm, motivo: de.motivo, pacotes: pacotes.length }
        : null,
      repassada_para: repassadaPara,
    },
    ajudante: carga.ajudante,
    pacotes: linhas,
    itens: [...itens.values()],
  };
}

/** Caixa como vai na carga: com a caixa que agrupa e os nomes que ela já teve (histórico CAIXA_CONFIGURADA). */
function caixaParaCarga(ctx: Contexto): (c: Regiao) => CaixaCargaV0 {
  const cache = new Map<string, CaixaCargaV0>();
  return (c) => {
    if (!cache.has(c.id)) {
      const pai = c.paiId ? ctx.armazem.regioes.porId(c.paiId) : undefined;
      const antigos = ctx.armazem.regioes
        .eventos(`caixa:${c.id}`)
        .flatMap((e) => (e.tipo === 'CAIXA_CONFIGURADA' ? [e.dados.de.nome] : []))
        .filter((n, i, a) => n !== c.nome && a.indexOf(n) === i);
      cache.set(c.id, { id: c.id, numero: c.numero, nome: c.nome, pai: pai ? { id: pai.id, nome: pai.nome } : null, nomes_anteriores: antigos });
    }
    return cache.get(c.id)!;
  };
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
      const motivo = validarEvento(ev, carga, doc.ajudante.id) ?? null;
      if (motivo) {
        // "não faz parte da carga" pode ser repasse ou fim de dia: diz qual (o operador resolve).
        recusar(motivo.startsWith('pacote não faz parte') ? explicarForaDaCarga(ctx, ev.hub_pacote_id, carga, motivo) : motivo, true);
        continue;
      }
      try {
        const comum = {
          id: ctx.ids.novo(),
          pacoteId: ev.hub_pacote_id,
          ator: carga.ajudante.nome,
          origem: 'street' as const,
          ocorridoEm: new Date(ev.ocorrido_em).toISOString(),
          registradoEm: agora,
          chaveIdempotencia: chave,
        };
        const ref = { carga: { id: carga.id, codigo: carga.codigo }, ajudante: carga.ajudante, idEventoStreet: ev.id_evento };
        if (ev.tipo === 'INSUCESSO_REGISTRADO') {
          registrarEvento(armazem, { ...comum, tipo: 'INSUCESSO_REGISTRADO', dados: { ...ref, motivo: ev.motivo ?? '', ...(ev.texto ? { texto: ev.texto } : {}) } });
        } else {
          registrarEvento(armazem, {
            ...comum,
            tipo: 'ENTREGA_REGISTRADA',
            dados: {
              ...ref,
              recebedor: ev.recebedor ? { tipo: ev.recebedor.tipo, detalhes: ev.recebedor.detalhes } : null,
              ...(ev.texto ? { texto: ev.texto } : {}),
            },
          });
        }
        total.aceitos++;
        conta(carga.id).aceitos++;
      } catch (e) {
        if (!(e instanceof ErroDominio)) throw e;
        recusar(e.codigo === 'FORA_DA_CARGA' ? explicarForaDaCarga(ctx, ev.hub_pacote_id, carga, e.message) : e.message, true);
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

/**
 * O Street reportou algo de um pacote que já não está nesta carga. Três causas reais, ditas com clareza:
 * repasse na hora para outro ajudante, fim do dia (voltou para a caixa / foi ao galpão) ou outra.
 */
function explicarForaDaCarga(ctx: Contexto, pacoteId: string, carga: Carga, padrao: string): string {
  const p = ctx.armazem.pacotes.porId(pacoteId);
  if (!p) return padrao;
  if (p.cargaId && p.cargaId !== carga.id) {
    const outra = ctx.armazem.cargas.porId(p.cargaId);
    return `o pacote foi repassado para ${outra?.ajudante.nome ?? 'outro ajudante'} (carga ${outra?.codigo ?? '?'}); o registro de ${carga.ajudante.nome} não foi aplicado`;
  }
  if (p.estado === 'RETORNADO') return `o dia foi encerrado e o pacote voltou para a caixa como Retornado; o registro de ${carga.ajudante.nome} não foi aplicado`;
  if (p.estado === 'DEVOLVIDO') return `o dia foi encerrado e o pacote foi devolvido ao galpão; o registro de ${carga.ajudante.nome} não foi aplicado`;
  return padrao;
}

function validarEvento(ev: EventoStreetV0, carga: Carga, ajudanteDoArquivo: string): string | null {
  if (ev.tipo !== 'ENTREGA_REGISTRADA' && ev.tipo !== 'INSUCESSO_REGISTRADO') return `tipo de evento "${ev.tipo}" ainda não é aceito pelo HUB`;
  if (ev.tipo === 'INSUCESSO_REGISTRADO' && !ev.motivo?.trim()) return 'insucesso sem motivo';
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
  rotaIniciadaEm: string | null;
  rotaIniciadaPor: string | null;
  finalizadaEm: string | null;
  finalizadaPor: string | null;
  situacao: SituacaoCarga;
  ruas: RuaDoPerfil[];
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
    rotaIniciadaEm: c.rotaIniciadaEm,
    rotaIniciadaPor: c.rotaIniciadaPor,
    finalizadaEm: c.finalizadaEm,
    finalizadaPor: c.finalizadaPor,
    situacao: situacaoCarga(c.rotaIniciadaEm, pacotes.map((p) => p.estado), c.finalizadaEm),
    ruas: ruasDaCarga(pacotes, resolvedorDeRua(ctx)),
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

// ---------------------------------------------------------------------------
// Correção (sem apagar nada)
// ---------------------------------------------------------------------------

/**
 * Reverte o ÚLTIMO desfecho (entrega ou insucesso) do pacote com um evento novo de correção.
 * O evento original continua no histórico, intacto. Ainda sem tela: domínio preparado.
 */
export function registrarCorrecao(
  ctx: Contexto,
  entrada: { pacoteId: string; eventoId: string; motivo: string; ator: string; chave: string },
): void {
  const { armazem } = ctx;
  armazem.transacao(() => {
    const eventos = armazem.eventos.doPacote(entrada.pacoteId);
    if (eventos.length === 0) throw new ErroAplicacao('PACOTE_INEXISTENTE', 'pacote não encontrado', 404);
    const desfechos = eventos.filter((e) => e.tipo === 'ENTREGA_REGISTRADA' || e.tipo === 'INSUCESSO_REGISTRADO' || e.tipo === 'CORRECAO_REGISTRADA');
    const ultimo = desfechos.at(-1);
    if (!ultimo || ultimo.id !== entrada.eventoId || ultimo.tipo === 'CORRECAO_REGISTRADA') {
      throw new ErroAplicacao('NAO_E_O_ULTIMO_DESFECHO', 'só é possível corrigir o último desfecho ainda não corrigido', 409);
    }
    const agora = ctx.relogio.agora();
    try {
      registrarEvento(armazem, {
        id: ctx.ids.novo(),
        pacoteId: entrada.pacoteId,
        tipo: 'CORRECAO_REGISTRADA',
        dados: { eventoCorrigido: { id: ultimo.id, tipo: ultimo.tipo }, motivo: entrada.motivo },
        ator: entrada.ator,
        origem: 'hub',
        ocorridoEm: agora,
        registradoEm: agora,
        chaveIdempotencia: `correcao:${entrada.chave}`,
      });
    } catch (e) {
      if (e instanceof ErroDominio) throw new ErroAplicacao(e.codigo, e.message, 409);
      throw e;
    }
  });
}
