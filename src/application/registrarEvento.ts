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
