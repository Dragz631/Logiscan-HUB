/** Raiz de composição: liga as portas da aplicação às implementações concretas. */
import { randomUUID } from 'node:crypto';
import type { Contexto } from '../application/portas';
import { abrirBanco, criarArmazemSqlite } from './sqlite';

export function criarContexto(caminhoBanco: string): Contexto {
  return {
    armazem: criarArmazemSqlite(abrirBanco(caminhoBanco)),
    relogio: { agora: () => new Date().toISOString() },
    ids: { novo: () => randomUUID() },
  };
}
