/**
 * REPASSE NA HORA — a rota em andamento de um ajudante passa para outro ajudante ativo
 * (aconteceu algo com ele na rua): "Repasse do Hugo para João".
 *
 * A regra "carga EM_ROTA é fechada" continua valendo: a carga do Hugo NÃO ganha nem perde caixa em silêncio.
 * O repasse é uma operação explícita e separada, com CARGA NOVA para quem assume (já em rota, com o horário do
 * repasse) e eventos próprios dos dois lados. O que o Hugo já entregou fica na carga e no histórico dele.
 */
import { type Carga, type RuaRef, codigoCarga, prefixoCarga } from '../domain/carga';
import type { Pacote } from '../domain/pacote';
import { ErroAplicacao } from './erros';
import { erroDominio, resolvedorDeUnidade } from './orquestracao';
import type { Contexto } from './portas';
import { registrarEvento } from './registrarEvento';

/** As caixas da carga que ainda têm pacote na rua (o que dá para repassar). */
export interface CaixaComPendencia {
  chave: string;
  numero: string | null;
  nome: string;
  pendentes: number;
}

export interface PendenciasDaRota {
  carga: { id: string; codigo: string; ajudante: { id: string; nome: string }; rotaIniciadaEm: string | null };
  caixas: CaixaComPendencia[];
  totalPendentes: number;
}

function pendentesDaCarga(ctx: Contexto, carga: Carga): Pacote[] {
  return carga.pacoteIds
    .map((id) => ctx.armazem.pacotes.porId(id))
    .filter((p): p is Pacote => !!p && p.cargaId === carga.id && p.estado === 'EM_ROTA');
}

/** Para a janela "Repassar rota": quais caixas ainda têm pacote na rua. */
export function pendenciasDaRota(ctx: Contexto, cargaId: string): PendenciasDaRota {
  const carga = ctx.armazem.cargas.porId(cargaId);
  if (!carga) throw new ErroAplicacao('CARGA_INEXISTENTE', 'carga não encontrada', 404);
  const unidadeDe = resolvedorDeUnidade(ctx);
  const porCaixa = new Map<string, CaixaComPendencia>();
  for (const p of pendentesDaCarga(ctx, carga)) {
    const u = unidadeDe(p);
    const atual = porCaixa.get(u.chave) ?? { chave: u.chave, numero: u.caixa?.numero ?? null, nome: u.nome, pendentes: 0 };
    atual.pendentes++;
    porCaixa.set(u.chave, atual);
  }
  const caixas = [...porCaixa.values()].sort((a, b) => (a.numero ?? '~').localeCompare(b.numero ?? '~', 'pt-BR', { numeric: true }) || a.nome.localeCompare(b.nome, 'pt-BR'));
  return {
    carga: { id: carga.id, codigo: carga.codigo, ajudante: carga.ajudante, rotaIniciadaEm: carga.rotaIniciadaEm },
    caixas,
    totalPendentes: caixas.reduce((n, c) => n + c.pendentes, 0),
  };
}

export interface EntradaRepasseRota {
  cargaId: string;
  paraAjudanteId: string;
  /** Caixas a repassar (chaves de `pendenciasDaRota`). Vazio/ausente = todas as pendências. */
  caixas?: string[];
  ator: string;
  /** Idempotência: o mesmo clique repetido devolve o repasse já feito. */
  chave: string;
  motivo?: string;
}

export interface ResultadoRepasseRota {
  cargaNova: Carga;
  pacotes: number;
  caixas: RuaRef[];
  jaFeito: boolean;
}

export function repassarRota(ctx: Contexto, entrada: EntradaRepasseRota): ResultadoRepasseRota {
  if (!entrada.chave) throw new ErroAplicacao('SEM_CHAVE', 'chave de idempotência obrigatória');
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const origem = armazem.cargas.porId(entrada.cargaId);
    if (!origem) throw new ErroAplicacao('CARGA_INEXISTENTE', 'carga não encontrada', 404);

    // Retry do mesmo clique: devolve o que já foi feito, sem evento novo.
    const feito = armazem.cargas.eventos(origem.id).find((e) => e.tipo === 'ROTA_REPASSADA' && e.dados.chave === entrada.chave);
    if (feito && feito.tipo === 'ROTA_REPASSADA') {
      return { cargaNova: armazem.cargas.porId(feito.dados.paraCarga.id)!, pacotes: feito.dados.pacotes, caixas: feito.dados.caixas, jaFeito: true };
    }

    if (!origem.rotaIniciadaEm) {
      throw new ErroAplicacao('CARGA_NAO_SAIU', `a carga ${origem.codigo} ainda não saiu: para mudar de ajudante use Remover/Reatribuir nas caixas dela`, 409);
    }
    if (origem.finalizadaEm) throw new ErroAplicacao('CARGA_FINALIZADA', `a carga ${origem.codigo} já foi encerrada`, 409);

    const para = armazem.ajudantes.porId(entrada.paraAjudanteId);
    if (!para) throw new ErroAplicacao('AJUDANTE_INEXISTENTE', 'ajudante de destino não encontrado', 404);
    if (!para.ativo) throw new ErroAplicacao('AJUDANTE_INATIVO', `${para.nome} está INATIVO e não recebe repasse: ative o perfil em Ajudantes`, 409);
    if (para.id === origem.ajudante.id) throw new ErroAplicacao('MESMO_AJUDANTE', 'a rota já é desse ajudante', 409);
    const aberta = armazem.cargas.ativaDoAjudante(para.id);
    if (aberta) {
      throw new ErroAplicacao(
        'DESTINO_COM_CARGA',
        `${para.nome} já tem a carga ${aberta.codigo} aberta: finalize ou desfaça essa carga antes de receber um repasse`,
        409,
      );
    }

    const unidadeDe = resolvedorDeUnidade(ctx);
    const escolhidas = entrada.caixas?.length ? new Set(entrada.caixas) : null;
    const pendentes = pendentesDaCarga(ctx, origem);
    const vao = pendentes.filter((p) => !escolhidas || escolhidas.has(unidadeDe(p).chave));
    if (vao.length === 0) {
      throw new ErroAplicacao('NADA_A_REPASSAR', escolhidas ? 'as caixas escolhidas não têm pacote na rua' : 'não há pacote na rua para repassar', 409);
    }

    const porCaixa = new Map<string, RuaRef>();
    for (const p of vao) {
      const u = unidadeDe(p);
      const atual = porCaixa.get(u.chave) ?? { chave: u.chave, nome: u.nome, quantidade: 0 };
      atual.quantidade++;
      porCaixa.set(u.chave, atual);
    }
    const caixas = [...porCaixa.values()];

    const agora = ctx.relogio.agora();
    const motivo = entrada.motivo?.trim() ?? '';
    const paraRef = { id: para.id, nome: para.nome };
    const nova: Carga = {
      id: ctx.ids.novo(),
      codigo: codigoCarga(agora, para.nome, armazem.cargas.contarPorPrefixo(prefixoCarga(agora, para.nome)) + 1),
      ajudante: paraRef,
      pacoteIds: [],
      criadaEm: agora,
      criadaPor: entrada.ator,
      rotaIniciadaEm: null,
      rotaIniciadaPor: null,
      finalizadaEm: null,
      finalizadaPor: null,
    };
    armazem.cargas.criar(nova);
    armazem.cargas.anexarEvento({
      id: ctx.ids.novo(), cargaId: nova.id, tipo: 'CARGA_CRIADA',
      dados: { ajudante: paraRef, quantidade: vao.length, repassadaDe: { carga: { id: origem.id, codigo: origem.codigo }, ajudante: origem.ajudante, motivo } },
      ator: entrada.ator, ocorridoEm: agora, registradoEm: agora,
    });

    const base = { ator: entrada.ator, origem: 'hub' as const, ocorridoEm: agora, registradoEm: agora };
    for (const p of vao) {
      erroDominio(() => registrarEvento(armazem, {
        ...base, id: ctx.ids.novo(), pacoteId: p.id, tipo: 'REPASSADO_EM_ROTA',
        dados: {
          de: { carga: { id: origem.id, codigo: origem.codigo }, ajudante: origem.ajudante },
          para: { carga: { id: nova.id, codigo: nova.codigo }, ajudante: paraRef },
          motivo,
        },
        chaveIdempotencia: `repasse:${entrada.chave}:${p.id}`,
      }), p.codigo);
    }
    const ids = vao.map((p) => p.id);
    armazem.cargas.removerPacotes(origem.id, ids);
    armazem.cargas.adicionarPacotes(nova.id, ids);
    armazem.cargas.marcarRotaIniciada(nova.id, agora, entrada.ator);
    armazem.cargas.anexarEvento({
      id: ctx.ids.novo(), cargaId: nova.id, tipo: 'ROTA_INICIADA', dados: { quantidade: vao.length, repasse: true },
      ator: entrada.ator, ocorridoEm: agora, registradoEm: agora,
    });
    armazem.cargas.anexarEvento({
      id: ctx.ids.novo(), cargaId: origem.id, tipo: 'ROTA_REPASSADA',
      dados: { para: paraRef, paraCarga: { id: nova.id, codigo: nova.codigo }, pacotes: vao.length, caixas, motivo, chave: entrada.chave },
      ator: entrada.ator, ocorridoEm: agora, registradoEm: agora,
    });
    return { cargaNova: armazem.cargas.porId(nova.id)!, pacotes: vao.length, caixas, jaFeito: false };
  });
}
