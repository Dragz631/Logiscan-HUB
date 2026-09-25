/**
 * CARGA — o conjunto de pacotes que um ajudante leva para a rua numa saída.
 *
 * CARGA ≠ PACOTE: a carga tem identidade, dono (ajudante), horários e histórico PRÓPRIOS;
 * cada pacote continua com a sua timeline (o evento SAIU_PARA_ROTA aponta para a carga).
 *
 * Situação da carga é DERIVADA dos pacotes (nunca guardada à parte, para não divergir):
 *   EM_ROTA   → ainda há pacote dela na rua;
 *   CONCLUIDA → todos os pacotes dela já tiveram desfecho.
 */
import type { AjudanteRef } from './eventos';
import type { EstadoPacote } from './pacote';

export interface Carga {
  id: string;
  /** Código curto e legível, ex.: "C-20260924-HUGO-1". */
  codigo: string;
  ajudante: AjudanteRef;
  pacoteIds: string[];
  criadaEm: string;
  criadaPor: string;
}

interface BaseEventoCarga<T extends string, D> {
  id: string;
  cargaId: string;
  tipo: T;
  dados: D;
  ator: string;
  ocorridoEm: string;
  registradoEm: string;
}

export type EventoCarga =
  | BaseEventoCarga<'CARGA_CRIADA', { ajudante: AjudanteRef; quantidade: number }>
  | BaseEventoCarga<'CARGA_EXPORTADA', { arquivo: string }>
  | BaseEventoCarga<'RETORNO_RECEBIDO', {
      arquivo: string;
      aceitos: number;
      repetidos: number;
      recusados: { idEventoStreet: string; codigo: string; motivo: string }[];
    }>;

export type SituacaoCarga = 'EM_ROTA' | 'CONCLUIDA';

const DESFECHO: EstadoPacote[] = ['ENTREGUE', 'RETORNADO', 'PRONTO_PARA_BAIXA', 'BAIXADO'];

export function situacaoCarga(estados: EstadoPacote[]): SituacaoCarga {
  return estados.length > 0 && estados.every((e) => DESFECHO.includes(e)) ? 'CONCLUIDA' : 'EM_ROTA';
}

/** "C-20260924-HUGO-2": data local de São Paulo + nome do ajudante + sequência do dia. */
export function codigoCarga(agoraIso: string, nomeAjudante: string, sequenciaNoDia: number): string {
  return `${prefixoCarga(agoraIso, nomeAjudante)}${sequenciaNoDia}`;
}

/** "C-20260924-HUGO-" (sem a sequência). */
export function prefixoCarga(agoraIso: string, nomeAjudante: string): string {
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(agoraIso)).replace(/-/g, '');
  const nome =
    nomeAjudante
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, 10) || 'AJUDANTE';
  return `C-${dia}-${nome}-`;
}

export function descreverEventoCarga(e: EventoCarga): string {
  switch (e.tipo) {
    case 'CARGA_CRIADA':
      return `Carga criada para ${e.dados.ajudante.nome} com ${e.dados.quantidade} pacote(s)`;
    case 'CARGA_EXPORTADA':
      return `Arquivo da carga gerado para o Street (${e.dados.arquivo})`;
    case 'RETORNO_RECEBIDO': {
      const d = e.dados;
      const partes = [`${d.aceitos} evento(s) registrado(s)`];
      if (d.repetidos) partes.push(`${d.repetidos} repetido(s) ignorado(s)`);
      if (d.recusados.length) partes.push(`${d.recusados.length} recusado(s)`);
      return `Retorno do Street recebido (${d.arquivo}): ${partes.join(', ')}`;
    }
  }
}
