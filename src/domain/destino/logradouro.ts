/**
 * IDENTIDADE DO LOGRADOURO (street_id) — a MESMA regra no Street e no LogiScan HUB.
 * Este arquivo é a fonte; o HUB guarda uma cópia fiel (conferida por `npm run check:destino` lá).
 *
 * O id resolve só diferenças de ESCRITA do mesmo nome:
 *  - maiúsculas/minúsculas, acentos, espaços e pontuação ("RUA GENERAL GURJÃO" = "Rua General Gurjão");
 *  - abreviações seguras ("R." = "Rua", "Av." = "Avenida", "Gal." = "General", "N. Sra." = "Nossa Senhora").
 * O id NUNCA junta nomes diferentes só porque são parecidos: "Carlos Seidl" ≠ "Carlos Seixas",
 * "Rua A" ≠ "Travessa A". Região também não mexe na identidade (região organiza, não funde ruas).
 *
 * Nome sem tipo ("PRAIA DO CAJU") só vira um logradouro conhecido com tipo ("Rua Praia do Caju")
 * quando existe UM único conhecido com aquele mesmo nome — senão fica desconhecido (revisão humana).
 */
import { chaveTexto, limparEspacos } from './texto';

/** Tipo de logradouro por extenso, e as abreviações seguras de cada um (só no início do nome). */
const TIPOS: Record<string, string> = {
  rua: 'rua', r: 'rua',
  avenida: 'avenida', av: 'avenida',
  travessa: 'travessa', tv: 'travessa', trav: 'travessa',
  beco: 'beco',
  praca: 'praca', pc: 'praca', pca: 'praca',
  estrada: 'estrada', estr: 'estrada',
  alameda: 'alameda', al: 'alameda',
  largo: 'largo', lgo: 'largo',
  ladeira: 'ladeira', lad: 'ladeira',
  rodovia: 'rodovia', rod: 'rodovia',
  vila: 'vila',
  viela: 'viela',
};

/** Títulos abreviados dentro do nome (palavra inteira). */
const TITULOS: Record<string, string> = {
  gen: 'general', gal: 'general',
  cel: 'coronel',
  mons: 'monsenhor',
  dr: 'doutor', dra: 'doutora',
  sta: 'santa', sto: 'santo',
  prof: 'professor', profa: 'professora',
  mal: 'marechal',
  alm: 'almirante',
  pres: 'presidente',
  ten: 'tenente',
  sra: 'senhora',
  nsa: 'nossa',
};

/** Chave canônica do logradouro = street_id. Vazio quando não há nome. */
export function idLogradouro(nome: string | null | undefined): string {
  const tokens = chaveTexto(nome).split(' ').filter(Boolean);
  const saida = tokens.map((t, i) => (i === 0 && TIPOS[t] ? TIPOS[t] : (TITULOS[t] ?? t)));
  // "N. Sra." / "Ns. Sra." → "nossa senhora"
  for (let i = 0; i < saida.length - 1; i++) {
    if ((saida[i] === 'n' || saida[i] === 'ns') && saida[i + 1] === 'senhora') saida[i] = 'nossa';
  }
  return saida.join(' ');
}

/** Separa o tipo ("rua", "travessa"…) do nome próprio. */
export function partesDoLogradouro(id: string): { tipo: string | null; nucleo: string } {
  const [primeiro, ...resto] = id.split(' ');
  if (primeiro && resto.length > 0 && Object.values(TIPOS).includes(primeiro)) return { tipo: primeiro, nucleo: resto.join(' ') };
  return { tipo: null, nucleo: id };
}

export type ResolucaoLogradouro =
  /** Mesmo logradouro de um conhecido (escrita diferente, mesmo id). */
  | { como: 'igual'; id: string; nome: string }
  /** Veio sem tipo e existe UM conhecido com tipo e o mesmo nome ("Praia do Caju" → "Rua Praia do Caju"). */
  | { como: 'sem_tipo'; id: string; nome: string }
  /** Não reconhecido: não inventa — quem decide é uma pessoa. */
  | { como: 'desconhecido'; id: string; nome: string };

/**
 * Encaixa um nome recebido num logradouro conhecido (lista de nomes como aparecem nos cards).
 * Ordem: (só se veio sem tipo) único conhecido com tipo e mesmo nome → mesmo id → desconhecido.
 * O sem-tipo vem antes porque a própria grafia sem tipo pode estar na lista (ex.: uma aba antiga "PRAIA DO CAJU").
 */
export function resolverLogradouro(nome: string, conhecidos: readonly string[]): ResolucaoLogradouro {
  const id = idLogradouro(nome);
  const limpo = limparEspacos(nome);
  if (!id) return { como: 'desconhecido', id, nome: limpo };
  const { tipo, nucleo } = partesDoLogradouro(id);
  if (tipo === null) {
    const porNome = new Map<string, string>();
    for (const c of conhecidos) {
      const cid = idLogradouro(c);
      const p = partesDoLogradouro(cid);
      if (p.tipo !== null && p.nucleo === nucleo && !porNome.has(cid)) porNome.set(cid, limparEspacos(c));
    }
    if (porNome.size === 1) {
      const [[cid, cnome]] = [...porNome];
      return { como: 'sem_tipo', id: cid, nome: cnome };
    }
  }
  const igual = conhecidos.find((c) => idLogradouro(c) === id);
  if (igual) return { como: 'igual', id, nome: limparEspacos(igual) };
  return { como: 'desconhecido', id, nome: limpo };
}
