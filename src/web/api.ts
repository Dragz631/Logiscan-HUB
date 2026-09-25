/** Cliente da API do HUB. A tela só conversa com o backend por aqui. */
import type { DetalheCarga, ResultadoRetorno, ResumoCarga } from '../application/cargas';
import type { DocumentoCargaV0 } from '../contracts/cargaV0';
import type { Pacote } from '../domain/pacote';
import type { DetalhePacote, LinhaInventario, ResumoInventario } from '../application/consultas';
import type { ResultadoConfirmacao, ResultadoPreparo, VisaoLote } from '../application/importacao';
import type { ResultadoAtribuicaoItem } from '../application/operacao';
import type { Ajudante, Lote } from '../application/portas';
import type { DecisaoConflito } from '../domain/importacao';

export class ErroApi extends Error {}

async function chamar<T>(caminho: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${caminho}`, {
    method: init?.method ?? (init?.body ? 'POST' : 'GET'),
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 422) throw new ErroApi(dados.mensagem ?? `erro ${res.status}`);
  return dados as T;
}

export const novaChave = () => crypto.randomUUID();

export const api = {
  resumo: () => chamar<ResumoInventario>('/resumo'),
  pacotes: (filtro: Record<string, string>) => {
    const q = new URLSearchParams(Object.entries(filtro).filter(([, v]) => v)).toString();
    return chamar<LinhaInventario[]>(`/pacotes${q ? `?${q}` : ''}`);
  },
  pacote: (id: string) => chamar<DetalhePacote>(`/pacotes/${id}`),
  entregar: (pacoteIds: string[], ajudanteId: string, ator: string) =>
    chamar<ResultadoAtribuicaoItem[]>('/pacotes/entregar', { body: { pacoteIds, ajudanteId, ator, chave: novaChave() } }),
  confirmarDestino: (id: string, destinoId: string | null, ator: string) =>
    chamar<DetalhePacote>(`/pacotes/${id}/destino`, { body: { destinoId, ator, chave: novaChave() } }),
  ajudantes: () => chamar<Ajudante[]>('/ajudantes'),
  cadastrarAjudante: (nome: string) => chamar<Ajudante>('/ajudantes', { body: { nome } }),
  lotes: () => chamar<Omit<Lote, 'documento'>[]>('/importacoes'),
  importar: (arquivo: string, conteudo: string) => chamar<ResultadoPreparo>('/importacoes', { body: { arquivo, conteudo } }),
  lote: (id: string) => chamar<VisaoLote>(`/importacoes/${id}`),
  decidir: (id: string, indice: number, decisao: DecisaoConflito) =>
    chamar<VisaoLote>(`/importacoes/${id}/itens/${indice}/decisao`, { body: { decisao } }),
  confirmar: (id: string, ator: string) => chamar<ResultadoConfirmacao>(`/importacoes/${id}/confirmar`, { body: { ator } }),
  prontosParaCarga: (ajudanteId: string) => chamar<Pacote[]>(`/ajudantes/${ajudanteId}/prontos-para-carga`),
  cargas: () => chamar<ResumoCarga[]>('/cargas'),
  carga: (id: string) => chamar<DetalheCarga>(`/cargas/${id}`),
  criarCarga: (ajudanteId: string, pacoteIds: string[], ator: string) =>
    chamar<{ id: string; codigo: string }>('/cargas', { body: { ajudanteId, pacoteIds, ator } }),
  iniciarRota: (id: string, ator: string) =>
    chamar<{ jaIniciada: boolean; rotaIniciadaEm: string }>(`/cargas/${id}/iniciar-rota`, { body: { ator } }),
  exportarCarga: (id: string, ator: string) =>
    chamar<{ arquivo: string; documento: DocumentoCargaV0 }>(`/cargas/${id}/exportar`, { body: { ator } }),
  receberRetorno: (arquivo: string, conteudo: string) =>
    chamar<ResultadoRetorno | { ok: false; erros: string[] }>('/retornos-street', { body: { arquivo, conteudo } }),
  descartar: (id: string) => chamar<VisaoLote>(`/importacoes/${id}/descartar`, { method: 'POST', body: {} }),
};
