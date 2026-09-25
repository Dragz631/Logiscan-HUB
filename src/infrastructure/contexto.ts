/** Raiz de composição: liga as portas da aplicação às implementações concretas. */
import { randomUUID } from 'node:crypto';
import type { Contexto } from '../application/portas';
import { reprojetarPacotes } from '../application/registrarEvento';
import { abrirBanco, criarArmazemSqlite } from './sqlite';

export function criarContexto(caminhoBanco: string): Contexto {
  const armazem = criarArmazemSqlite(abrirBanco(caminhoBanco));
  const corrigidos = reprojetarPacotes(armazem); // projeção sempre coerente com o histórico após migrações
  if (corrigidos > 0) console.log(`HUB: ${corrigidos} pacote(s) reprojetado(s) a partir do histórico.`);
  return {
    armazem,
    relogio: { agora: () => new Date().toISOString() },
    ids: { novo: () => randomUUID() },
  };
}
