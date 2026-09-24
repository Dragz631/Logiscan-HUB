/**
 * Sobe o HUB numa porta só: API em /api e a interface web no resto.
 * Desenvolvimento: Vite como middleware (recarrega a tela sozinho). Produção: arquivos de `dist/`.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { criarContexto } from '../infrastructure/contexto';
import { criarApi } from './app';

/** Raiz do projeto (funciona de qualquer pasta de onde o comando for chamado). */
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const PORTA = Number(process.env.PORT ?? 4100);
const PASTA_DADOS = resolve(RAIZ, process.env.HUB_DADOS ?? 'dados');
mkdirSync(PASTA_DADOS, { recursive: true });

const ctx = criarContexto(resolve(PASTA_DADOS, 'hub.db'));
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
  console.log(`LOGISCAN HUB em http://localhost:${PORTA}  (dados: ${PASTA_DADOS})`);
});
