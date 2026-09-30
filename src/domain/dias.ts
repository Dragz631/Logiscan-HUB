/**
 * DIA — o dia operacional encerrado pelo botão "Novo dia".
 *
 * Fechar o dia encerra as cargas abertas, decide o destino do que o ajudante não entregou
 * (volta para a caixa como "Retornado" ou vai para o galpão) e guarda o resumo no histórico de dias.
 * `historico` false = dia de TESTE ("só memória"): a memória do HUB (caixas, pessoas, destinos) fica como
 * está; o que muda é que o dia não conta no histórico de entregas. Nada é apagado (tudo é append-only).
 */
export type DestinoDasSobras = 'amanha' | 'galpao';

export interface ResumoCargaDoDia {
  cargaId: string;
  codigo: string;
  ajudante: { id: string; nome: string };
  /** MONTADA = carga que nem saiu (foi desfeita); EM_ROTA = rota já iniciada. */
  situacao: 'MONTADA' | 'EM_ROTA';
  /** Pacotes na carga (montada: os que voltam para as caixas). */
  pacotes: number;
  entregues: number;
  insucessos: number;
  /** Pendentes na rua + insucessos: tudo o que não foi entregue. */
  sobras: number;
  destino: DestinoDasSobras | null;
  caixas: string[];
}

export interface ResumoDia {
  cargas: ResumoCargaDoDia[];
  /** Pacotes que estavam nas caixas SEM ajudante quando o dia foi encerrado, e o que se fez com eles. */
  semResponsavel?: { pacotes: number; destino: DestinoDasSobras };
  totais: { cargas: number; entregues: number; amanha: number; galpao: number; desfeitas: number };
}

export interface Dia {
  id: string;
  /** AAAA-MM-DD (São Paulo). */
  dataRef: string;
  encerradoEm: string;
  encerradoPor: string;
  /** true = memória + histórico de entregas; false = só memória (dia de teste). */
  historico: boolean;
  resumo: ResumoDia;
  chave: string;
}
