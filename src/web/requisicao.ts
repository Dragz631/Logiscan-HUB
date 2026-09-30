/**
 * Requisição HTTP ao HUB com falhas CLASSIFICADAS — nunca misturar os tipos:
 *   conexao    → a requisição nem chegou ao HUB (servidor parado, rede, navegador sem recursos).
 *                É o "Failed to fetch" do navegador. NÃO tem nada a ver com o conteúdo enviado.
 *   servidor   → o HUB respondeu com erro interno (HTTP 5xx).
 *   requisicao → o HUB recusou o pedido (HTTP 4xx, ex.: arquivo grande demais, dado inválido).
 * Erro de CONTRATO (HTTP 422) não é exceção: volta como resposta para a tela mostrar campo a campo.
 */

import { cabecalhoDeAutorizacao, lerSessao, tentarRenovar } from './sessao';

export type TipoFalha = 'conexao' | 'servidor' | 'requisicao';

export class ErroApi extends Error {
  constructor(
    public readonly tipo: TipoFalha,
    mensagem: string,
    public readonly status: number | null = null,
    public readonly codigo: string | null = null,
    /** Corpo inteiro da resposta de erro (ex.: `ate` no bloqueio por tentativas). */
    public readonly dados: Record<string, unknown> | null = null,
  ) {
    super(mensagem);
    this.name = 'ErroApi';
  }
}

export const TITULO_FALHA: Record<TipoFalha, string> = {
  conexao: 'Sem conexão com o HUB',
  servidor: 'Erro interno do servidor do HUB',
  requisicao: 'O HUB recusou o pedido',
};

export async function requisitar<T>(
  url: string,
  init?: { method?: string; body?: unknown },
  aceitarStatus: number[] = [],
  jaRenovou = false,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
      headers: { ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...cabecalhoDeAutorizacao() },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    const onde = (() => {
      try {
        return new URL(url, typeof location !== 'undefined' ? location.href : undefined).origin;
      } catch {
        return url;
      }
    })();
    throw new ErroApi(
      'conexao',
      `O HUB não respondeu em ${onde}. Confira se o servidor do HUB está rodando e tente de novo. ` +
        `Nada foi enviado nem gravado. (navegador: ${(e as Error).message})`,
    );
  }

  const texto = await res.text();
  let dados: unknown = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = null;
  }
  if (res.ok || aceitarStatus.includes(res.status)) return dados as T;

  const corpo = (dados ?? {}) as { mensagem?: string; erro?: string; codigo?: string };
  // Token vencido (1 h): renova sozinho UMA vez e repete o pedido; se não der, a tela volta ao login.
  if (res.status === 401 && corpo.codigo === 'SESSAO_INVALIDA' && !jaRenovou && lerSessao() && (await tentarRenovar())) {
    return requisitar<T>(url, init, aceitarStatus, true);
  }
  if (res.status === 401 && corpo.codigo === 'SESSAO_INVALIDA' && lerSessao() && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('hub:sessao-expirada'));
  }
  const detalhe = corpo.mensagem ?? (texto ? texto.slice(0, 200) : res.statusText);
  throw new ErroApi(res.status >= 500 ? 'servidor' : 'requisicao', `HTTP ${res.status}: ${detalhe}`, res.status, corpo.erro ?? null, dados as Record<string, unknown> | null);
}
