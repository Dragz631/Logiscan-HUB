/**
 * PORTAS — o que a aplicação precisa do mundo externo, sem saber COMO é feito.
 * A infraestrutura (SQLite, pasta de provas…) implementa; os testes usam SQLite em memória.
 */
import type { Carga, EventoCarga } from '../domain/carga';
import type { Destino } from '../domain/destinoPacote';
import type { Associacao, EventoRegiao, Regiao } from '../domain/regioes';
import type { Evento } from '../domain/eventos';
import type { DecisaoConflito, ItemPrevia } from '../domain/importacao';
import type { EstadoPacote, Pacote } from '../domain/pacote';

/** Perfil operacional do ajudante. É o perfil — não o aparelho — que recebe cargas. */
export interface Ajudante {
  id: string;
  nome: string;
  ativo: boolean;
  criadoEm: string;
  /** Ex.: "Moto", "Bicicleta", "A pé". Livre, informativo. */
  veiculo: string | null;
}

export type StatusLote = 'PREVIA' | 'CONFIRMADO' | 'DESCARTADO';

export interface Lote {
  id: string;
  arquivo: string;
  sha256: string;
  schema: string;
  transportadora: string;
  extractor: { nome: string; versao: string };
  geradoEm: string;
  recebidoEm: string;
  status: StatusLote;
  confirmadoEm: string | null;
  confirmadoPor: string | null;
  /** Documento original, íntegro (nada é descartado). */
  documento: unknown;
}

export interface ItemLote extends ItemPrevia {
  loteId: string;
  decisao: DecisaoConflito | null;
  /** Pacote criado/afetado na confirmação. */
  pacoteId: string | null;
}

export interface FiltroPacotes {
  estado?: EstadoPacote;
  responsavelId?: string;
  semResponsavel?: boolean;
  revisaoPendente?: boolean;
  destinoId?: string;
  busca?: string;
}

export interface RepositorioPacotes {
  porId(id: string): Pacote | undefined;
  porChave(transportadora: string, codigo: string): Pacote | undefined;
  listar(filtro?: FiltroPacotes): Pacote[];
  /** Grava a projeção. `versaoEsperada` evita sobrescrever uma mudança concorrente. */
  salvar(p: Pacote, versaoEsperada: number | null): void;
}

export interface RepositorioEventos {
  /** Anexa; se a chave de idempotência já existe, NÃO grava e devolve o evento original. */
  anexar(e: Evento): { gravado: boolean; evento: Evento };
  porChave(chaveIdempotencia: string): Evento | undefined;
  doPacote(pacoteId: string): Evento[];
}

export interface RepositorioDestinos {
  porId(id: string): Destino | undefined;
  noNumero(ruaChave: string, numeroChave: string): Destino[];
  criar(d: Destino, criadoEm: string): void;
}

export interface RepositorioLotes {
  porId(id: string): Lote | undefined;
  porSha256(sha: string): Lote | undefined;
  listar(): Lote[];
  criar(l: Lote, itens: ItemLote[]): void;
  itens(loteId: string): ItemLote[];
  atualizarItem(item: ItemLote): void;
  atualizarStatus(id: string, status: StatusLote, confirmadoEm: string | null, confirmadoPor: string | null): void;
}

export interface RepositorioAjudantes {
  porId(id: string): Ajudante | undefined;
  listar(): Ajudante[];
  criar(a: Ajudante): void;
  atualizar(a: Ajudante): void;
}

export interface RepositorioCargas {
  porId(id: string): Carga | undefined;
  listar(): Carga[];
  /** Quantas cargas já têm código começando com este prefixo (sequência do dia). */
  contarPorPrefixo(prefixo: string): number;
  criar(c: Carga): void;
  marcarRotaIniciada(id: string, em: string, por: string): void;
  marcarFinalizada(id: string, em: string, por: string): void;
  /** Carga ainda não finalizada do ajudante (no máximo uma). */
  ativaDoAjudante(ajudanteId: string): Carga | undefined;
  /** Ids das cargas não finalizadas. */
  idsAtivas(): Set<string>;
  adicionarPacotes(cargaId: string, pacoteIds: string[]): void;
  removerPacotes(cargaId: string, pacoteIds: string[]): void;
  anexarEvento(e: EventoCarga): void;
  eventos(cargaId: string): EventoCarga[];
}

/** Memória operacional do HUB: regiões e o mapa rua → região. */
export interface RepositorioRegioes {
  listar(): Regiao[];
  porId(id: string): Regiao | undefined;
  porNome(nome: string): Regiao | undefined;
  criar(r: Regiao): void;
  associacoes(): Map<string, Associacao>;
  associacao(ruaChave: string): Associacao | undefined;
  definir(a: Associacao): void;
  anexarEvento(e: EventoRegiao): void;
  eventos(ruaChave: string): EventoRegiao[];
}

/** Tudo que precisa ser gravado junto, numa transação. */
export interface Armazem {
  pacotes: RepositorioPacotes;
  eventos: RepositorioEventos;
  destinos: RepositorioDestinos;
  lotes: RepositorioLotes;
  ajudantes: RepositorioAjudantes;
  cargas: RepositorioCargas;
  regioes: RepositorioRegioes;
  transacao<T>(fn: () => T): T;
}

/**
 * Provas (fotos) — separadas dos dados operacionais e do estado da UI.
 * Sem uso na V0.1; a Esteira de Baixas vai usar.
 */
export interface ArmazemDeProvas {
  guardar(conteudo: Uint8Array, mime: string): Promise<{ sha256: string; tamanho: number }>;
  ler(sha256: string): Promise<Uint8Array | undefined>;
}

export interface Relogio {
  agora(): string;
}

export interface GeradorId {
  novo(): string;
}

export interface Contexto {
  armazem: Armazem;
  relogio: Relogio;
  ids: GeradorId;
}
