/**
 * O mínimo que os repositórios SQL precisam de um banco: `prepare().run/get/all` e `exec`.
 * `DatabaseSync` (node:sqlite) já tem exatamente este formato; o Postgres entra por `postgres/bancoPg.ts`.
 * Tudo síncrono: o HUB inteiro foi escrito assim (ver `postgres/ponteSincrona.ts`).
 */
export type Linha = Record<string, unknown>;

export interface Declaracao {
  run(...parametros: unknown[]): { changes: number | bigint };
  get(...parametros: unknown[]): Linha | undefined;
  all(...parametros: unknown[]): Linha[];
}

export interface Db {
  prepare(sql: string): Declaracao;
  exec(sql: string): void;
}

/** Diferenças pequenas de SQL entre os dois motores. */
export type Dialeto = 'sqlite' | 'postgres';
