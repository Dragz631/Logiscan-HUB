/** Raiz de composição: liga as portas da aplicação às implementações concretas. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type ConhecimentoInicial, aplicarConhecimentoInicial } from '../application/regioes';
import type { Contexto } from '../application/portas';
import { reprojetarPacotes } from '../application/registrarEvento';
import { abrirBanco, criarArmazemSqlite } from './sqlite';

export function criarContexto(caminhoBanco: string): Contexto {
  const armazem = criarArmazemSqlite(abrirBanco(caminhoBanco));
  const corrigidos = reprojetarPacotes(armazem); // projeção sempre coerente com o histórico após migrações
  if (corrigidos > 0) console.log(`HUB: ${corrigidos} pacote(s) reprojetado(s) a partir do histórico.`);
  const ctx: Contexto = {
    armazem,
    relogio: { agora: () => new Date().toISOString() },
    ids: { novo: () => randomUUID() },
  };
  // Conhecimento operacional inicial (dado editável, ex.: Manilha). Nunca sobrescreve decisões do operador.
  const conhecimento = JSON.parse(
    readFileSync(new URL('./conhecimento/conhecimento-inicial.json', import.meta.url), 'utf8'),
  ) as ConhecimentoInicial;
  const r = aplicarConhecimentoInicial(ctx, conhecimento);
  if (r.regioesCriadas.length || r.ruasAssociadas || r.caixasConfiguradas.length) {
    console.log(
      `HUB: catálogo de caixas aplicado — caixas novas: ${r.regioesCriadas.join(', ') || 'nenhuma'}; ` +
        `caixas configuradas: ${r.caixasConfiguradas.join(', ') || 'nenhuma'}; ruas associadas: ${r.ruasAssociadas}.`,
    );
  }
  if (r.conflitos.length) console.log(`HUB: conhecimento inicial NÃO aplicado (decisão do operador mantida): ${r.conflitos.join('; ')}`);
  return ctx;
}
