/**
 * CONFIRMAÇÃO DA ENTREGA — separada do status operacional.
 *
 *   status operacional: ENTREGUE   (o Street registrou o acontecimento)
 *   confirmação:        INCOMPLETA (ainda faltam requisitos para a baixa)
 *
 * Entrega REGISTRADA ≠ entrega CONFIRMADA. PRONTO_PARA_BAIXA só é possível com a confirmação COMPLETA,
 * e isso depende das provas (fotos), que ainda não existem nesta etapa — então hoje toda entrega fica INCOMPLETA.
 * A Esteira de Baixas (futura) usa `podeFicarProntoParaBaixa`; nada aqui leva um pacote a PRONTO_PARA_BAIXA.
 */
import type { Pacote } from './pacote';

export const REQUISITOS_BAIXA = [
  'nome_recebedor',
  'tipo_recebedor',
  'foto_pacote',
  'foto_local',
  'horario',
] as const;
export type RequisitoBaixa = (typeof REQUISITOS_BAIXA)[number];

export const ROTULO_REQUISITO: Record<RequisitoBaixa, string> = {
  nome_recebedor: 'nome de quem recebeu',
  tipo_recebedor: 'tipo/relação do recebedor',
  foto_pacote: 'foto do pacote',
  foto_local: 'foto do local',
  horario: 'horário da entrega',
};

export interface ConfirmacaoEntrega {
  status: 'INCOMPLETA' | 'COMPLETA';
  faltando: RequisitoBaixa[];
}

export interface EvidenciasEntrega {
  recebedor: { tipo: string; detalhes: string } | null;
  ocorridoEm: string | null;
  /** Provas vinculadas à entrega (a Esteira vai preencher; hoje o Street não envia fotos). */
  provas: { fotoPacote: boolean; fotoLocal: boolean };
}

/**
 * "Pacote correto" e "vínculo com o pacote" já são garantidos antes daqui: o HUB só aceita
 * a entrega se o pacote está na carga, com o ajudante e em rota.
 */
export function avaliarEntrega(ev: EvidenciasEntrega): ConfirmacaoEntrega {
  const faltando: RequisitoBaixa[] = [];
  if (!ev.recebedor?.detalhes.trim()) faltando.push('nome_recebedor');
  if (!ev.recebedor?.tipo.trim()) faltando.push('tipo_recebedor');
  if (!ev.provas.fotoPacote) faltando.push('foto_pacote');
  if (!ev.provas.fotoLocal) faltando.push('foto_local');
  if (!ev.ocorridoEm || Number.isNaN(Date.parse(ev.ocorridoEm))) faltando.push('horario');
  return { status: faltando.length ? 'INCOMPLETA' : 'COMPLETA', faltando };
}

/** Porta de entrada da futura Esteira: sem confirmação COMPLETA, não há baixa. */
export function podeFicarProntoParaBaixa(p: Pick<Pacote, 'estado' | 'confirmacaoEntrega'>): boolean {
  return p.estado === 'ENTREGUE' && p.confirmacaoEntrega?.status === 'COMPLETA';
}
