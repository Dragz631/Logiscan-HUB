/** Formatação de exibição (só apresentação — nenhuma regra de negócio). */
import type { EstadoPacote } from '../domain/pacote';
import type { DadosPacote } from '../domain/pacote';

const fmtData = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export const dataHora = (iso: string | null | undefined) => (iso ? fmtData.format(new Date(iso)) : '—');

export const ROTULO_ESTADO: Record<EstadoPacote, string> = {
  NAO_ATRIBUIDO: 'Sem responsável',
  ATRIBUIDO: 'Com ajudante',
  EM_ROTA: 'Em rota',
  ENTREGUE: 'Entregue',
  INSUCESSO: 'Insucesso',
  RETORNADO: 'Retornado',
  PRONTO_PARA_BAIXA: 'Pronto p/ baixa',
  BAIXADO: 'Baixado',
};

export const enderecoCurto = (d: DadosPacote) =>
  [d.rua, d.numero || 'S/N', d.complemento].filter(Boolean).join(', ');
