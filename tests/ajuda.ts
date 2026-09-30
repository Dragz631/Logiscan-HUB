/**
 * Utilidades de teste: contexto com relógio e IDs determinísticos.
 * Por padrão o banco é SQLite em memória. Com `TESTE_BANCO=pg` (npm run test:pg) os MESMOS testes rodam contra um
 * Postgres de verdade (PGlite servindo o protocolo numa porta local), o que prova que os dois motores se comportam igual.
 */
import { spawn } from 'node:child_process';
import type { Contexto } from '../src/application/portas';
import { criarRegiao, definirRegiao } from '../src/application/regioes';
import { chaveRua } from '../src/domain/ruas';
import type { Db, Dialeto } from '../src/infrastructure/banco';
import { BancoPg, migrarPg } from '../src/infrastructure/postgres/bancoPg';
import { PonteSincrona } from '../src/infrastructure/postgres/ponteSincrona';
import { abrirBanco, criarArmazemSqlite } from '../src/infrastructure/sqlite';

export const DIALETO_DE_TESTE: Dialeto = process.env.TESTE_BANCO === 'pg' ? 'postgres' : 'sqlite';

let bancoPg: BancoPg | undefined;

/** Sobe (uma vez por processo de teste) um Postgres local e espera ele aceitar conexão, tudo de forma síncrona. */
function bancoPgDeTeste(): BancoPg {
  if (bancoPg) return bancoPg;
  const porta = 50000 + Math.floor(Math.random() * 10000);
  const filho = spawn(process.execPath, ['scripts/servidor-pglite.mjs', String(porta), String(process.pid)], { stdio: 'ignore' });
  filho.unref();
  process.on('exit', () => filho.kill('SIGTERM'));
  const url = `postgres://postgres:postgres@127.0.0.1:${porta}/postgres`;
  const limite = Date.now() + 60_000;
  for (;;) {
    const ponte = new PonteSincrona({ url, tempoMaximoMs: 5_000 });
    try {
      ponte.consulta('SELECT 1');
      bancoPg = new BancoPg(ponte);
      return bancoPg;
    } catch (e) {
      ponte.fechar();
      if (Date.now() > limite) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300); // espera 300 ms e tenta de novo
    }
  }
}

/** Um banco novo e vazio, já com todas as migrações, no motor escolhido para os testes. */
export function bancoDeTeste(): Db {
  if (DIALETO_DE_TESTE === 'postgres') {
    const db = bancoPgDeTeste();
    migrarPg(db, true);
    return db;
  }
  return abrirBanco(':memory:');
}

export function contextoDeTeste(): Contexto & { avancar(min: number): void } {
  let t = Date.parse('2026-09-23T13:00:00Z');
  let n = 0;
  return {
    armazem: criarArmazemSqlite(bancoDeTeste(), DIALETO_DE_TESTE),
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
