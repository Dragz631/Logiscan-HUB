/** Cliente da API do HUB. A tela só conversa com o backend por aqui. */
import type { DetalheCarga, ResultadoRetorno, ResumoCarga } from '../application/cargas';
import type { DadosPerfil, DetalhePerfil, ResumoPerfil, RuaNoOrquestrador, UnidadeRepasse } from '../application/orquestracao';
import type { RegiaoComRuas, ResultadoDefinicao } from '../application/regioes';
import type { PacoteTriagem, ResultadoClassificacao, VisaoTriagem } from '../application/triagem';
import type { PreviaNovoDia } from '../application/novoDia';
import type { PendenciasDaRota, ResultadoRepasseRota } from '../application/repasseRota';
import type { Dia } from '../domain/dias';
import type { Regiao } from '../domain/regioes';
import type { DocumentoCargaV0 } from '../contracts/cargaV0';
import type { Pacote } from '../domain/pacote';
import type { DetalhePacote, LinhaInventario, ResumoInventario } from '../application/consultas';
import type { ResultadoConfirmacao, ResultadoPreparo, VisaoLote } from '../application/importacao';
import type { ResultadoAtribuicaoItem } from '../application/operacao';
import type { Ajudante, Lote } from '../application/portas';
import type { DecisaoConflito } from '../domain/importacao';
import type { ContaPublica, Papel } from '../domain/contas';
import type { PerfilDaSessao } from './sessao';

import { requisitar } from './requisicao';

export { ErroApi, TITULO_FALHA, type TipoFalha } from './requisicao';

/** 422 = recusa por CONTRATO: volta como resposta (a tela mostra campo a campo), não como falha de rede/servidor. */
function chamar<T>(caminho: string, init?: { method?: string; body?: unknown }): Promise<T> {
  return requisitar<T>(`/api${caminho}`, init, [422]);
}

export const novaChave = () => crypto.randomUUID();

export const api = {
  // ---- Login e contas ----
  eu: () => chamar<{ semLogin: true } | { semLogin: false; perfil: PerfilDaSessao }>('/eu'),
  entrar: (usuario: string, pin: string) =>
    chamar<{ token: string; renovar: string; perfil: PerfilDaSessao }>('/street/login', { body: { usuario, pin } }),
  primeiroAcesso: (usuario: string, codigo: string, pin: string) =>
    chamar<{ ok: true }>('/street/primeiro-acesso', { body: { usuario, codigo, pin } }),
  sair: () => chamar<{ ok: true }>('/street/sair', { body: {} }),
  contas: () => chamar<ContaPublica[]>('/contas'),
  aprovarConta: (id: string, como: Papel, ligacao: { ajudanteId?: string; criarPerfilNovo?: boolean }) =>
    chamar<ContaPublica>(`/contas/${id}/aprovar`, { body: { como, ...ligacao } }),
  recusarConta: (id: string) => chamar<ContaPublica>(`/contas/${id}/recusar`, { body: {} }),

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
  criarPerfil: (d: DadosPerfil) => chamar<Ajudante>('/ajudantes', { body: d }),
  editarPerfil: (id: string, d: DadosPerfil) => chamar<Ajudante>(`/ajudantes/${id}`, { method: 'PUT', body: d }),
  perfil: (id: string) => chamar<DetalhePerfil>(`/perfis/${id}`),
  orquestrador: () =>
    chamar<{
      ruas: RuaNoOrquestrador[];
      unidades: UnidadeRepasse[];
      perfis: ResumoPerfil[];
      regioes: Regiao[];
      aguardandoRevisao: { pacotes: number; ruas: number };
    }>('/orquestrador'),
  previaNovoDia: () => chamar<PreviaNovoDia>('/novo-dia/previa'),
  encerrarDia: (destinos: Record<string, 'amanha' | 'galpao'>, historico: boolean, ator: string, chave: string, destinoSemResponsavel?: 'amanha' | 'galpao') =>
    chamar<{ dia: Dia; jaEncerrado: boolean }>('/novo-dia', { body: { destinos, historico, ator, chave, destinoSemResponsavel } }),
  dias: () => chamar<Dia[]>('/dias'),
  pendenciasDaRota: (cargaId: string) => chamar<PendenciasDaRota>(`/cargas/${cargaId}/pendencias-da-rota`),
  repassarRota: (cargaId: string, paraAjudanteId: string, caixas: string[] | undefined, motivo: string, ator: string) =>
    chamar<ResultadoRepasseRota>(`/cargas/${cargaId}/repassar-rota`, {
      body: { paraAjudanteId, caixas, motivo, ator, chave: novaChave() },
    }),
  triagem: () => chamar<VisaoTriagem>('/triagem'),
  pacotesDaCaixa: (caixaId: string) => chamar<PacoteTriagem[]>(`/triagem/caixas/${caixaId}`),
  classificarRua: (rua: string, caixaId: string, ator: string, substituir = false) =>
    chamar<ResultadoDefinicao>('/triagem/rua', { body: { rua, caixaId, ator, substituir } }),
  classificarPacote: (pacoteId: string, caixaId: string, ator: string, substituir = false, motivo?: string) =>
    chamar<ResultadoClassificacao>('/triagem/pacote', { body: { pacoteId, caixaId, ator, substituir, ...(motivo ? { motivo } : {}) } }),
  criarRegiao: (nome: string, ator: string, repasseUnico = false) => chamar<Regiao>('/regioes', { body: { nome, ator, repasseUnico } }),
  definirRegiao: (rua: string, regiaoId: string | null, ator: string, substituir = false, prioridade?: number | null) =>
    chamar<ResultadoDefinicao>('/regioes/definir', {
      body: { rua, regiaoId, ator, substituir, ...(prioridade !== undefined ? { prioridade } : {}) },
    }),
  mapaRegioes: () => chamar<{ regioes: RegiaoComRuas[]; semRegiao: RegiaoComRuas['ruas'] }>('/regioes'),
  atribuirRuas: (ajudanteId: string, ruas: string[], ator: string) =>
    chamar<{ carga: { id: string; codigo: string }; pacotes: number; ruas: { chave: string; nome: string; quantidade: number }[]; deFora: { rua: string; com: string; pacotes: number }[] }>('/orquestrador/atribuir', {
      body: { ajudanteId, ruas, ator, chave: novaChave() },
    }),
  confirmarRepasses: (repasses: { ajudanteId: string; ruas: string[] }[], ator: string) =>
    chamar<{ cargas: { ajudante: string; codigo: string; pacotes: number; ruas: number }[] }>('/orquestrador/repasses', {
      body: { repasses, ator, chave: novaChave() },
    }),
  lotesResumo: () => chamar<{ status: string }[]>('/importacoes'),
  removerRua: (cargaId: string, rua: string, ator: string, paraAjudanteId?: string) =>
    chamar<{ pacotes: number }>(`/cargas/${cargaId}/remover-rua`, { body: { rua, ator, paraAjudanteId } }),
  finalizarRota: (cargaId: string, ator: string) => chamar<{ jaFinalizada: boolean }>(`/cargas/${cargaId}/finalizar`, { body: { ator } }),
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
