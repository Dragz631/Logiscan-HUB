/**
 * Sessão do navegador no HUB com login (Vercel). Guarda o token e o "renovar" deste aparelho; quando o token vence
 * (1 h), renova sozinho UMA vez e repete o pedido; se não der, pede login de novo. Nada de dado operacional aqui.
 */
export interface PerfilDaSessao {
  id: string | null;
  nome: string;
  papel: 'AJUDANTE' | 'ADMIN' | 'ADMIN_AJUDANTE';
  master: boolean;
}

export interface SessaoWeb {
  token: string;
  renovar: string;
  perfil: PerfilDaSessao;
}

const CHAVE = 'hub.sessao';

export function lerSessao(): SessaoWeb | null {
  try {
    const bruto = typeof localStorage === 'undefined' ? null : localStorage.getItem(CHAVE);
    return bruto ? (JSON.parse(bruto) as SessaoWeb) : null;
  } catch {
    return null;
  }
}

export function gravarSessao(s: SessaoWeb): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(s));
  } catch {
    /* sem armazenamento: a sessão vale só enquanto a aba estiver aberta */
  }
}

export function limparSessao(): void {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    /* nada */
  }
}

export function cabecalhoDeAutorizacao(): Record<string, string> {
  const s = lerSessao();
  return s ? { Authorization: `Bearer ${s.token}` } : {};
}

let renovando: Promise<boolean> | null = null;

/** Troca o par token/renovar. Um pedido por vez (vários pedidos vencidos juntos não gastam o mesmo "renovar"). */
export function tentarRenovar(): Promise<boolean> {
  renovando ??= (async () => {
    const atual = lerSessao();
    if (!atual) return false;
    try {
      const r = await fetch('/api/street/renovar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ renovar: atual.renovar }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const novo = (await r.json()) as { token: string; renovar: string };
      gravarSessao({ ...atual, token: novo.token, renovar: novo.renovar });
      return true;
    } catch {
      limparSessao();
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('hub:sessao-expirada'));
      return false;
    } finally {
      setTimeout(() => {
        renovando = null;
      }, 0);
    }
  })();
  return renovando;
}
