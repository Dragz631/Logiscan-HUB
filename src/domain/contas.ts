/**
 * CONTAS — quem entra no HUB ou no Street.
 *
 * A conta nasce PENDENTE (pedido feito no Street) e só o master aprova, definindo o papel:
 *   AJUDANTE        só recebe rota e faz as entregas no Street;
 *   ADMIN           vê e opera o HUB (repasses, caixas, Novo dia…);
 *   ADMIN_AJUDANTE  os dois (o Hugo: extrai pacotes, repassa e também sai para entregar).
 * Sem papel aprovado, a conta não vê NADA, mesmo que entre.
 */
export type Papel = 'AJUDANTE' | 'ADMIN' | 'ADMIN_AJUDANTE';
export type SituacaoConta = 'PENDENTE' | 'APROVADA' | 'RECUSADA';

export const PAPEIS: readonly Papel[] = ['AJUDANTE', 'ADMIN', 'ADMIN_AJUDANTE'];
export const SUFIXO_USUARIO = '@logiscan.log';

export interface Conta {
  id: string;
  usuario: string;
  nome: string;
  telefone: string | null;
  veiculo: string | null;
  /** scrypt$N$r$p$sal$hash. NULL = ainda sem PIN (master antes do primeiro acesso). */
  pinHash: string | null;
  situacao: SituacaoConta;
  papel: Papel | null;
  master: boolean;
  ajudanteId: string | null;
  ativacaoHash: string | null;
  ativacaoExpiraEm: string | null;
  tentativas: number;
  bloqueadaAte: string | null;
  criadaEm: string;
  decididaEm: string | null;
  decididaPor: string | null;
}

/** O que sai da API: nunca hash de PIN, nunca código de ativação. */
export type ContaPublica = Omit<Conta, 'pinHash' | 'ativacaoHash' | 'ativacaoExpiraEm'> & { temPin: boolean };

export interface Sessao {
  tokenHash: string;
  renovarHash: string;
  contaId: string;
  criadaEm: string;
  expiraEm: string;
  renovarExpiraEm: string;
  revogadaEm: string | null;
}

export interface EventoConta {
  id: string;
  contaId: string;
  tipo: 'CONTA_CRIADA' | 'CONTA_APROVADA' | 'CONTA_RECUSADA' | 'PAPEL_ALTERADO' | 'PIN_DEFINIDO' | 'MASTER_CRIADA';
  dados: Record<string, unknown>;
  ator: string;
  ocorridoEm: string;
}

export const temAdmin = (p: Papel | null) => p === 'ADMIN' || p === 'ADMIN_AJUDANTE';
export const temAjudante = (p: Papel | null) => p === 'AJUDANTE' || p === 'ADMIN_AJUDANTE';

export function publica(c: Conta): ContaPublica {
  const { pinHash, ativacaoHash: _a, ativacaoExpiraEm: _e, ...resto } = c;
  return { ...resto, temPin: pinHash !== null };
}

/** "Hugo DZ Log@logiscan.log" → "hugodzlog": minúsculo, sem acento, sem espaço, sem o sufixo. */
export function normalizarUsuario(bruto: string): string {
  let u = bruto.trim().toLowerCase();
  if (u.endsWith(SUFIXO_USUARIO)) u = u.slice(0, -SUFIXO_USUARIO.length);
  return u
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '');
}

/** Devolve o motivo da recusa, ou null se o usuário é válido. */
export function erroDeUsuario(usuario: string): string | null {
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) return 'o usuário deve ter de 3 a 30 letras (sem acento), números, ponto, traço ou sublinhado';
  return null;
}

export const PIN_VALIDO = /^\d{6}$/;
