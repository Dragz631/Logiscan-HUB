/**
 * FECHAMENTO DA ROTA e RELATÓRIO DO DIA — leitura pura do que já aconteceu (nada é gravado).
 *
 * Para cada pacote da carga olha os eventos DELA: a última entrega/insucesso registrada no Street e, se houve
 * Novo dia, para onde a sobra foi (amanhã ou galpão). Assim o relatório continua certo mesmo depois que o dia
 * foi encerrado e o pacote voltou para uma caixa.
 */
import {
  type CaixaDoFechamento,
  type EntregaDoFechamento,
  type FalhaDoFechamento,
  type FechamentoDeRota,
  situacaoDoFechamento,
  textoDoRelatorioDoDia,
} from '../domain/fechamento';
import type { Dia } from '../domain/dias';
import type { Evento } from '../domain/eventos';
import { ErroAplicacao } from './erros';
import { detalharDia } from './novoDia';
import { resolvedorDeUnidade } from './orquestracao';
import type { Contexto } from './portas';

const ENTREGUES = ['ENTREGUE', 'PRONTO_PARA_BAIXA', 'BAIXADO'];

/** O que os eventos de UM pacote dizem sobre a passagem dele por uma carga. */
function desfechoNaCarga(eventos: Evento[], cargaId: string) {
  let entrega: Extract<Evento, { tipo: 'ENTREGA_REGISTRADA' }> | undefined;
  let insucesso: Extract<Evento, { tipo: 'INSUCESSO_REGISTRADO' }> | undefined;
  let ultimo: 'entrega' | 'insucesso' | null = null;
  let destino: 'amanha' | 'galpao' | null = null;
  let passou = false;
  for (const e of eventos) {
    if (e.tipo === 'ENTREGA_REGISTRADA' && e.dados.carga.id === cargaId) {
      entrega = e;
      ultimo = 'entrega';
      passou = true;
    } else if (e.tipo === 'INSUCESSO_REGISTRADO' && e.dados.carga.id === cargaId) {
      insucesso = e;
      ultimo = 'insucesso';
      passou = true;
    } else if (e.tipo === 'DIA_ENCERRADO' && e.dados.carga.id === cargaId) {
      destino = e.dados.destino;
      passou = true;
    }
  }
  return { entrega: ultimo === 'entrega' ? entrega : undefined, insucesso: ultimo === 'insucesso' ? insucesso : undefined, destino, passou };
}

/** O resumo de uma rota: totais, por caixa, o que não foi entregue e a prova de cada entrega. */
export function fechamentoDaCarga(ctx: Contexto, cargaId: string): FechamentoDeRota {
  const { armazem } = ctx;
  const carga = armazem.cargas.porId(cargaId);
  if (!carga) throw new ErroAplicacao('CARGA_INEXISTENTE', 'carga não encontrada', 404);
  const unidadeDe = resolvedorDeUnidade(ctx);

  const entregas: EntregaDoFechamento[] = [];
  const falhas: FalhaDoFechamento[] = [];
  const porCaixa = new Map<string, CaixaDoFechamento & { ordem: number }>();
  let total = 0;

  for (const id of carga.pacoteIds) {
    const p = armazem.pacotes.porId(id);
    if (!p) continue;
    const d = desfechoNaCarga(armazem.eventos.doPacote(p.id), carga.id);
    // Pacote que já foi para outra carga sem nunca ter tido desfecho nesta não é desta rota.
    if (p.cargaId !== carga.id && !d.passou) continue;
    total++;

    const entregue = !!d.entrega && ENTREGUES.includes(p.estado);
    const u = unidadeDe(p);
    if (!porCaixa.has(u.chave)) porCaixa.set(u.chave, { chave: u.chave, numero: u.caixa?.numero ?? null, nome: u.nome, total: 0, entregues: 0, ordem: u.caixa?.ordem ?? Number.MAX_SAFE_INTEGER });
    const cx = porCaixa.get(u.chave)!;
    cx.total++;

    const base = { pacoteId: p.id, codigo: p.codigo, destinatario: p.dados.destinatario, rua: p.dados.rua, numero: p.dados.numero, complemento: p.dados.complemento };
    if (entregue && d.entrega) {
      cx.entregues++;
      entregas.push({
        ...base,
        caixaChave: u.chave,
        quando: d.entrega.ocorridoEm,
        recebedor: d.entrega.dados.recebedor,
        texto: d.entrega.dados.texto?.trim() || null,
        provaCompleta: p.confirmacaoEntrega?.status === 'COMPLETA',
      });
    } else {
      falhas.push({
        ...base,
        situacao: d.insucesso ? 'INSUCESSO' : 'SEM_DESFECHO',
        motivo: d.insucesso?.dados.motivo ?? p.motivoInsucesso ?? null,
        depois: d.destino,
      });
    }
  }

  entregas.sort((a, b) => (a.quando ?? '').localeCompare(b.quando ?? '') || a.codigo.localeCompare(b.codigo));
  const ultimaEntregaEm = entregas.length > 0 ? (entregas[entregas.length - 1].quando ?? null) : null;
  const minutosNaRua =
    carga.rotaIniciadaEm && ultimaEntregaEm ? Math.max(0, Math.round((Date.parse(ultimaEntregaEm) - Date.parse(carga.rotaIniciadaEm)) / 60_000)) : null;
  const insucessos = falhas.filter((f) => f.situacao === 'INSUCESSO').length;
  return {
    cargaId: carga.id,
    codigo: carga.codigo,
    ajudante: { id: carga.ajudante.id, nome: carga.ajudante.nome },
    saiuEm: carga.rotaIniciadaEm,
    ultimaEntregaEm,
    minutosNaRua,
    total,
    entregues: entregas.length,
    insucessos,
    semDesfecho: falhas.length - insucessos,
    provasCompletas: entregas.filter((e) => e.provaCompleta).length,
    situacao: situacaoDoFechamento(total, entregas.length, insucessos),
    caixas: [...porCaixa.values()]
      .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'))
      .map(({ ordem: _o, ...c }) => c),
    entregas,
    falhas,
  };
}

export interface RelatorioDoDia {
  dia: Dia;
  rotas: FechamentoDeRota[];
  totais: { rotas: number; perfeitas: number; total: number; entregues: number; naoEntregues: number };
  /** O texto do relatório do dia (resumo + o que ficou de fora), pronto para copiar. */
  texto: string;
}

/** O relatório do dia encerrado: cada rota que saiu, com o que foi entregue e o que ficou de fora. */
export function relatorioDoDia(ctx: Contexto, diaId: string): RelatorioDoDia {
  const dia = detalharDia(ctx, diaId);
  const rotas = dia.resumo.cargas.filter((c) => c.situacao === 'EM_ROTA').map((c) => fechamentoDaCarga(ctx, c.cargaId));
  const entregues = rotas.reduce((n, r) => n + r.entregues, 0);
  const total = rotas.reduce((n, r) => n + r.total, 0);
  return {
    dia,
    rotas,
    totais: { rotas: rotas.length, perfeitas: rotas.filter((r) => r.situacao === 'PERFEITA').length, total, entregues, naoEntregues: total - entregues },
    texto: textoDoRelatorioDoDia({ dataRef: dia.dataRef, teste: !dia.historico, rotas, semResponsavel: dia.resumo.semResponsavel ?? null }),
  };
}

