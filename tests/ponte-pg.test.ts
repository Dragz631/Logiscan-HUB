/**
 * A ponte síncrona para o Postgres, contra um Postgres de verdade (PGlite servindo o protocolo numa porta local,
 * em processo separado).
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroPostgres, PonteSincrona } from '../src/infrastructure/postgres/ponteSincrona';

const PORTA = 54329;
let servidor: ChildProcess;
let ponte: PonteSincrona;

beforeAll(async () => {
  servidor = spawn(process.execPath, ['scripts/servidor-pglite.mjs', String(PORTA)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((ok, falha) => {
    const t = setTimeout(() => falha(new Error('servidor PGlite não subiu')), 30_000);
    servidor.stdout!.on('data', (d) => {
      if (String(d).includes('pronto')) {
        clearTimeout(t);
        ok();
      }
    });
    servidor.on('exit', () => falha(new Error('servidor PGlite saiu')));
  });
  ponte = new PonteSincrona({ url: `postgres://postgres:postgres@127.0.0.1:${PORTA}/postgres`, tempoMaximoMs: 20_000 });
}, 60_000);

afterAll(() => {
  try {
    ponte?.fechar();
  } finally {
    servidor?.kill('SIGTERM');
  }
});

describe('ponte síncrona para o Postgres', () => {
  it('1. consulta, insere e lê de forma síncrona (inteiros e texto voltam como number e string)', () => {
    ponte.consulta('CREATE TABLE ponte_t (id TEXT PRIMARY KEY, n BIGINT NOT NULL, txt TEXT)');
    expect(ponte.consulta('INSERT INTO ponte_t (id, n, txt) VALUES ($1, $2, $3)', ['a', 7, 'olá ação']).rowCount).toBe(1);
    const r = ponte.consulta('SELECT id, n, txt, COUNT(*) OVER () AS total FROM ponte_t');
    expect(r.rows).toEqual([{ id: 'a', n: 7, txt: 'olá ação', total: 1 }]);
  });

  it('2. transação: ROLLBACK desfaz e COMMIT grava, na mesma conexão', () => {
    ponte.consulta('BEGIN');
    ponte.consulta("INSERT INTO ponte_t (id, n) VALUES ('b', 1)");
    ponte.consulta('ROLLBACK');
    expect(ponte.consulta("SELECT 1 FROM ponte_t WHERE id = 'b'").rowCount).toBe(0);
    ponte.consulta('BEGIN');
    ponte.consulta("INSERT INTO ponte_t (id, n) VALUES ('c', 2)");
    ponte.consulta('COMMIT');
    expect(ponte.consulta("SELECT 1 FROM ponte_t WHERE id = 'c'").rowCount).toBe(1);
  });

  it('3. erro do Postgres vira ErroPostgres com código e restrição; a conexão continua usável', () => {
    let erro: ErroPostgres | undefined;
    try {
      ponte.consulta("INSERT INTO ponte_t (id, n) VALUES ('a', 9)");
    } catch (e) {
      erro = e as ErroPostgres;
    }
    expect(erro).toBeInstanceOf(ErroPostgres);
    expect(erro?.codigo).toBe('23505');
    expect(ponte.consulta('SELECT 1 AS um').rows).toEqual([{ um: 1 }]);
  });

  it('4. desempenho: 300 consultas seguidas (ordem de grandeza de uma importação)', () => {
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) ponte.consulta('SELECT $1::int AS i', [i]);
    const ms = performance.now() - t0;
    console.log(`300 consultas em ${Math.round(ms)} ms (${(ms / 300).toFixed(2)} ms cada, servidor local)`);
    expect(ms).toBeLessThan(15_000);
  });
});
