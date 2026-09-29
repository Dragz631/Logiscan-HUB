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

// ---------------------------------------------------------------------------
// Erro de digitação confirmado pelo CEP
// ---------------------------------------------------------------------------

const LIGACOES = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/** Distância de edição (Levenshtein) — quantas letras trocar/incluir/tirar para ir de a até b. */
function distancia(a: string, b: string): number {
  const linha = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = linha[0];
    linha[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const acima = linha[j];
      linha[j] = Math.min(linha[j] + 1, linha[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = acima;
    }
  }
  return linha[b.length];
}

/**
 * Nomes QUASE iguais (cara de erro de digitação/OCR): mesmo tipo de logradouro (ou um deles sem tipo) e o nome próprio
 * difere em no máximo 1 letra a cada 8 (máx. 2), ignorando "de/da/do". Nome curto (menos de 6 letras)
 * nunca entra: "Rua A" × "Rua E" são ruas diferentes. Sozinho NÃO prova nada — só junto com o CEP.
 */
export function nomeQuaseIgual(a: string, b: string): boolean {
  const pa = partesDoLogradouro(idLogradouro(a));
  const pb = partesDoLogradouro(idLogradouro(b));
  if (pa.tipo !== null && pb.tipo !== null && pa.tipo !== pb.tipo) return false; // Rua ≠ Travessa; sem tipo compara o nome
  const na = pa.nucleo.split(' ').filter((t) => !LIGACOES.has(t)).join(' ');
  const nb = pb.nucleo.split(' ').filter((t) => !LIGACOES.has(t)).join(' ');
  if (na === nb) return na.length > 0;
  const menor = Math.min(na.length, nb.length);
  if (menor < 6) return false;
  return distancia(na, nb) <= Math.min(2, Math.max(1, Math.floor(menor / 8)));
}

export const normalizarCep = (cep: string | null | undefined) => (cep ?? '').replace(/\D/g, '');

/**
 * O CEP tira a dúvida de digitação: MESMO CEP + nome quase igual = a mesma rua
 * ("Monsenhor Manuel Gomes" × "Monsenhor Manoel Gomes", 20931-670). O CEP sozinho NÃO junta ruas —
 * no Caju um CEP cobre várias ("Rua E" e "Rua Leão XIII" = 20931-030) — e nome parecido com CEP
 * diferente continua sendo outra rua ("Carlos Seidl" 20931-002 × "Carlos Seixas" 20931-007).
 */
export function mesmaRuaPorCep(a: { nome: string; cep: string }, b: { nome: string; cep: string }): boolean {
  const ca = normalizarCep(a.cep);
  return ca.length === 8 && ca === normalizarCep(b.cep) && nomeQuaseIgual(a.nome, b.nome);
}
