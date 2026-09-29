/** Utilidades de teste: contexto em memória com relógio e IDs determinísticos. */
import type { Contexto } from '../src/application/portas';
import { criarRegiao, definirRegiao } from '../src/application/regioes';
import { chaveRua } from '../src/domain/ruas';
import { abrirBanco, criarArmazemSqlite } from '../src/infrastructure/sqlite';

export function contextoDeTeste(): Contexto & { avancar(min: number): void } {
  let t = Date.parse('2026-09-23T13:00:00Z');
  let n = 0;
  return {
    armazem: criarArmazemSqlite(abrirBanco(':memory:')),
    relogio: { agora: () => new Date(t).toISOString() },
    ids: { novo: () => `id-${String(++n).padStart(4, '0')}` },
    avancar(min: number) {
      t += min * 60_000;
    },
  };
}

type P = Partial<{
  tracking_code: string; recipient_name: string; street: string; number: string; complement: string; cep: string;
  review_items: { reason: string; code: string; field: string }[];
}>;

export function pacote(p: P, card = 0): Record<string, unknown> {
  return {
    tracking_code: 'X',
    recipient_name: 'João',
    street: 'Rua X',
    street_detail: '',
    number: '100',
    complement: '',
    neighborhood: 'CAJU',
    city: 'Rio de Janeiro',
    state: 'RJ',
    cep: '20931002',
    card_datetime: '2026-08-31 10:16:30',
    tags: [],
    address_raw: '',
    normalizations: [],
    suggestions: [],
    source: { file: 'IMG_0001.PNG', card_index: card, bbox: [0, 0, 1, 1] },
    review_items: [],
    warnings: [],
    ...p,
  };
}

export function documento(pacotes: Record<string, unknown>[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 'logiscan.import/v0',
    source: 'jtexpress',
    extractor: { name: 'jt-extractor', version: '0.1.0' },
    generated_at: '2026-09-23T23:39:52+00:00',
    summary: { packages: pacotes.length },
    inputs: [],
    packages: pacotes,
    duplicates: [],
    ...extra,
  });
}

/**
 * V0.5: cada rua dos pacotes na SUA caixa (como as caixas de rua do Hugo: "Rua Carlos Seidl" = caixa 1).
 * Não mexe em rua que já tem caixa nem nas ruas de `exceto`. Nome da caixa = grafia mais comum da rua.
 */
export function caixaParaCadaRua(ctx: Contexto, exceto: string[] = []): void {
  const fora = new Set(exceto.map(chaveRua));
  const nomes = new Map<string, string>();
  for (const p of ctx.armazem.pacotes.listar()) {
    const k = chaveRua(p.dados.rua);
    if (!k || fora.has(k) || ctx.armazem.regioes.associacao(k) || nomes.has(k)) continue;
    nomes.set(k, p.dados.rua.replace(/\s+/g, ' ').trim());
  }
  for (const nome of nomes.values()) {
    const caixa = criarRegiao(ctx, nome, 'Galpão');
    definirRegiao(ctx, { rua: nome, regiaoId: caixa.id, ator: 'Galpão' });
  }
}
