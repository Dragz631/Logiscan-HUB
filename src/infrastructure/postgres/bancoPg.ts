/**
 * Banco Postgres com o mesmo formato (`Db`) do node:sqlite, para os repositórios SQL servirem aos dois.
 * As consultas vão pela ponte síncrona (`ponteSincrona.ts`). Só traduz o que é diferente no texto do SQL:
 * os parâmetros `?` viram `$1, $2…`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db, Declaracao, Linha } from '../banco';
import { PonteSincrona } from './ponteSincrona';

const PASTA_MIGRACOES = fileURLToPath(new URL('./migracoes/', import.meta.url));

/** `?` → `$n`, sem mexer em nada que esteja entre aspas simples ou duplas. */
export function paraParametrosPg(sql: string): string {
  let saida = '';
  let n = 0;
  let aspas: string | null = null;
  for (const c of sql) {
    if (aspas) {
      if (c === aspas) aspas = null;
      saida += c;
    } else if (c === "'" || c === '"') {
      aspas = c;
      saida += c;
    } else if (c === '?') {
      saida += `$${++n}`;
    } else {
      saida += c;
    }
  }
  return saida;
}

export class BancoPg implements Db {
  constructor(readonly ponte: PonteSincrona) {}

  prepare(sql: string): Declaracao {
    const texto = paraParametrosPg(sql);
    return {
      run: (...p) => ({ changes: this.ponte.consulta(texto, p).rowCount }),
      get: (...p) => this.ponte.consulta(texto, p).rows[0] as Linha | undefined,
      all: (...p) => this.ponte.consulta(texto, p).rows as Linha[],
    };
  }

  exec(sql: string): void {
    this.ponte.consulta(sql);
  }

  fechar(): void {
    this.ponte.fechar();
  }
}

export interface OpcoesBancoPg {
  url: string;
  /** TLS (Supabase exige). */
  ssl?: boolean;
  /** Só para testes: apaga tudo e recomeça do zero. NUNCA usar com o banco de verdade. */
  reiniciar?: boolean;
}

/** Aplica as migrações que faltam (mesma tabela `migracoes` do SQLite). */
export function migrarPg(db: BancoPg, reiniciar = false): void {
  if (reiniciar) db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  db.exec('CREATE TABLE IF NOT EXISTS migracoes (nome TEXT PRIMARY KEY, aplicada_em TEXT NOT NULL)');
  db.exec('ALTER TABLE migracoes ENABLE ROW LEVEL SECURITY'); // sem política: a API pública do Supabase não enxerga
  const aplicadas = new Set(db.prepare('SELECT nome FROM migracoes').all().map((r) => String(r.nome)));
  for (const nome of readdirSync(PASTA_MIGRACOES).filter((f) => f.endsWith('.sql')).sort()) {
    if (aplicadas.has(nome)) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(PASTA_MIGRACOES + nome, 'utf8'));
      db.prepare('INSERT INTO migracoes (nome, aplicada_em) VALUES (?, ?)').run(nome, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

/** Abre o Postgres e aplica as migrações que faltam. */
export function abrirBancoPg(opcoes: OpcoesBancoPg): BancoPg {
  const db = new BancoPg(new PonteSincrona({ url: opcoes.url, ssl: opcoes.ssl }));
  migrarPg(db, opcoes.reiniciar);
  return db;
}
