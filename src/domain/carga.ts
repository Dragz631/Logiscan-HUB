/**
 * CARGA — o conjunto de pacotes que um ajudante leva para a rua numa saída.
 *
 * CARGA ≠ PACOTE: a carga tem identidade, dono (ajudante), horários e histórico PRÓPRIOS;
 * cada pacote continua com a sua timeline (o evento SAIU_PARA_ROTA aponta para a carga).
 *
 * Situação da carga:
 *   MONTADA   → criada, pacotes separados para o ajudante, ainda no galpão (ATRIBUIDOS);
 *   EM_ROTA   → o operador INICIOU A ROTA (ação explícita, com horário próprio);
 *   CONCLUIDA → rota iniciada e todos os pacotes com desfecho (entregue ou insucesso) — derivado;
 *   FINALIZADA→ o operador FINALIZOU a rota (ação explícita). Só aí a carga deixa de ser ativa.
 * Um ajudante tem no máximo UMA carga ativa (não finalizada); um pacote, no máximo uma carga ativa.
 * Criar a carga NUNCA é evidência de que o ajudante saiu para a rua.
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
  /** Quando/quem iniciou a rota. null = carga só montada. */
  rotaIniciadaEm: string | null;
  rotaIniciadaPor: string | null;
  finalizadaEm: string | null;
  finalizadaPor: string | null;
}

export interface RuaRef {
  chave: string;
  nome: string;
  quantidade: number;
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
  | BaseEventoCarga<'CARGA_CRIADA', {
      ajudante: AjudanteRef;
      quantidade: number;
      /** Carga nascida de um REPASSE NA HORA: de qual rota veio. */
      repassadaDe?: { carga: { id: string; codigo: string }; ajudante: AjudanteRef; motivo: string };
    }>
  | BaseEventoCarga<'RUAS_ADICIONADAS', { ruas: RuaRef[]; chave?: string }>
  | BaseEventoCarga<'RUA_REMOVIDA', { rua: RuaRef; motivo: 'removida' | 'reatribuida'; para?: AjudanteRef }>
  | BaseEventoCarga<'ROTA_INICIADA', { quantidade: number; repasse?: boolean }>
  | BaseEventoCarga<'ROTA_FINALIZADA', { entregues: number; insucessos: number; pendentes?: number; diaId?: string }>
  /** Novo dia: carga montada que nem saiu foi desfeita; os pacotes voltaram para a caixa. */
  | BaseEventoCarga<'CARGA_DESFEITA', { quantidade: number; diaId: string }>
  /** Repasse na hora: parte da rota passou para outro ajudante (carga nova). */
  | BaseEventoCarga<'ROTA_REPASSADA', {
      para: AjudanteRef;
      paraCarga: { id: string; codigo: string };
      pacotes: number;
      caixas: RuaRef[];
      motivo: string;
      chave: string;
    }>
  | BaseEventoCarga<'RECEBIDA_NO_STREET', { ajudante: AjudanteRef; quantidade: number }>
  | BaseEventoCarga<'CARGA_EXPORTADA', { arquivo: string }>
  | BaseEventoCarga<'RETORNO_RECEBIDO', {
      arquivo: string;
      aceitos: number;
      repetidos: number;
      recusados: { idEventoStreet: string; codigo: string; motivo: string }[];
    }>;

export type SituacaoCarga = 'MONTADA' | 'EM_ROTA' | 'CONCLUIDA' | 'FINALIZADA';

const DESFECHO: EstadoPacote[] = ['ENTREGUE', 'INSUCESSO', 'RETORNADO', 'DEVOLVIDO', 'PRONTO_PARA_BAIXA', 'BAIXADO'];

export const ESTADOS_DESFECHO = DESFECHO;

export function situacaoCarga(rotaIniciadaEm: string | null, estados: EstadoPacote[], finalizadaEm: string | null = null): SituacaoCarga {
  if (finalizadaEm) return 'FINALIZADA';
  if (!rotaIniciadaEm) return 'MONTADA';
  return estados.length > 0 && estados.every((e) => DESFECHO.includes(e)) ? 'CONCLUIDA' : 'EM_ROTA';
}

/** "C-20260924-HUGO-2": data local de São Paulo + nome do ajudante + sequência do dia. */
export function codigoCarga(agoraIso: string, nomeAjudante: string, sequenciaNoDia: number): string {
  return `${prefixoCarga(agoraIso, nomeAjudante)}${sequenciaNoDia}`;
}

/** Dia (AAAA-MM-DD) no fuso de São Paulo: é o "dia" da operação. */
export function dataSP(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
}

/** "C-20260924-HUGO-" (sem a sequência). */
export function prefixoCarga(agoraIso: string, nomeAjudante: string): string {
  const dia = dataSP(agoraIso).replace(/-/g, '');
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
      return e.dados.repassadaDe
        ? `Repasse do ${e.dados.repassadaDe.ajudante.nome} para ${e.dados.ajudante.nome}: carga nova com ${e.dados.quantidade} pacote(s) da rota ${e.dados.repassadaDe.carga.codigo}${e.dados.repassadaDe.motivo ? ` — ${e.dados.repassadaDe.motivo}` : ''}`
        : `Carga montada para ${e.dados.ajudante.nome} com ${e.dados.quantidade} pacote(s)`;
    case 'RUAS_ADICIONADAS':
      return `Rua(s) atribuída(s): ${e.dados.ruas.map((r) => `${r.nome} (${r.quantidade})`).join(', ')}`;
    case 'RUA_REMOVIDA':
      return e.dados.motivo === 'reatribuida'
        ? `${e.dados.rua.nome} (${e.dados.rua.quantidade}) reatribuída para ${e.dados.para?.nome}`
        : `${e.dados.rua.nome} (${e.dados.rua.quantidade}) removida da carga — pacotes voltaram ao galpão`;
    case 'ROTA_FINALIZADA':
      return e.dados.diaId
        ? `Novo dia: rota encerrada com ${e.dados.entregues} entregue(s)${e.dados.pendentes ? `, ${e.dados.pendentes} não entregue(s) (voltaram à caixa ou ao galpão)` : ''}`
        : `Rota finalizada: ${e.dados.entregues} entregue(s), ${e.dados.insucessos} insucesso(s)`;
    case 'CARGA_DESFEITA':
      return `Novo dia: carga montada desfeita — ${e.dados.quantidade} pacote(s) voltaram para as caixas`;
    case 'ROTA_REPASSADA':
      return `Repasse de rota: ${e.dados.pacotes} pacote(s) em ${e.dados.caixas.length} caixa(s) passaram para ${e.dados.para.nome} (carga ${e.dados.paraCarga.codigo})${e.dados.motivo ? ` — ${e.dados.motivo}` : ''}`;
    case 'RECEBIDA_NO_STREET':
      return `Carga recebida no Street pelo perfil de ${e.dados.ajudante.nome} (${e.dados.quantidade} pacote(s))`;
    case 'ROTA_INICIADA':
      return e.dados.repasse
        ? `Rota assumida por repasse: ${e.dados.quantidade} pacote(s) já estão na rua`
        : `Rota iniciada: ${e.dados.quantidade} pacote(s) saíram para a rua`;
    case 'CARGA_EXPORTADA':
      return `Arquivo da carga gerado para o Street (${e.dados.arquivo})`;
    case 'RETORNO_RECEBIDO': {
      const d = e.dados;
      const partes = [`${d.aceitos} acontecimento(s) registrado(s)`];
      if (d.repetidos) partes.push(`${d.repetidos} repetido(s) ignorado(s)`);
      if (d.recusados.length) partes.push(`${d.recusados.length} recusado(s)`);
      return `Retorno do Street recebido (${d.arquivo}): ${partes.join(', ')}`;
    }
  }
}
