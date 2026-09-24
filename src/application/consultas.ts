/**
 * Consultas (somente leitura) que respondem às perguntas da V0.1:
 * quantos entraram, quantos precisam de revisão, quantos sem responsável,
 * quem está com um pacote, qual o status e o que aconteceu com ele.
 */
import { type Destino, rotuloDestino } from '../domain/destinoPacote';
import { type Evento, descreverEvento } from '../domain/eventos';
import { ESTADOS, type EstadoPacote, type Pacote, revisaoPendente } from '../domain/pacote';
import { ErroAplicacao } from './erros';
import type { Ajudante, Contexto, FiltroPacotes } from './portas';

export interface ResumoInventario {
  total: number;
  revisaoPendente: number;
  semResponsavel: number;
  porEstado: Record<EstadoPacote, number>;
  porAjudante: { ajudante: Ajudante; quantidade: number }[];
}

export function resumoInventario(ctx: Contexto): ResumoInventario {
  const todos = ctx.armazem.pacotes.listar();
  const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, 0])) as Record<EstadoPacote, number>;
  const porResp = new Map<string, number>();
  for (const p of todos) {
    porEstado[p.estado]++;
    if (p.responsavelId) porResp.set(p.responsavelId, (porResp.get(p.responsavelId) ?? 0) + 1);
  }
  return {
    total: todos.length,
    revisaoPendente: todos.filter(revisaoPendente).length,
    semResponsavel: todos.filter((p) => p.responsavelId === null).length,
    porEstado,
    porAjudante: ctx.armazem.ajudantes
      .listar()
      .map((a) => ({ ajudante: a, quantidade: porResp.get(a.id) ?? 0 }))
      .sort((a, b) => b.quantidade - a.quantidade),
  };
}

export interface LinhaInventario extends Pacote {
  responsavelNome: string | null;
  destinoRotulo: string | null;
}

export function listarPacotes(ctx: Contexto, filtro: FiltroPacotes = {}): LinhaInventario[] {
  const { armazem } = ctx;
  const nomes = new Map(armazem.ajudantes.listar().map((a) => [a.id, a.nome]));
  const destinos = new Map<string, Destino | undefined>();
  const destino = (id: string) => {
    if (!destinos.has(id)) destinos.set(id, armazem.destinos.porId(id));
    return destinos.get(id);
  };
  return armazem.pacotes.listar(filtro).map((p) => {
    const d = p.destinoId ? destino(p.destinoId) : undefined;
    return {
      ...p,
      responsavelNome: p.responsavelId ? (nomes.get(p.responsavelId) ?? null) : null,
      destinoRotulo: d ? rotuloDestino(d) : null,
    };
  });
}

export interface DetalhePacote {
  pacote: Pacote;
  responsavel: Ajudante | null;
  destino: Destino | null;
  candidatos: Destino[];
  /** Outros pacotes no mesmo destino (identidades próprias, nunca fundidos). */
  mesmoDestino: { id: string; codigo: string; destinatario: string }[];
  lote: { id: string; arquivo: string; extractor: string } | null;
  timeline: (Evento & { descricao: string })[];
}

export function detalharPacote(ctx: Contexto, pacoteId: string): DetalhePacote {
  const { armazem } = ctx;
  const pacote = armazem.pacotes.porId(pacoteId);
  if (!pacote) throw new ErroAplicacao('PACOTE_INEXISTENTE', 'pacote não encontrado', 404);
  const destino = pacote.destinoId ? (armazem.destinos.porId(pacote.destinoId) ?? null) : null;
  const candidatos = pacote.destinoCandidatos.map((id) => armazem.destinos.porId(id)).filter((d): d is Destino => !!d);
  const lote = armazem.lotes.porId(pacote.origem.loteId);
  const nomeDestino = (id: string) => {
    const d = armazem.destinos.porId(id);
    return d ? rotuloDestino(d) : id;
  };
  return {
    pacote,
    responsavel: pacote.responsavelId ? (armazem.ajudantes.porId(pacote.responsavelId) ?? null) : null,
    destino,
    candidatos,
    mesmoDestino: pacote.destinoId
      ? armazem.pacotes
          .listar({ destinoId: pacote.destinoId })
          .filter((p) => p.id !== pacote.id)
          .map((p) => ({ id: p.id, codigo: p.codigo, destinatario: p.dados.destinatario }))
      : [],
    lote: lote ? { id: lote.id, arquivo: lote.arquivo, extractor: `${lote.extractor.nome} ${lote.extractor.versao}` } : null,
    timeline: armazem.eventos.doPacote(pacote.id).map((e) => ({ ...e, descricao: descreverEvento(e, nomeDestino) })),
  };
}
