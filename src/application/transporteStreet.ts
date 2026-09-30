/**
 * TRANSPORTE HUB ↔ STREET — camada separada do domínio.
 *
 *   Carga → documento logiscan.carga/v0 → TRANSPORTE → Street (perfil do ajudante)
 *   Street → documento logiscan.street-eventos/v0 → TRANSPORTE → HUB
 *
 * Os documentos são os MESMOS do arquivo (que continua como fallback/diagnóstico). Hoje o transporte
 * é HTTP local (rotas /api/street/*); trocar por outro (fila, nuvem) não mexe no domínio nem nos contratos.
 * A carga é endereçada ao PERFIL do ajudante (helper_id), nunca a um aparelho.
 */
import type { DocumentoCargaV0 } from '../contracts/cargaV0';
import { documentoDaCarga, receberRetornoStreet } from './cargas';
import { ErroAplicacao } from './erros';
import type { Contexto } from './portas';

/**
 * O Street deste perfil apareceu (buscou carga, confirmou recebimento ou mandou eventos).
 * Serve para o HUB mostrar "Street visto há 3 min" / "nunca conectou". Não grava a cada 15 s: no máximo 1 vez a cada 20 s.
 */
function registrarVisto(ctx: Contexto, ajudanteId: string): void {
  const a = ctx.armazem.ajudantes.porId(ajudanteId);
  if (!a) return;
  const agora = ctx.relogio.agora();
  if (a.streetVistoEm && Date.parse(agora) - Date.parse(a.streetVistoEm) < 20_000) return;
  ctx.armazem.ajudantes.marcarStreetVisto(a.id, agora);
}

/** Perfis que o Street pode escolher em "Quem está usando este aparelho?". */
export function perfisParaStreet(ctx: Contexto): { id: string; nome: string }[] {
  return ctx.armazem.ajudantes.listar().filter((a) => a.ativo).map((a) => ({ id: a.id, nome: a.nome }));
}

/** Carga ativa (montada ou em rota) do perfil — só dele. Nunca devolve carga de outro ajudante. */
export function cargasDoPerfil(ctx: Contexto, ajudanteId: string): DocumentoCargaV0[] {
  const a = ctx.armazem.ajudantes.porId(ajudanteId);
  if (!a) throw new ErroAplicacao('PERFIL_INEXISTENTE', 'perfil não encontrado no HUB', 404);
  registrarVisto(ctx, a.id);
  const carga = ctx.armazem.cargas.ativaDoAjudante(ajudanteId);
  if (!carga || carga.ajudante.id !== ajudanteId) return [];
  return [documentoDaCarga(ctx, carga, ctx.relogio.agora())];
}

/**
 * O Street avisa que carregou a carga no perfil. Idempotente: só registra no histórico da carga
 * quando é a primeira vez ou quando a quantidade mudou (ex.: rua acrescentada antes da rota).
 */
export function confirmarRecebimento(
  ctx: Contexto,
  entrada: { cargaId: string; ajudanteId: string; quantidade: number },
): { registrado: boolean } {
  const { armazem } = ctx;
  registrarVisto(ctx, entrada.ajudanteId);
  return armazem.transacao(() => {
    const carga = armazem.cargas.porId(entrada.cargaId);
    if (!carga) throw new ErroAplicacao('CARGA_INEXISTENTE', 'carga não encontrada', 404);
    if (carga.ajudante.id !== entrada.ajudanteId) {
      throw new ErroAplicacao('PERFIL_ERRADO', `a carga ${carga.codigo} é de ${carga.ajudante.nome}, não deste perfil`, 409);
    }
    const ultima = armazem.cargas.eventos(carga.id).filter((e) => e.tipo === 'RECEBIDA_NO_STREET').at(-1);
    if (ultima && ultima.tipo === 'RECEBIDA_NO_STREET' && ultima.dados.quantidade === entrada.quantidade) return { registrado: false };
    const agora = ctx.relogio.agora();
    armazem.cargas.anexarEvento({
      id: ctx.ids.novo(),
      cargaId: carga.id,
      tipo: 'RECEBIDA_NO_STREET',
      dados: { ajudante: carga.ajudante, quantidade: entrada.quantidade },
      ator: carga.ajudante.nome,
      ocorridoEm: agora,
      registradoEm: agora,
    });
    return { registrado: true };
  });
}

/** Eventos do Street pelo transporte direto — mesma regra (e mesma idempotência) do arquivo. */
export function receberEventosStreet(ctx: Contexto, documento: unknown) {
  const quem = (documento as { ajudante?: { id?: unknown } } | null)?.ajudante?.id;
  if (typeof quem === 'string') registrarVisto(ctx, quem);
  return receberRetornoStreet(ctx, { arquivo: 'street (transporte direto)', conteudo: JSON.stringify(documento) });
}
