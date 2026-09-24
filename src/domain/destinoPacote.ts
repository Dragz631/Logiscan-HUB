/**
 * Liga um pacote a um DESTINO usando a MESMA regra do Street (pasta ./destino, cópia fiel).
 *
 *   Rua X
 *   └── Nº 100
 *       ├── Loja ABC        (destino A)
 *       └── Condomínio XYZ  (destino B)
 *
 * Mesmo número NÃO significa mesmo destino. Quando a regra não consegue decidir
 * (sugestão/ambíguo), o pacote fica SEM destino e com os candidatos para um humano confirmar.
 */
import { resolverContraCandidatos } from './destino/destino';
import { type TipoContexto, interpretarEndereco } from './destino/endereco';
import type { DadosPacote } from './pacote';

export interface Destino {
  /** rua|número|contexto — mesma identidade do Street. */
  id: string;
  ruaNome: string;
  ruaChave: string;
  numeroNome: string;
  numeroChave: string;
  contextoChave: string;
  contextoNome: string | null;
  contextoTipo: TipoContexto | null;
}

export interface ResolucaoDestinoPacote {
  destinoId: string | null;
  /** Destinos já conhecidos entre os quais um humano precisa escolher. */
  candidatos: string[];
  /** Destino a criar (quando é novo). */
  criar: Destino | null;
}

export function destinoDoEndereco(dados: Pick<DadosPacote, 'rua' | 'numero' | 'complemento'>): Destino {
  const end = interpretarEndereco({ rua: dados.rua, numero: dados.numero, complemento: dados.complemento });
  return {
    id: end.destinoId,
    ruaNome: end.ruaNome,
    ruaChave: end.ruaChave,
    numeroNome: end.numeroNome,
    numeroChave: end.numeroChave,
    contextoChave: end.contexto?.chave ?? '',
    contextoNome: end.contexto?.nome ?? null,
    contextoTipo: end.contexto?.tipo ?? null,
  };
}

/**
 * @param conhecidosNoNumero destinos já existentes na MESMA rua e MESMO número.
 */
export function resolverDestinoDoPacote(
  dados: Pick<DadosPacote, 'rua' | 'numero' | 'complemento'>,
  conhecidosNoNumero: Destino[],
): ResolucaoDestinoPacote {
  const proprio = destinoDoEndereco(dados);
  if (!proprio.ruaChave) return { destinoId: null, candidatos: [], criar: null };

  const end = interpretarEndereco({ rua: dados.rua, numero: dados.numero, complemento: dados.complemento });
  const r = resolverContraCandidatos(
    conhecidosNoNumero.map((d) => ({
      id: d.id,
      contextoChave: d.contextoChave,
      contextoNome: d.contextoNome ?? undefined,
      contextoTipo: d.contextoTipo ?? undefined,
    })),
    end,
  );
  switch (r.status) {
    case 'exato':
      return { destinoId: r.destinoId, candidatos: [], criar: null };
    case 'novo':
      return { destinoId: r.destinoId, candidatos: [], criar: proprio };
    case 'sugestao':
    case 'ambiguo':
      return { destinoId: null, candidatos: r.candidatos, criar: null };
  }
}

export function rotuloDestino(d: Destino): string {
  return [d.ruaNome, d.numeroNome, d.contextoNome].filter(Boolean).join(', ');
}
