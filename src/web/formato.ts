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

/** "2026-09-26" → "26/09". */
export const diaCurto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Quando o Street do perfil apareceu pela última vez: "Street visto há 3 min" / "Street nunca conectou". */
export function streetVisto(iso: string | null | undefined, agora = Date.now()): string {
  if (!iso) return 'Street nunca conectou';
  const min = Math.max(0, Math.round((agora - Date.parse(iso)) / 60_000));
  if (min < 1) return 'Street visto agora';
  if (min < 60) return `Street visto há ${min} min`;
  if (min < 24 * 60) return `Street visto há ${Math.round(min / 60)} h`;
  return `Street visto há ${Math.round(min / (24 * 60))} d`;
}

export const ROTULO_ESTADO: Record<EstadoPacote, string> = {
  NAO_ATRIBUIDO: 'Sem responsável',
  ATRIBUIDO: 'Com ajudante',
  EM_ROTA: 'Em rota',
  ENTREGUE: 'Entregue',
  INSUCESSO: 'Insucesso',
  RETORNADO: 'Retornado',
  DEVOLVIDO: 'Devolvido ao galpão',
  PRONTO_PARA_BAIXA: 'Pronto p/ baixa',
  BAIXADO: 'Baixado',
};

export const enderecoCurto = (d: DadosPacote) =>
  [d.rua, d.numero || 'S/N', d.complemento].filter(Boolean).join(', ');
