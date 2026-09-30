/** Raiz de composição: liga as portas da aplicação às implementações concretas. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { garantirMaster } from '../application/contas';
import type { Contexto } from '../application/portas';
import { reprojetarPacotes } from '../application/registrarEvento';
import { type ConhecimentoInicial, aplicarConhecimentoInicial } from '../application/regioes';
import type { Armazem } from '../application/portas';
import type { Db, Dialeto } from './banco';
import { abrirBancoPg } from './postgres/bancoPg';
import { abrirBanco, criarArmazemSqlite } from './sqlite';

/** Endereço do Postgres, se o ambiente tem um (Supabase na Vercel: POSTGRES_URL; fora dela: DATABASE_URL). */
export function urlDoPostgres(): string | undefined {
  return process.env.POSTGRES_URL || process.env.DATABASE_URL || undefined;
}

/** Tira os parâmetros da URL (`?sslmode=require&supa=...`) e decide o TLS: o pg novo trata `sslmode=require` como verificação total. */
export function prepararConexaoPg(url: string): { url: string; ssl: boolean } {
  const u = new URL(url);
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  u.search = '';
  return { url: u.toString(), ssl: !local };
}

function montarContexto(db: Db, dialeto: Dialeto): Contexto {
  const armazem: Armazem = criarArmazemSqlite(db, dialeto);
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
  garantirMasterDoAmbiente(ctx);
  return ctx;
}

/** A conta master nasce das variáveis de ambiente (sem PIN: o PIN é definido no primeiro acesso, com o código de uso único). */
function garantirMasterDoAmbiente(ctx: Contexto): void {
  const usuario = process.env.HUB_MASTER_USUARIO;
  if (!usuario) return;
  const r = garantirMaster(ctx, {
    usuario,
    nome: process.env.HUB_MASTER_NOME || undefined,
    ajudanteNome: process.env.HUB_MASTER_AJUDANTE || undefined,
    codigoDeAtivacao: process.env.HUB_MASTER_ATIVACAO || undefined,
  });
  if (r.criada) console.log(`HUB: conta master "${usuario}" criada (aguardando o primeiro acesso para definir o PIN).`);
}

/** HUB do PC: SQLite em arquivo. */
export function criarContexto(caminhoBanco: string): Contexto {
  return montarContexto(abrirBanco(caminhoBanco), 'sqlite');
}

/** HUB na nuvem: Postgres (Supabase), pela ponte síncrona. */
export function criarContextoPg(url: string): Contexto {
  const c = prepararConexaoPg(url);
  return montarContexto(abrirBancoPg({ url: c.url, ssl: c.ssl }), 'postgres');
}
