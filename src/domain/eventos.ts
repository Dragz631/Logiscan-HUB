/**
 * HISTÓRICO — eventos append-only.
 *
 * Todo acontecimento operacional relevante vira um evento. O estado atual do pacote
 * é só um resumo derivado (projeção): `aplicarEvento(pacote, evento) → pacote`.
 * Nada aqui apaga ou reescreve o passado.
 *
 * Idempotência: cada evento traz `chaveIdempotencia`. Receber o mesmo evento duas vezes
 * (ex.: retry do celular no futuro Street) não gera dois acontecimentos.
 */
import {
  type DadosPacote,
  type OrigemPacote,
  type Pacote,
  type Pendencia,
  limparDados,
  podeTransitar,
} from './pacote';

export type OrigemEvento = 'importacao' | 'hub' | 'street';

interface Base<T extends string, D> {
  id: string;
  pacoteId: string;
  tipo: T;
  dados: D;
  /** Quem fez (operador do HUB, ajudante, "sistema"). */
  ator: string;
  origem: OrigemEvento;
  /** Quando aconteceu no mundo real. */
  ocorridoEm: string;
  /** Quando o HUB gravou. */
  registradoEm: string;
  chaveIdempotencia: string;
}

export interface AjudanteRef {
  id: string;
  nome: string;
}

export type EventoImportado = Base<'IMPORTADO', {
  transportadora: string;
  codigo: string;
  dados: DadosPacote;
  origem: OrigemPacote;
  extractor: { nome: string; versao: string };
  destinoId: string | null;
  destinoCandidatos: string[];
}>;

/** O mesmo código chegou com dados diferentes e um humano decidiu. */
export type EventoConflitoResolvido = Base<'CONFLITO_RESOLVIDO', {
  decisao: 'manter_atual' | 'aceitar_novo';
  loteId: string;
  antes: DadosPacote;
  recebido: DadosPacote;
  /** Destino recalculado quando os dados novos foram aceitos. */
  destinoId?: string | null;
  destinoCandidatos?: string[];
}>;

export type EventoDestinoConfirmado = Base<'DESTINO_CONFIRMADO', { destinoId: string; anterior: string | null }>;

/** Primeira entrega do pacote a um ajudante: a responsabilidade passa a ser dele. */
export type EventoAtribuido = Base<'ATRIBUIDO', { ajudante: AjudanteRef }>;

/** Troca de responsável: o antigo fica registrado. */
export type EventoReatribuido = Base<'REATRIBUIDO', { de: AjudanteRef; para: AjudanteRef }>;

export type Evento =
  | EventoImportado
  | EventoConflitoResolvido
  | EventoDestinoConfirmado
  | EventoAtribuido
  | EventoReatribuido;

export type TipoEvento = Evento['tipo'];

/**
 * Tipos previstos para a integração com o Street / Esteira de Baixas.
 * Declarados para a arquitetura já conhecê-los; o domínio RECUSA enquanto não forem implementados.
 */
export const TIPOS_FUTUROS = [
  'SAIU_PARA_ROTA',
  'ENTREGA_REGISTRADA',
  'INSUCESSO_REGISTRADO',
  'PROVA_RECEBIDA',
  'RETORNADO_AO_GALPAO',
  'PRONTO_PARA_BAIXA',
  'BAIXADO',
] as const;

export class ErroDominio extends Error {
  constructor(public readonly codigo: string, mensagem: string) {
    super(mensagem);
    this.name = 'ErroDominio';
  }
}

function pendenciasDestino(destinoId: string | null, candidatos: string[]): Pendencia[] {
  return destinoId === null && candidatos.length > 0 ? ['DESTINO_A_CONFIRMAR'] : [];
}

/**
 * Aplica um evento sobre o estado atual e devolve o NOVO estado (não altera a entrada).
 * Recusa eventos que violam as regras (transição inválida, pacote inexistente…).
 */
export function aplicarEvento(atual: Pacote | null, e: Evento): Pacote {
  if (e.tipo === 'IMPORTADO') {
    if (atual) throw new ErroDominio('JA_EXISTE', `pacote ${atual.codigo} já existe no inventário`);
    const d = e.dados;
    return {
      id: e.pacoteId,
      transportadora: d.transportadora,
      codigo: d.codigo,
      dados: limparDados(d.dados),
      destinoId: d.destinoId,
      destinoCandidatos: d.destinoCandidatos,
      estado: 'NAO_ATRIBUIDO',
      responsavelId: null,
      pendencias: pendenciasDestino(d.destinoId, d.destinoCandidatos),
      origem: d.origem,
      criadoEm: e.ocorridoEm,
      atualizadoEm: e.registradoEm,
      versao: 1,
    };
  }

  if (!atual) throw new ErroDominio('PACOTE_INEXISTENTE', `evento ${e.tipo} para pacote inexistente`);
  if (atual.id !== e.pacoteId) throw new ErroDominio('PACOTE_ERRADO', 'evento não pertence a este pacote');
  const base = { ...atual, atualizadoEm: e.registradoEm, versao: atual.versao + 1 };

  switch (e.tipo) {
    case 'CONFLITO_RESOLVIDO': {
      if (e.dados.decisao === 'manter_atual') return base;
      const destinoId = e.dados.destinoId ?? null;
      const candidatos = e.dados.destinoCandidatos ?? [];
      return {
        ...base,
        dados: limparDados(e.dados.recebido),
        destinoId,
        destinoCandidatos: candidatos,
        pendencias: pendenciasDestino(destinoId, candidatos),
      };
    }
    case 'DESTINO_CONFIRMADO':
      return {
        ...base,
        destinoId: e.dados.destinoId,
        destinoCandidatos: [],
        pendencias: atual.pendencias.filter((p) => p !== 'DESTINO_A_CONFIRMAR'),
      };
    case 'ATRIBUIDO':
      if (atual.responsavelId !== null) {
        throw new ErroDominio('JA_TEM_RESPONSAVEL', 'pacote já tem responsável: use reatribuição');
      }
      if (!podeTransitar(atual.estado, 'ATRIBUIDO')) {
        throw new ErroDominio('TRANSICAO_INVALIDA', `não é possível atribuir um pacote em ${atual.estado}`);
      }
      return { ...base, estado: 'ATRIBUIDO', responsavelId: e.dados.ajudante.id };
    case 'REATRIBUIDO':
      if (atual.responsavelId !== e.dados.de.id) {
        throw new ErroDominio('RESPONSAVEL_DIVERGENTE', 'o responsável atual não é o informado como anterior');
      }
      if (e.dados.de.id === e.dados.para.id) throw new ErroDominio('MESMO_RESPONSAVEL', 'o pacote já está com esse ajudante');
      if (!podeTransitar(atual.estado, 'ATRIBUIDO')) {
        throw new ErroDominio('TRANSICAO_INVALIDA', `não é possível reatribuir um pacote em ${atual.estado}`);
      }
      return { ...base, estado: 'ATRIBUIDO', responsavelId: e.dados.para.id };
  }
}

/** Reconstrói o estado atual a partir do histórico (prova de que a projeção é derivada). */
export function reconstruir(eventos: Evento[]): Pacote | null {
  return eventos.reduce<Pacote | null>((p, e) => aplicarEvento(p, e), null);
}

/** Texto humano da timeline. */
export function descreverEvento(e: Evento, nomeDestino?: (id: string) => string): string {
  switch (e.tipo) {
    case 'IMPORTADO': {
      const o = e.dados.origem;
      const card = o.card === null ? '' : `, card ${o.card + 1}`;
      return `Importado da ${e.dados.transportadora} (${o.arquivo}${card}) via ${e.dados.extractor.nome} ${e.dados.extractor.versao}`;
    }
    case 'CONFLITO_RESOLVIDO':
      return e.dados.decisao === 'aceitar_novo'
        ? 'Dados divergentes recebidos: dados novos ACEITOS'
        : 'Dados divergentes recebidos: dados atuais MANTIDOS';
    case 'DESTINO_CONFIRMADO':
      return `Destino confirmado: ${nomeDestino ? nomeDestino(e.dados.destinoId) : e.dados.destinoId}`;
    case 'ATRIBUIDO':
      return `Entregue ao ajudante ${e.dados.ajudante.nome} (responsabilidade transferida)`;
    case 'REATRIBUIDO':
      return `Reatribuído: ${e.dados.de.nome} → ${e.dados.para.nome} (responsabilidade transferida)`;
  }
}
