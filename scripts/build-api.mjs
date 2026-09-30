// Empacota o servidor do HUB para a função da Vercel: api/index.mjs (entrada) + api/_hub/ (servidor empacotado,
// thread do Postgres, migrações e catálogo). O pacote é COMMITADO (npm run build:api antes de subir mudanças no
// servidor): assim o que a Vercel roda é exatamente o que foi testado aqui, sem depender de compilar lá.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const SAIDA = 'api/_hub';
rmSync(SAIDA, { recursive: true, force: true });
mkdirSync(SAIDA, { recursive: true });

const comum = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  logLevel: 'warning',
  legalComments: 'none',
};

// 1) Servidor: Express + HUB em um arquivo só (módulo ES; `require` para as dependências antigas em CJS).
await build({
  ...comum,
  entryPoints: ['src/server/vercel.ts'],
  outfile: `${SAIDA}/servidor.mjs`,
  format: 'esm',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  external: ['pg-native'],
});

// 2) Thread do Postgres: o `pg` embutido (sem precisar de node_modules na função).
await build({
  ...comum,
  entryPoints: ['src/infrastructure/postgres/ponteThread.cjs'],
  outfile: `${SAIDA}/ponteThread.cjs`,
  format: 'cjs',
  external: ['pg-native'],
});

// 3) Arquivos lidos em tempo de execução, ao lado do servidor (caminhos relativos a import.meta.url).
cpSync('src/infrastructure/postgres/migracoes', `${SAIDA}/migracoes`, { recursive: true });
cpSync('src/infrastructure/conhecimento', `${SAIDA}/conhecimento`, { recursive: true });

// 4) Entrada que a Vercel enxerga como função (arquivos em api/_hub não viram função).
writeFileSync('api/index.mjs', "// Gerado por scripts/build-api.mjs. Não edite.\nexport { default } from './_hub/servidor.mjs';\n");
console.log('api/ pronto');
