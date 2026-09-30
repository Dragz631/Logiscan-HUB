/**
 * Entrada do HUB na VERCEL: uma função que recebe todo pedido de /api/* e entrega ao mesmo Express do HUB do PC.
 * O banco é o Postgres do Supabase (POSTGRES_URL). Na Vercel o login é sempre obrigatório (variável VERCEL).
 * A primeira chamada de cada instância abre a conexão, aplica as migrações que faltam e garante a conta master.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import express from 'express';
import { criarContextoPg, urlDoPostgres } from '../infrastructure/contexto';
import { criarApi } from './app';

let app: express.Express | undefined;

function montar(): express.Express {
  const url = urlDoPostgres();
  if (!url) throw new Error('POSTGRES_URL não está configurada nesta instalação');
  const ctx = criarContextoPg(url);
  const a = express();
  a.disable('x-powered-by');
  a.use('/api', criarApi(ctx));
  return a;
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  try {
    app ??= montar();
  } catch (e) {
    console.error('HUB: falha ao iniciar', e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ erro: 'INICIALIZACAO', codigo: 'INICIALIZACAO', mensagem: 'o HUB não conseguiu iniciar (veja os logs da Vercel)' }));
    return;
  }
  app(req, res);
}
