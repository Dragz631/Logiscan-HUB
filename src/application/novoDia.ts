/**
 * NOVO DIA — fechar o dia operacional.
 *
 * Encerra as cargas abertas e decide o que fazer com o que o ajudante NÃO entregou (as "sobras":
 * pendentes na rua + insucessos), ajudante por ajudante:
 *   - amanhã → o pacote volta para a CAIXA como RETORNADO, explícito que é do dia anterior (sem ajudante);
 *   - galpão → DEVOLVIDO: sai da operação (se o código chegar de novo num lote, o HUB reabre).
 * Entregues continuam entregues. Carga montada que nem saiu é desfeita (os pacotes voltam à caixa).
 *
 * "Só memória" (historico=false) marca o dia como TESTE: a memória (caixas, pessoas, destinos) nunca é
 * apagada por nenhuma das opções; o que muda é se o dia conta no histórico de entregas. Nada é apagado
 * do banco — o histórico é append-only.
 *
 * Tudo ou nada, e idempotente pela `chave` (clique duplo / retry não encerra duas vezes).
 */
import { type Carga, dataSP } from '../domain/carga';
import type { DestinoDasSobras, Dia, ResumoCargaDoDia, ResumoDia } from '../domain/dias';
import type { Pacote } from '../domain/pacote';
import { ErroAplicacao } from './erros';
import { erroDominio } from './orquestracao';
import type { Contexto } from './portas';
import { resolvedorDeCaixa } from './regioes';
import { registrarEvento } from './registrarEvento';

interface CargaAberta {
  carga: Carga;
  pacotes: Pacote[];
  resumo: ResumoCargaDoDia;
}

const FEITOS = ['ENTREGUE', 'PRONTO_PARA_BAIXA', 'BAIXADO'];

/** Fotografia das cargas abertas agora (montadas e em rota), com o que sobrou em cada uma. */
function cargasAbertas(ctx: Contexto): CargaAberta[] {
  const { armazem } = ctx;
  const caixaDe = resolvedorDeCaixa(ctx);
  return [...armazem.cargas.idsAtivas()]
    .map((id) => armazem.cargas.porId(id)!)
    .sort((a, b) => a.criadaEm.localeCompare(b.criadaEm) || a.codigo.localeCompare(b.codigo))
    .map((carga) => {
      const pacotes = carga.pacoteIds.map((id) => armazem.pacotes.porId(id)).filter((p): p is Pacote => !!p && p.cargaId === carga.id);
      const emRota = !!carga.rotaIniciadaEm;
      const entregues = pacotes.filter((p) => FEITOS.includes(p.estado)).length;
      const insucessos = pacotes.filter((p) => p.estado === 'INSUCESSO').length;
      const pendentes = pacotes.filter((p) => p.estado === 'EM_ROTA').length;
      const caixas = [...new Set(pacotes.map((p) => caixaDe(p)).map((c) => c.caixa?.nome ?? c.rua.nome))];
      return {
        carga,
        pacotes,
        resumo: {
          cargaId: carga.id,
          codigo: carga.codigo,
          ajudante: carga.ajudante,
          situacao: emRota ? 'EM_ROTA' : 'MONTADA',
          pacotes: pacotes.length,
          entregues,
          insucessos,
          sobras: emRota ? pendentes + insucessos : 0,
          destino: null,
          caixas,
        } satisfies ResumoCargaDoDia,
      };
    });
}

export interface PreviaNovoDia {
  /** O dia que vai ser encerrado (AAAA-MM-DD, São Paulo). */
  dataRef: string;
  cargas: ResumoCargaDoDia[];
  totais: { cargasEmRota: number; montadas: number; entregues: number; sobras: number; pacotesMontados: number };
}

/** O que o botão "Novo dia" vai fechar — só leitura, para o operador escolher antes de confirmar. */
export function previaNovoDia(ctx: Contexto): PreviaNovoDia {
  const abertas = cargasAbertas(ctx);
  const cargas = abertas.map((a) => a.resumo);
  return {
    dataRef: dataSP(ctx.relogio.agora()),
    cargas,
    totais: {
      cargasEmRota: cargas.filter((c) => c.situacao === 'EM_ROTA').length,
      montadas: cargas.filter((c) => c.situacao === 'MONTADA').length,
      entregues: cargas.reduce((n, c) => n + c.entregues, 0),
      sobras: cargas.reduce((n, c) => n + c.sobras, 0),
      pacotesMontados: cargas.filter((c) => c.situacao === 'MONTADA').reduce((n, c) => n + c.pacotes, 0),
    },
  };
}

export interface EntradaEncerrarDia {
  ator: string;
  /** Idempotência: o mesmo clique repetido devolve o dia já encerrado. */
  chave: string;
  /** true = memória + histórico de entregas; false = só memória (dia de TESTE). */
  historico: boolean;
  /** O que fazer com as sobras de cada ajudante (chave = id do ajudante). */
  destinos: Record<string, DestinoDasSobras>;
}

export function encerrarDia(ctx: Contexto, entrada: EntradaEncerrarDia): { dia: Dia; jaEncerrado: boolean } {
  if (!entrada.chave) throw new ErroAplicacao('SEM_CHAVE', 'chave de idempotência obrigatória');
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const repetido = armazem.dias.porChave(entrada.chave);
    if (repetido) return { dia: repetido, jaEncerrado: true };

    const abertas = cargasAbertas(ctx);
    if (abertas.length === 0) throw new ErroAplicacao('NADA_A_ENCERRAR', 'não há cargas abertas para encerrar', 409);
    for (const d of Object.values(entrada.destinos)) {
      if (d !== 'amanha' && d !== 'galpao') throw new ErroAplicacao('DESTINO_INVALIDO', `destino "${String(d)}" não existe (use amanha ou galpao)`);
    }
    const faltando = abertas.filter((a) => a.resumo.situacao === 'EM_ROTA' && a.resumo.sobras > 0 && !entrada.destinos[a.carga.ajudante.id]);
    if (faltando.length > 0) {
      throw new ErroAplicacao(
        'FALTA_DESTINO',
        `escolha o que fazer com as sobras de ${faltando.map((f) => `${f.carga.ajudante.nome} (${f.resumo.sobras})`).join(', ')}: fica para amanhã ou volta ao galpão`,
        409,
      );
    }

    const agora = ctx.relogio.agora();
    const diaId = ctx.ids.novo();
    const dataRef = dataSP(agora);
    const base = { ator: entrada.ator, origem: 'hub' as const, ocorridoEm: agora, registradoEm: agora };
    const cargasResumo: ResumoCargaDoDia[] = [];
    const totais = { cargas: 0, entregues: 0, amanha: 0, galpao: 0, desfeitas: 0 };

    for (const { carga, pacotes, resumo } of abertas) {
      const cargaRef = { id: carga.id, codigo: carga.codigo };
      if (resumo.situacao === 'MONTADA') {
        // Carga que nem saiu: desfeita. Os pacotes voltam à caixa, sem responsável.
        const motivo = 'novo dia: carga montada desfeita';
        for (const p of pacotes) {
          erroDominio(() => registrarEvento(armazem, {
            ...base, id: ctx.ids.novo(), pacoteId: p.id, tipo: 'RETIRADO_DA_CARGA', dados: { carga: cargaRef, motivo },
            chaveIdempotencia: `dia:${diaId}:retirado:${p.id}`,
          }), p.codigo);
          erroDominio(() => registrarEvento(armazem, {
            ...base, id: ctx.ids.novo(), pacoteId: p.id, tipo: 'DESATRIBUIDO', dados: { de: carga.ajudante, motivo },
            chaveIdempotencia: `dia:${diaId}:desatribuido:${p.id}`,
          }), p.codigo);
        }
        armazem.cargas.removerPacotes(carga.id, pacotes.map((p) => p.id));
        armazem.cargas.anexarEvento({
          id: ctx.ids.novo(), cargaId: carga.id, tipo: 'CARGA_DESFEITA', dados: { quantidade: pacotes.length, diaId },
          ator: entrada.ator, ocorridoEm: agora, registradoEm: agora,
        });
        armazem.cargas.marcarFinalizada(carga.id, agora, entrada.ator);
        totais.desfeitas += pacotes.length;
        cargasResumo.push(resumo);
        continue;
      }

      const destino = entrada.destinos[carga.ajudante.id] ?? null;
      const retornadoDe = { dia: dataSP(carga.rotaIniciadaEm!), carga: carga.codigo, ajudante: carga.ajudante.nome };
      for (const p of pacotes) {
        if (p.estado !== 'EM_ROTA' && p.estado !== 'INSUCESSO') continue; // entregue continua entregue
        erroDominio(() => registrarEvento(armazem, {
          ...base, id: ctx.ids.novo(), pacoteId: p.id, tipo: 'DIA_ENCERRADO',
          dados: { dia: { id: diaId, data: dataRef }, carga: cargaRef, ajudante: carga.ajudante, destino: destino!, historico: entrada.historico, retornadoDe },
          chaveIdempotencia: `dia:${diaId}:${p.id}`,
        }), p.codigo);
      }
      armazem.cargas.anexarEvento({
        id: ctx.ids.novo(), cargaId: carga.id, tipo: 'ROTA_FINALIZADA',
        dados: { entregues: resumo.entregues, insucessos: resumo.insucessos, pendentes: resumo.sobras, diaId },
        ator: entrada.ator, ocorridoEm: agora, registradoEm: agora,
      });
      armazem.cargas.marcarFinalizada(carga.id, agora, entrada.ator);
      totais.cargas++;
      totais.entregues += resumo.entregues;
      if (destino === 'amanha') totais.amanha += resumo.sobras;
      if (destino === 'galpao') totais.galpao += resumo.sobras;
      cargasResumo.push({ ...resumo, destino });
    }

    const resumo: ResumoDia = { cargas: cargasResumo, totais };
    const dia: Dia = { id: diaId, dataRef, encerradoEm: agora, encerradoPor: entrada.ator, historico: entrada.historico, resumo, chave: entrada.chave };
    armazem.dias.criar(dia);
    return { dia, jaEncerrado: false };
  });
}

export function listarDias(ctx: Contexto): Dia[] {
  return ctx.armazem.dias.listar();
}

export function detalharDia(ctx: Contexto, id: string): Dia {
  const dia = ctx.armazem.dias.porId(id);
  if (!dia) throw new ErroAplicacao('DIA_INEXISTENTE', 'dia não encontrado', 404);
  return dia;
}
