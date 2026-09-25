/**
 * Porta única de entrada de acontecimentos: TODO evento (HUB hoje, Street no futuro)
 * passa por aqui. Garante, dentro da transação do chamador:
 *   1. idempotência (mesma chave → nada novo, devolve o que já existe);
 *   2. regra de domínio (aplicarEvento recusa o que é inválido);
 *   3. histórico + estado atual gravados juntos.
 */
import { type Evento, aplicarEvento } from '../domain/eventos';
import type { Pacote } from '../domain/pacote';
import type { Armazem } from './portas';

export interface ResultadoRegistro {
  gravado: boolean;
  evento: Evento;
  pacote: Pacote;
}

export function registrarEvento(armazem: Armazem, e: Evento): ResultadoRegistro {
  const repetido = armazem.eventos.porChave(e.chaveIdempotencia);
  if (repetido) {
    const pacote = armazem.pacotes.porId(repetido.pacoteId);
    if (!pacote) throw new Error(`evento ${repetido.id} sem pacote`);
    return { gravado: false, evento: repetido, pacote };
  }
  const atual = e.tipo === 'IMPORTADO' ? null : (armazem.pacotes.porId(e.pacoteId) ?? null);
  const novo = aplicarEvento(atual, e);
  armazem.eventos.anexar(e);
  armazem.pacotes.salvar(novo, atual ? atual.versao : null);
  return { gravado: true, evento: e, pacote: novo };
}

/**
 * Recalcula o estado atual de cada pacote a partir do histórico e grava onde divergir.
 * Usado depois de migrações que acrescentam campos à projeção (o histórico é a fonte da verdade).
 * Não toca nos eventos. Devolve quantos pacotes foram atualizados.
 */
export function reprojetarPacotes(armazem: Armazem): number {
  return armazem.transacao(() => {
    let n = 0;
    for (const atual of armazem.pacotes.listar()) {
      const eventos = armazem.eventos.doPacote(atual.id);
      if (eventos.length === 0) continue;
      const certo = eventos.reduce<Pacote | null>((p, e) => aplicarEvento(p, e), null);
      if (certo && JSON.stringify(certo) !== JSON.stringify(atual)) {
        armazem.pacotes.salvar(certo, atual.versao);
        n++;
      }
    }
    return n;
  });
}
