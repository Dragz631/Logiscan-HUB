/**
 * DESTINO = onde o pacote realmente vai: rua + número + contexto (local nomeado, opcional).
 * A unidade (Apto 101, Casa 2…) vive DENTRO do destino e não faz parte da identidade dele.
 *
 * Resolução de um pacote contra os destinos já conhecidos:
 *   exato     → mesma identidade (ou único destino sem nome no número): vincula sozinho.
 *   novo      → nada conhecido é compatível: cria destino a partir da evidência.
 *   sugestao  → UM candidato plausível com identidade diferente: mostra, NÃO vincula.
 *   ambiguo   → vários candidatos: pede confirmação, NÃO escolhe.
 */
import type { EnderecoInterpretado, FamiliaUnidade, TipoContexto } from './endereco';

export type TipoDestino = 'simples' | 'predio' | 'vila' | 'comercio';

export function tipoDoDestino(entrada: { contextoTipo?: TipoContexto; familias: FamiliaUnidade[] }): TipoDestino {
  if (entrada.contextoTipo === 'comercio') return 'comercio';
  if (entrada.contextoTipo === 'condominio' || entrada.contextoTipo === 'edificio') return 'predio';
  if (entrada.contextoTipo === 'vila') return 'vila';
  if (entrada.familias.includes('predio')) return 'predio';
  if (entrada.familias.includes('casa_interna')) return 'vila';
  return 'simples';
}

export interface CandidatoDestino {
  id: string;
  contextoChave: string;
  contextoNome?: string;
  contextoTipo?: TipoContexto;
}

export type Resolucao =
  | { status: 'novo'; destinoId: string }
  | { status: 'exato'; destinoId: string }
  | { status: 'sugestao'; candidatos: string[]; novoDestinoId: string }
  | { status: 'ambiguo'; candidatos: string[]; novoDestinoId: string };

/** Uma unidade de prédio (apto, bloco…) não pode pertencer a um estabelecimento comercial. */
function compativel(candidato: CandidatoDestino, end: EnderecoInterpretado): boolean {
  if (end.unidade?.familia === 'predio' && candidato.contextoTipo === 'comercio') return false;
  return true;
}

export function resolverContraCandidatos(candidatos: CandidatoDestino[], end: EnderecoInterpretado): Resolucao {
  const novoDestinoId = end.destinoId;

  // Local nomeado explicitamente: a identidade é clara.
  if (end.contexto) {
    return candidatos.some((c) => c.id === novoDestinoId)
      ? { status: 'exato', destinoId: novoDestinoId }
      : { status: 'novo', destinoId: novoDestinoId };
  }

  if (candidatos.length === 0) return { status: 'novo', destinoId: novoDestinoId };

  const compat = candidatos.filter((c) => compativel(c, end));
  if (compat.length === 0) return { status: 'novo', destinoId: novoDestinoId };

  if (compat.length === 1) {
    const unico = compat[0];
    // Único destino sem nome no número → é o "endereço simples" do próprio número.
    if (unico.contextoChave === '') return { status: 'exato', destinoId: unico.id };
    // Único destino nomeado: só SUGERE.
    return { status: 'sugestao', candidatos: [unico.id], novoDestinoId };
  }

  return { status: 'ambiguo', candidatos: compat.map((c) => c.id), novoDestinoId };
}

export function descreverCandidato(c: { contextoNome?: string }): string {
  return c.contextoNome ?? 'Endereço sem local informado';
}
