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
import { avaliarEntrega } from './confirmacao';
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

export interface CargaRef {
  id: string;
  codigo: string;
}

/** O pacote entrou numa carga MONTADA (continua no galpão, ATRIBUIDO). */
export type EventoIncluidoEmCarga = Base<'INCLUIDO_EM_CARGA', { carga: CargaRef; ajudante: AjudanteRef }>;

/** Saiu de uma carga MONTADA antes da rota (rua removida/reatribuída). Continua com o mesmo responsável. */
export type EventoRetiradoDaCarga = Base<'RETIRADO_DA_CARGA', { carga: CargaRef; motivo: string }>;

/** Volta ao galpão sem responsável (ex.: rua removida da carga antes de iniciar a rota). */
export type EventoDesatribuido = Base<'DESATRIBUIDO', { de: AjudanteRef; motivo: string }>;

/** A rota da carga foi iniciada pelo operador: agora sim o pacote está na rua. */
export type EventoSaiuParaRota = Base<'SAIU_PARA_ROTA', { carga: CargaRef; ajudante: AjudanteRef }>;

/**
 * Entrega registrada pelo ajudante no Street (retorno da carga).
 * `idEventoStreet` é o id gerado no celular — a mesma entrega reenviada não vira duas.
 * Sem provas nesta etapa: só o fato, quem registrou, quando e (se informado) quem recebeu.
 */
export type EventoEntregaRegistrada = Base<'ENTREGA_REGISTRADA', {
  carga: CargaRef;
  ajudante: AjudanteRef;
  idEventoStreet: string;
  recebedor: { tipo: string; detalhes: string } | null;
}>;

/** Tentativa sem sucesso registrada na rua. O motivo é obrigatório e fica no histórico. */
export type EventoInsucessoRegistrado = Base<'INSUCESSO_REGISTRADO', {
  carga: CargaRef;
  ajudante: AjudanteRef;
  idEventoStreet: string;
  motivo: string;
}>;

/**
 * Correção/reversão de um desfecho (entrega ou insucesso) — NUNCA apaga o evento corrigido:
 * é um acontecimento novo que aponta para o antigo e devolve o pacote para EM_ROTA.
 * (Domínio pronto; ainda sem tela.)
 */
export type EventoCorrecaoRegistrada = Base<'CORRECAO_REGISTRADA', {
  eventoCorrigido: { id: string; tipo: 'ENTREGA_REGISTRADA' | 'INSUCESSO_REGISTRADO' };
  motivo: string;
}>;

export type Evento =
  | EventoImportado
  | EventoConflitoResolvido
  | EventoDestinoConfirmado
  | EventoAtribuido
  | EventoReatribuido
  | EventoIncluidoEmCarga
  | EventoRetiradoDaCarga
  | EventoDesatribuido
  | EventoSaiuParaRota
  | EventoEntregaRegistrada
  | EventoInsucessoRegistrado
  | EventoCorrecaoRegistrada;

export type TipoEvento = Evento['tipo'];

/**
 * Tipos previstos para a integração com o Street / Esteira de Baixas.
 * Declarados para a arquitetura já conhecê-los; o domínio RECUSA enquanto não forem implementados.
 */
export const TIPOS_FUTUROS = [
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
      cargaId: null,
      confirmacaoEntrega: null,
      motivoInsucesso: null,
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
      if (atual.cargaId !== null && atual.estado === 'ATRIBUIDO') {
        throw new ErroDominio('NA_CARGA', 'o pacote está numa carga montada: não pode ser passado a outro ajudante');
      }
      if (!podeTransitar(atual.estado, 'ATRIBUIDO')) {
        throw new ErroDominio('TRANSICAO_INVALIDA', `não é possível reatribuir um pacote em ${atual.estado}`);
      }
      return { ...base, estado: 'ATRIBUIDO', responsavelId: e.dados.para.id };
    case 'INCLUIDO_EM_CARGA':
      if (atual.responsavelId !== e.dados.ajudante.id) {
        throw new ErroDominio('NAO_E_DO_AJUDANTE', `o pacote não está com ${e.dados.ajudante.nome}`);
      }
      if (atual.estado !== 'ATRIBUIDO' || atual.cargaId !== null) {
        throw new ErroDominio('FORA_DO_GALPAO', `pacote em ${atual.estado}${atual.cargaId ? ' e já em carga' : ''} não pode entrar em carga`);
      }
      return { ...base, cargaId: e.dados.carga.id };
    case 'RETIRADO_DA_CARGA':
      if (atual.cargaId !== e.dados.carga.id || atual.estado !== 'ATRIBUIDO') {
        throw new ErroDominio('FORA_DA_CARGA', `só sai da carga ${e.dados.carga.codigo} um pacote dela ainda no galpão`);
      }
      return { ...base, cargaId: null };
    case 'DESATRIBUIDO':
      if (atual.estado !== 'ATRIBUIDO' || atual.cargaId !== null || atual.responsavelId !== e.dados.de.id) {
        throw new ErroDominio('TRANSICAO_INVALIDA', 'só volta ao galpão sem responsável um pacote atribuído e fora de carga');
      }
      return { ...base, estado: 'NAO_ATRIBUIDO', responsavelId: null };
    case 'SAIU_PARA_ROTA':
      if (atual.responsavelId !== e.dados.ajudante.id) {
        throw new ErroDominio('NAO_E_DO_AJUDANTE', `o pacote não está com ${e.dados.ajudante.nome}`);
      }
      // cargaId null: histórico da V0.2, quando a saída acontecia junto com a criação da carga.
      if (atual.cargaId !== null && atual.cargaId !== e.dados.carga.id) {
        throw new ErroDominio('FORA_DA_CARGA', `o pacote não está na carga ${e.dados.carga.codigo}`);
      }
      if (!podeTransitar(atual.estado, 'EM_ROTA')) {
        throw new ErroDominio('TRANSICAO_INVALIDA', `pacote em ${atual.estado} não pode sair para rota`);
      }
      return { ...base, estado: 'EM_ROTA', cargaId: e.dados.carga.id };
    case 'ENTREGA_REGISTRADA':
    case 'INSUCESSO_REGISTRADO': {
      if (atual.cargaId !== e.dados.carga.id) {
        throw new ErroDominio('FORA_DA_CARGA', `o pacote não está na carga ${e.dados.carga.codigo}`);
      }
      if (atual.responsavelId !== e.dados.ajudante.id) {
        throw new ErroDominio('NAO_E_DO_AJUDANTE', `o pacote não está com ${e.dados.ajudante.nome}`);
      }
      if (atual.estado === 'ATRIBUIDO') {
        throw new ErroDominio('ROTA_NAO_INICIADA', `a rota da carga ${e.dados.carga.codigo} ainda não foi iniciada`);
      }
      if (e.tipo === 'ENTREGA_REGISTRADA' && atual.estado === 'INSUCESSO') {
        throw new ErroDominio('INSUCESSO_NAO_VIRA_ENTREGA', 'o pacote tem insucesso registrado: insucesso não vira entrega');
      }
      if (atual.estado !== 'EM_ROTA') {
        throw new ErroDominio('TRANSICAO_INVALIDA', `pacote em ${atual.estado} já teve desfecho nesta rota`);
      }
      if (e.tipo === 'INSUCESSO_REGISTRADO') {
        if (!e.dados.motivo.trim()) throw new ErroDominio('SEM_MOTIVO', 'insucesso precisa de motivo');
        return { ...base, estado: 'INSUCESSO', motivoInsucesso: e.dados.motivo.trim(), confirmacaoEntrega: null };
      }
      return {
        ...base,
        estado: 'ENTREGUE',
        motivoInsucesso: null,
        confirmacaoEntrega: avaliarEntrega({
          recebedor: e.dados.recebedor,
          ocorridoEm: e.ocorridoEm,
          provas: { fotoPacote: false, fotoLocal: false },
        }),
      };
    }
    case 'CORRECAO_REGISTRADA': {
      const alvo = e.dados.eventoCorrigido.tipo === 'ENTREGA_REGISTRADA' ? 'ENTREGUE' : 'INSUCESSO';
      if (atual.estado !== alvo) {
        throw new ErroDominio('NADA_A_CORRIGIR', `o pacote não está em ${alvo}: não há desfecho desse tipo para corrigir`);
      }
      if (!e.dados.motivo.trim()) throw new ErroDominio('SEM_MOTIVO', 'correção precisa de motivo');
      return { ...base, estado: 'EM_ROTA', confirmacaoEntrega: null, motivoInsucesso: null };
    }
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
    case 'INCLUIDO_EM_CARGA':
      return `Incluído na carga ${e.dados.carga.codigo} de ${e.dados.ajudante.nome} (carga montada)`;
    case 'RETIRADO_DA_CARGA':
      return `Retirado da carga ${e.dados.carga.codigo} (${e.dados.motivo})`;
    case 'DESATRIBUIDO':
      return `Voltou ao galpão sem responsável (antes com ${e.dados.de.nome}) — ${e.dados.motivo}`;
    case 'SAIU_PARA_ROTA':
      return `Saiu para rota com ${e.dados.ajudante.nome} na carga ${e.dados.carga.codigo}`;
    case 'ENTREGA_REGISTRADA': {
      const r = e.dados.recebedor;
      const quem = r && r.detalhes ? ` — recebido por ${r.detalhes}${r.tipo ? ` (${r.tipo.replace(/_/g, ' ')})` : ''}` : '';
      return `Entrega registrada no Street por ${e.dados.ajudante.nome}${quem}`;
    }
    case 'INSUCESSO_REGISTRADO':
      return `Insucesso registrado no Street por ${e.dados.ajudante.nome} — motivo: ${e.dados.motivo}`;
    case 'CORRECAO_REGISTRADA':
      return `Correção: ${e.dados.eventoCorrigido.tipo === 'ENTREGA_REGISTRADA' ? 'entrega' : 'insucesso'} anterior revertido (o registro original continua no histórico) — motivo: ${e.dados.motivo}`;
  }
}
