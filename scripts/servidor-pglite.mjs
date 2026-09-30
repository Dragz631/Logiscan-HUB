// Servidor Postgres local (PGlite) para os testes: fala o protocolo do Postgres numa porta TCP.
// Roda em PROCESSO SEPARADO porque a ponte síncrona bloqueia a thread de quem consulta.
// Uso: node scripts/servidor-pglite.mjs <porta> [pid-do-pai]   (sai sozinho quando o pai morre)
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const porta = Number(process.argv[2] ?? 54329);
const pai = Number(process.argv[3] ?? 0);

const db = await PGlite.create();
const servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1' });
await servidor.start();
console.log(`pronto ${porta}`);

async function sair() {
  try {
    await servidor.stop();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', sair);
if (pai > 0) {
  setInterval(() => {
    try {
      process.kill(pai, 0);
    } catch {
      void sair();
    }
  }, 2000).unref();
  // `unref` acima não segura o processo vivo; o servidor TCP aberto é quem segura.
}
