/**
 * Sobe o HUB numa porta só: API em /api e a interface web no resto.
 * Desenvolvimento: Vite como middleware (recarrega a tela sozinho). Produção: arquivos de `dist/`.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { criarContexto, criarContextoPg, urlDoPostgres } from '../infrastructure/contexto';
import { criarApi } from './app';

/** Raiz do projeto (funciona de qualquer pasta de onde o comando for chamado). */
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
// Variáveis locais (nunca vão para o git): .env.local na raiz do projeto.
if (existsSync(resolve(RAIZ, '.env.local'))) process.loadEnvFile(resolve(RAIZ, '.env.local'));
const PORTA = Number(process.env.PORT ?? 4100);
const PASTA_DADOS = resolve(RAIZ, process.env.HUB_DADOS ?? 'dados');

// Com POSTGRES_URL/DATABASE_URL o HUB usa o Postgres (Supabase); sem, o SQLite do PC, como sempre.
const urlPg = urlDoPostgres();
let ctx: ReturnType<typeof criarContexto>;
if (urlPg) {
  ctx = criarContextoPg(urlPg);
} else {
  mkdirSync(PASTA_DADOS, { recursive: true });
  ctx = criarContexto(resolve(PASTA_DADOS, 'hub.db'));
}
const app = express();
app.use('/api', criarApi(ctx));

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve(RAIZ, 'dist')));
  app.get('/{*resto}', (_req, res) => res.sendFile(resolve(RAIZ, 'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: RAIZ, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(PORTA, () => {
  console.log(`LOGISCAN HUB em http://localhost:${PORTA}  (dados: ${urlPg ? 'Postgres (Supabase)' : PASTA_DADOS})`);
});
