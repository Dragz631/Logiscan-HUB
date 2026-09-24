/**
 * INTELIGÊNCIA DE ENDEREÇO (conservadora)
 *
 * Regra de ouro: NÚMERO IGUAL ≠ MESMO LOCAL, e NÚMERO IGUAL ≠ CONDOMÍNIO.
 * Só se reconhece unidade (Apto, Bloco, Casa 2…) ou contexto (Condomínio X, Loja ABC…)
 * quando o texto traz EVIDÊNCIA EXPLÍCITA: palavra-chave inteira + identificador.
 * O que não for reconhecido vira `residual` (preservado, mas sem efeito de agrupamento).
 *
 * Modelo:
 *   Rua → número → contexto/destino (opcional) → unidade/complemento (opcional)
 * O ID do destino é a própria chave `rua|número|contexto` (determinístico, sem aleatoriedade).
 */
import { capitalizarInicial, chaveTexto, dobrarAcentos, limparEspacos } from './texto';

export type TipoUnidade =
  | 'apto'
  | 'bloco'
  | 'andar'
  | 'sala'
  | 'loja'
  | 'portaria'
  | 'cobertura'
  | 'casa'
  | 'sobrado'
  | 'terreo'
  | 'fundos'
  | 'frente';

/** 'predio' = unidades de edifício; 'casa_interna' = casas/fundos dentro do mesmo número (vila). */
export type FamiliaUnidade = 'predio' | 'casa_interna';

export type TipoContexto = 'condominio' | 'edificio' | 'vila' | 'comercio';

export interface Unidade {
  /** Ex.: "bloco:2|apto:101" */
  chave: string;
  /** Ex.: "Bloco 2 · Apto 101" */
  rotulo: string;
  tipo: TipoUnidade;
  familia: FamiliaUnidade;
}

export interface Contexto {
  /** Ex.: "comercio:loja abc" */
  chave: string;
  /** Ex.: "Loja ABC" */
  nome: string;
  tipo: TipoContexto;
}

export interface ComplementoInterpretado {
  unidade?: Unidade;
  contexto?: Contexto;
  /** Texto não reconhecido (preservado, sem efeito de agrupamento). */
  residual: string;
  evidencias: string[];
}

export interface NumeroInterpretado {
  /** Chave de comparação: "41a", "100", "sn". */
  chave: string;
  /** Exibição: "41A", "100", "S/N". */
  nome: string;
  semNumero: boolean;
  /** Texto que veio "colado" no número (ex.: "100 apto 101" → "apto 101"). */
  extraComplemento: string;
}

export interface EnderecoInterpretado {
  ruaNome: string;
  ruaChave: string;
  numeroNome: string;
  numeroChave: string;
  semNumero: boolean;
  contexto?: Contexto;
  unidade?: Unidade;
  residual: string;
  evidencias: string[];
  /** rua|número|contexto — identidade do destino. */
  destinoId: string;
}

// ---------------------------------------------------------------------------
// Unidades
// ---------------------------------------------------------------------------

const PRIORIDADE: TipoUnidade[] = [
  'apto', 'bloco', 'andar', 'sala', 'loja', 'portaria', 'cobertura', 'casa', 'sobrado', 'terreo', 'fundos', 'frente',
];
const ORDEM_ROTULO: TipoUnidade[] = [
  'bloco', 'apto', 'andar', 'sala', 'loja', 'portaria', 'cobertura', 'casa', 'sobrado', 'terreo', 'fundos', 'frente',
];
const FAMILIA: Record<TipoUnidade, FamiliaUnidade> = {
  apto: 'predio', bloco: 'predio', andar: 'predio', sala: 'predio', loja: 'predio', portaria: 'predio', cobertura: 'predio',
  casa: 'casa_interna', sobrado: 'casa_interna', terreo: 'casa_interna', fundos: 'casa_interna', frente: 'casa_interna',
};
const NOME_UNIDADE: Record<TipoUnidade, string> = {
  apto: 'Apto', bloco: 'Bloco', andar: 'Andar', sala: 'Sala', loja: 'Loja', portaria: 'Portaria', cobertura: 'Cobertura',
  casa: 'Casa', sobrado: 'Sobrado', terreo: 'Térreo', fundos: 'Fundos', frente: 'Frente',
};

interface Parte {
  tipo: TipoUnidade;
  id?: string;
}

// Prefixo opcional "nº" antes do identificador. Trabalha sobre texto dobrado (sem acento, minúsculo).
const NUM = '(?:n[oº°]\\.?\\s*)?';
const RE_APTO = new RegExp(`\\b(?:apartamento|apto|apt|ap)(?![a-z])\\.?\\s*${NUM}([0-9]+[a-z]?)(?![a-z0-9])`, 'g');
const RE_BLOCO = new RegExp(`\\b(?:bloco|blc|bl)(?![a-z])\\.?\\s*${NUM}([0-9]+[a-z]?|[a-z])(?![a-z0-9])`, 'g');
const RE_CASA_ID = new RegExp(`\\bcasa(?![a-z])\\.?\\s*${NUM}([0-9]+[a-z]?)(?![a-z0-9])`, 'g');
const RE_CASA_QUAL = /\bcasa\s+(?:de\s+|do\s+|da\s+|dos\s+)?(fundos|frente|principal)\b/g;
const RE_SALA = new RegExp(`\\bsala(?![a-z])\\.?\\s*${NUM}([0-9]+[a-z]?)(?![a-z0-9])`, 'g');
const RE_LOJA_ID = new RegExp(`\\bloja(?![a-z])\\.?\\s*${NUM}([0-9]+[a-z]?|[a-z])(?![a-z0-9])`, 'g');
const RE_ANDAR_A = /\b([0-9]+)\s*(?:o|º|°)?\s*andar\b/g;
const RE_ANDAR_B = /\bandar\s*([0-9]+)\b/g;
const RE_PORTARIA = /\bportaria\b/g;
const RE_TERREO = /\bterreo\b/g;
const RE_FUNDOS = /\bfundos\b/g;
const RE_SOBRADO = /\bsobrado\b/g;
const RE_COBERTURA = /\bcobertura\b/g;

function tomar(f: string, re: RegExp, usado: boolean[], aoAchar: (m: RegExpExecArray) => void): boolean {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(f))) {
    const ini = m.index;
    const fim = ini + m[0].length;
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    let livre = true;
    for (let i = ini; i < fim; i++) {
      if (usado[i]) {
        livre = false;
        break;
      }
    }
    if (livre) {
      for (let i = ini; i < fim; i++) usado[i] = true;
      aoAchar(m);
      return true;
    }
  }
  return false;
}

function formatarParte(p: Parte): string {
  const nome = NOME_UNIDADE[p.tipo];
  if (!p.id) return nome;
  const ehQualificador = /^[a-z]{3,}$/.test(p.id); // fundos, frente, principal
  return `${nome} ${ehQualificador ? p.id : p.id.toUpperCase()}`;
}

function montarUnidade(partes: Parte[]): Unidade | undefined {
  if (partes.length === 0) return undefined;
  const unicas: Parte[] = [];
  for (const p of partes) if (!unicas.some((u) => u.tipo === p.tipo)) unicas.push(p);
  unicas.sort((a, b) => ORDEM_ROTULO.indexOf(a.tipo) - ORDEM_ROTULO.indexOf(b.tipo));
  const tipo = PRIORIDADE.find((t) => unicas.some((u) => u.tipo === t)) as TipoUnidade;
  const familia: FamiliaUnidade = unicas.some((u) => FAMILIA[u.tipo] === 'predio') ? 'predio' : 'casa_interna';
  return {
    chave: unicas.map((u) => (u.id ? `${u.tipo}:${u.id}` : u.tipo)).join('|'),
    rotulo: unicas.map(formatarParte).join(' · '),
    tipo,
    familia,
  };
}

// ---------------------------------------------------------------------------
// Contextos (lugar nomeado no mesmo número)
// ---------------------------------------------------------------------------

const SEPARADORES_BORDA = /^[\s,;:\-–—/|.]+|[\s,;:\-–—/|.]+$/g;
const RE_KW_PREDIO = /^(condominio|cond|edificio|edif|ed|residencial)(?![a-z])\.?\s*/;
const RE_KW_VILA = /^(vila|vilinha)(?![a-z])\.?\s*/;
const RE_KW_COMERCIO =
  /^(loja|mercado|mercadinho|padaria|farmacia|restaurante|lanchonete|oficina|escritorio|clinica|consultorio|escola|igreja|associacao|posto|bar|empresa|banco|hotel|pousada|academia)(?![a-z])/;

function interpretarContexto(restoOriginal: string): Contexto | undefined {
  const f = dobrarAcentos(restoOriginal).toLowerCase();
  if (!f) return undefined;

  const mp = RE_KW_PREDIO.exec(f);
  if (mp) {
    const kw = mp[1];
    const apos = limparEspacos(restoOriginal.slice(mp[0].length).replace(SEPARADORES_BORDA, ''));
    if (kw === 'residencial') {
      const nome = limparEspacos(restoOriginal);
      return { tipo: 'condominio', nome, chave: `condominio:${chaveTexto(nome)}` };
    }
    if (kw === 'condominio' || kw === 'cond') {
      return { tipo: 'condominio', nome: apos ? `Condomínio ${apos}` : 'Condomínio', chave: `condominio:${chaveTexto(apos)}` };
    }
    return { tipo: 'edificio', nome: apos ? `Edifício ${apos}` : 'Edifício', chave: `edificio:${chaveTexto(apos)}` };
  }

  const mv = RE_KW_VILA.exec(f);
  if (mv) {
    const apos = limparEspacos(restoOriginal.slice(mv[0].length).replace(SEPARADORES_BORDA, ''));
    return { tipo: 'vila', nome: apos ? `Vila ${apos}` : 'Vila', chave: `vila:${chaveTexto(apos)}` };
  }

  if (RE_KW_COMERCIO.test(f)) {
    const nome = capitalizarInicial(limparEspacos(restoOriginal));
    return { tipo: 'comercio', nome, chave: `comercio:${chaveTexto(nome)}` };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Interpretação do complemento
// ---------------------------------------------------------------------------

export function interpretarComplemento(texto?: string | null): ComplementoInterpretado {
  const original = limparEspacos(texto);
  if (!original) return { residual: '', evidencias: [] };

  const f = dobrarAcentos(original).toLowerCase(); // mesmo comprimento de `original`
  const usado: boolean[] = new Array(f.length).fill(false);
  const partes: Parte[] = [];

  tomar(f, RE_BLOCO, usado, (m) => partes.push({ tipo: 'bloco', id: m[1] }));
  tomar(f, RE_APTO, usado, (m) => partes.push({ tipo: 'apto', id: m[1] }));
  tomar(f, RE_ANDAR_A, usado, (m) => partes.push({ tipo: 'andar', id: m[1] })) ||
    tomar(f, RE_ANDAR_B, usado, (m) => partes.push({ tipo: 'andar', id: m[1] }));
  tomar(f, RE_CASA_QUAL, usado, (m) => partes.push({ tipo: 'casa', id: m[1] })) ||
    tomar(f, RE_CASA_ID, usado, (m) => partes.push({ tipo: 'casa', id: m[1] }));
  tomar(f, RE_SALA, usado, (m) => partes.push({ tipo: 'sala', id: m[1] }));
  tomar(f, RE_LOJA_ID, usado, (m) => partes.push({ tipo: 'loja', id: m[1] }));
  tomar(f, RE_PORTARIA, usado, () => partes.push({ tipo: 'portaria' }));
  tomar(f, RE_COBERTURA, usado, () => partes.push({ tipo: 'cobertura' }));
  tomar(f, RE_SOBRADO, usado, () => partes.push({ tipo: 'sobrado' }));
  tomar(f, RE_TERREO, usado, () => partes.push({ tipo: 'terreo' }));
  tomar(f, RE_FUNDOS, usado, () => partes.push({ tipo: 'fundos' }));

  // O que sobrou (unidades viram espaços)
  let resto = '';
  for (let i = 0; i < original.length; i++) resto += usado[i] ? ' ' : original[i];
  let restoLimpo = limparEspacos(resto).replace(SEPARADORES_BORDA, '');

  // "Frente" só vale sozinha ("Frente ao posto" NÃO é evidência).
  if (chaveTexto(restoLimpo) === 'frente') {
    partes.push({ tipo: 'frente' });
    restoLimpo = '';
  }

  const unidade = montarUnidade(partes);
  const contexto = restoLimpo ? interpretarContexto(restoLimpo) : undefined;
  const residual = contexto ? '' : restoLimpo;

  const evidencias: string[] = [];
  if (unidade) evidencias.push(`unidade:${unidade.chave}`);
  if (contexto) evidencias.push(`contexto:${contexto.chave}`);

  return { unidade, contexto, residual, evidencias };
}

// ---------------------------------------------------------------------------
// Número e endereço completo
// ---------------------------------------------------------------------------

export function interpretarNumero(bruto?: string | null): NumeroInterpretado {
  const t = limparEspacos(bruto);
  const f = dobrarAcentos(t).toLowerCase();
  const semNumero = { chave: 'sn', nome: 'S/N', semNumero: true, extraComplemento: '' };

  if (!f || /^(s\s*\/?\s*n\.?|sem\s+numero|sn)$/.test(f.replace(/\.$/, ''))) return semNumero;

  const m = /^(?:n[oº°]?\.?\s*)?([0-9]+)(?:\s*[-/]?\s*([a-z])(?![a-z0-9]))?\s*(.*)$/.exec(f);
  if (m) {
    const extra = m[3] ? t.slice(t.length - m[3].length) : '';
    return {
      chave: `${m[1]}${m[2] ?? ''}`,
      nome: `${m[1]}${(m[2] ?? '').toUpperCase()}`,
      semNumero: false,
      extraComplemento: extra,
    };
  }

  const chave = chaveTexto(t).replace(/ /g, '');
  if (!chave) return semNumero;
  return { chave, nome: t.toUpperCase(), semNumero: false, extraComplemento: '' };
}

export function montarDestinoId(ruaChave: string, numeroChave: string, contextoChave: string): string {
  return `${ruaChave}|${numeroChave}|${contextoChave}`;
}

export function interpretarEndereco(entrada: {
  rua?: string | null;
  numero?: string | null;
  complemento?: string | null;
}): EnderecoInterpretado {
  const ruaNome = limparEspacos(entrada.rua);
  const ruaChave = chaveTexto(ruaNome);
  const numero = interpretarNumero(entrada.numero);
  const comp = interpretarComplemento([numero.extraComplemento, entrada.complemento].filter(Boolean).join(' '));

  return {
    ruaNome,
    ruaChave,
    numeroNome: numero.nome,
    numeroChave: numero.chave,
    semNumero: numero.semNumero,
    contexto: comp.contexto,
    unidade: comp.unidade,
    residual: comp.residual,
    evidencias: comp.evidencias,
    destinoId: montarDestinoId(ruaChave, numero.chave, comp.contexto?.chave ?? ''),
  };
}

/** Texto de complemento que reproduz a evidência (usado ao recriar pacotes a partir da memória). */
export function textoComplemento(contextoNome?: string, unidadeRotulo?: string): string {
  return [contextoNome, unidadeRotulo?.replace(/ · /g, ' ')].filter(Boolean).join(' ');
}
