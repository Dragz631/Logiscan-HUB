/**
 * PACOTE — a unidade do inventário oficial.
 *
 * PACOTE ≠ DESTINO ≠ RECEBEDOR:
 *  - pacote   = um código de rastreio de uma transportadora (identidade própria);
 *  - destino  = onde ele vai (rua + número + contexto) — vários pacotes podem ir ao mesmo destino;
 *  - recebedor = quem recebeu de fato (registrado na entrega, futuro).
 *
 * Dois códigos diferentes NUNCA se fundem, mesmo com mesmo endereço/nome/número.
 */
import type { ConfirmacaoEntrega } from './confirmacao';
import { chaveTexto, limparEspacos } from './destino/texto';

/**
 * Estados operacionais. "Importado" é um EVENTO (o pacote nasce NAO_ATRIBUIDO),
 * não um estado: após a confirmação ele já está no inventário esperando responsável.
 */
export const ESTADOS = [
  'NAO_ATRIBUIDO',
  'ATRIBUIDO',
  'EM_ROTA',
  'ENTREGUE',
  'INSUCESSO',
  'RETORNADO',
  'DEVOLVIDO',
  'PRONTO_PARA_BAIXA',
  'BAIXADO',
] as const;
export type EstadoPacote = (typeof ESTADOS)[number];

/** Transições permitidas. Tudo o que não está aqui é recusado pelo domínio. */
export const TRANSICOES: Record<EstadoPacote, readonly EstadoPacote[]> = {
  NAO_ATRIBUIDO: ['ATRIBUIDO'],
  ATRIBUIDO: ['ATRIBUIDO', 'NAO_ATRIBUIDO', 'EM_ROTA'], // ATRIBUIDO→ATRIBUIDO = reatribuição
  // Fim do dia: o que não foi entregue volta para a caixa (RETORNADO) ou sai para o galpão (DEVOLVIDO).
  EM_ROTA: ['ENTREGUE', 'INSUCESSO', 'RETORNADO', 'DEVOLVIDO'],
  INSUCESSO: ['EM_ROTA', 'RETORNADO', 'ATRIBUIDO', 'DEVOLVIDO'],
  RETORNADO: ['NAO_ATRIBUIDO', 'ATRIBUIDO', 'DEVOLVIDO'],
  // Devolvido ao galpão só volta se o mesmo código chegar de novo num lote (reabertura).
  DEVOLVIDO: ['NAO_ATRIBUIDO'],
  ENTREGUE: ['PRONTO_PARA_BAIXA'],
  PRONTO_PARA_BAIXA: ['BAIXADO'],
  BAIXADO: [],
};

export function podeTransitar(de: EstadoPacote, para: EstadoPacote): boolean {
  return TRANSICOES[de].includes(para);
}

/** Dados do pacote como vieram da fonte (endereço preservado como escrito). */
export interface DadosPacote {
  destinatario: string;
  rua: string;
  ruaDetalhe: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}

export const CAMPOS_DADOS: readonly (keyof DadosPacote)[] = [
  'destinatario', 'rua', 'ruaDetalhe', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep',
];

/** Pendências de revisão do HUB (ortogonais ao estado — não viram estados novos). */
export type Pendencia = 'DESTINO_A_CONFIRMAR';

/** "Retornado · do dia 26/09": de onde o pacote voltou para a caixa ao fim do dia. */
export interface RetornadoDe {
  /** AAAA-MM-DD (São Paulo) do dia em que a rota saiu. */
  dia: string;
  carga: string;
  ajudante: string;
}

export interface OrigemPacote {
  loteId: string;
  arquivo: string;
  card: number | null;
}

/** Projeção do estado ATUAL. O histórico completo vive nos eventos. */
export interface Pacote {
  id: string;
  transportadora: string;
  codigo: string;
  dados: DadosPacote;
  destinoId: string | null;
  /** Destinos candidatos quando a regra de destino não pôde decidir sozinha. */
  destinoCandidatos: string[];
  estado: EstadoPacote;
  responsavelId: string | null;
  /** Carga do pacote (montada ou na rua). null = no galpão, fora de carga. */
  cargaId: string | null;
  /** Caixa decidida À MÃO na triagem (evento CAIXA_DEFINIDA). null = a caixa vem da memória (pessoa/rua). */
  caixaId: string | null;
  /** Só com estado ENTREGUE: o que falta para a entrega ser considerada confirmada (baixa). */
  confirmacaoEntrega: ConfirmacaoEntrega | null;
  /** Só com estado INSUCESSO: motivo do último insucesso (o histórico guarda todos). */
  motivoInsucesso: string | null;
  /** Só com estado RETORNADO: de qual dia/carga/ajudante ele voltou para a caixa. */
  retornadoDe: RetornadoDe | null;
  pendencias: Pendencia[];
  origem: OrigemPacote;
  criadoEm: string;
  atualizadoEm: string;
  /** Quantidade de eventos aplicados (controle de concorrência / auditoria). */
  versao: number;
}

/** Código de rastreio normalizado: sem espaços, maiúsculo. Nada além disso. */
export function normalizarCodigo(codigo: string | null | undefined): string {
  return (codigo ?? '').replace(/\s+/g, '').toUpperCase();
}

/** Chave natural: o código só é único DENTRO da transportadora. */
export function chaveNatural(transportadora: string, codigo: string): string {
  return `${transportadora.trim().toLowerCase()}:${normalizarCodigo(codigo)}`;
}

export function limparDados(d: DadosPacote): DadosPacote {
  const out = {} as DadosPacote;
  for (const c of CAMPOS_DADOS) out[c] = limparEspacos(d[c]);
  return out;
}

/**
 * Diferenças relevantes entre duas versões dos dados.
 * Maiúsculas, acentos e espaços NÃO contam como diferença (ruído de OCR);
 * qualquer letra/dígito diferente conta.
 */
export function diferencasDados(atual: DadosPacote, novo: DadosPacote): { campo: keyof DadosPacote; atual: string; novo: string }[] {
  return CAMPOS_DADOS.filter((c) => chaveTexto(atual[c]) !== chaveTexto(novo[c])).map((c) => ({
    campo: c,
    atual: atual[c],
    novo: novo[c],
  }));
}

export function revisaoPendente(p: Pick<Pacote, 'pendencias'>): boolean {
  return p.pendencias.length > 0;
}
