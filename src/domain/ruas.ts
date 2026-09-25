/**
 * RUA (logradouro) — a unidade de repasse do Orquestrador.
 *
 *   Região (mapa operacional)  →  Rua (logradouro)  →  Destino (nº + contexto)  →  Pacote
 *
 * A rua é DERIVADA dos pacotes (não é cadastro à parte) e o seu estado também:
 *   DISPONIVEL → nenhum pacote com ajudante;
 *   ATRIBUIDA  → pacotes com ajudante, ainda no galpão (carga montada);
 *   EM_ROTA    → algum pacote na rua;
 *   CONCLUIDA  → todos os pacotes com ajudante já tiveram desfecho.
 * Agrupar por rua nunca mexe no destino: dois locais no mesmo número continuam separados.
 */
import { ESTADOS_DESFECHO } from './carga';
import { chaveTexto, limparEspacos } from './destino/texto';
import type { EstadoPacote, Pacote } from './pacote';

export type EstadoRua = 'DISPONIVEL' | 'ATRIBUIDA' | 'EM_ROTA' | 'CONCLUIDA';

/** Mesma chave de logradouro do Street/regra de destino (sem acento, minúsculo). */
export function chaveRua(rua: string): string {
  return chaveTexto(limparEspacos(rua));
}

export interface ResumoRua {
  chave: string;
  /** Grafia mais frequente entre os pacotes. */
  nome: string;
  total: number;
  /** Sem responsável (NAO_ATRIBUIDO) — é o que entra numa atribuição nova. */
  disponiveis: number;
  /** Com ajudante (atribuídos, em carga, em rota ou com desfecho numa carga ativa). */
  atribuidos: number;
  emRota: number;
  entregues: number;
  insucessos: number;
  revisao: number;
  /** Destinos distintos na rua (nº + contexto). */
  destinos: number;
  responsaveis: string[];
  cargaIds: string[];
  estado: EstadoRua;
}

/**
 * Pacotes que fazem parte da operação corrente: no galpão ou na rua, ou com desfecho
 * dentro de uma carga ainda ativa (não finalizada).
 */
export function naOperacao(p: Pacote, cargasAtivas: ReadonlySet<string>): boolean {
  if (p.estado === 'NAO_ATRIBUIDO' || p.estado === 'ATRIBUIDO' || p.estado === 'EM_ROTA') return true;
  return p.cargaId !== null && cargasAtivas.has(p.cargaId);
}

export function estadoDaRua(estados: EstadoPacote[]): EstadoRua {
  const comAjudante = estados.filter((e) => e !== 'NAO_ATRIBUIDO');
  if (comAjudante.length === 0) return 'DISPONIVEL';
  if (comAjudante.some((e) => e === 'EM_ROTA')) return 'EM_ROTA';
  if (comAjudante.every((e) => ESTADOS_DESFECHO.includes(e))) return 'CONCLUIDA';
  return 'ATRIBUIDA';
}

export function agruparPorRua(pacotes: Pacote[]): ResumoRua[] {
  const grupos = new Map<string, Pacote[]>();
  for (const p of pacotes) {
    const chave = chaveRua(p.dados.rua);
    if (!chave) continue;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave)!.push(p);
  }
  return [...grupos].map(([chave, lista]) => {
    const grafias = new Map<string, number>();
    for (const p of lista) grafias.set(limparEspacos(p.dados.rua), (grafias.get(limparEspacos(p.dados.rua)) ?? 0) + 1);
    const nome = [...grafias].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const conta = (f: (p: Pacote) => boolean) => lista.filter(f).length;
    return {
      chave,
      nome,
      total: lista.length,
      disponiveis: conta((p) => p.estado === 'NAO_ATRIBUIDO'),
      atribuidos: conta((p) => p.responsavelId !== null),
      emRota: conta((p) => p.estado === 'EM_ROTA'),
      entregues: conta((p) => p.estado === 'ENTREGUE'),
      insucessos: conta((p) => p.estado === 'INSUCESSO'),
      revisao: conta((p) => p.pendencias.length > 0),
      destinos: new Set(lista.map((p) => p.destinoId ?? `sem-destino:${p.id}`)).size,
      responsaveis: [...new Set(lista.map((p) => p.responsavelId).filter((r): r is string => !!r))],
      cargaIds: [...new Set(lista.map((p) => p.cargaId).filter((c): c is string => !!c))],
      estado: estadoDaRua(lista.map((p) => p.estado)),
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
