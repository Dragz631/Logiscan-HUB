// Thread auxiliar da ponte síncrona (ver ponteSincrona.ts): abre UMA conexão com o Postgres e responde às consultas
// que a thread principal manda, acordando-a com Atomics.notify. Arquivo .cjs de propósito: roda sem compilar
// e entra no pacote da Vercel pelo empacotador (scripts/build-api.mjs), que embute o `pg` aqui dentro.
const { workerData } = require('node:worker_threads');
const { Client, types } = require('pg');

types.setTypeParser(20, (v) => Number(v)); // int8 -> number (contadores e chaves inteiras)
types.setTypeParser(1700, (v) => Number(v)); // numeric -> number

const { sinal, porta, url, ssl } = workerData;
const flag = new Int32Array(sinal);
// ssl sem verificar a cadeia: o pooler do Supabase usa certificado próprio. O tráfego segue criptografado.
const cliente = new Client({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : undefined });
const pronto = cliente.connect();
pronto.catch(() => undefined); // o erro volta pela resposta da primeira consulta

porta.on('message', async (m) => {
  let resposta;
  try {
    await pronto;
    if (m.fechar) {
      await cliente.end();
      resposta = { ok: true };
    } else {
      const r = await cliente.query({ text: m.sql, values: m.params });
      resposta = { ok: true, rows: r.rows ?? [], rowCount: r.rowCount ?? 0 };
    }
  } catch (e) {
    resposta = { ok: false, erro: { message: e.message, code: e.code, detail: e.detail, constraint: e.constraint } };
  }
  porta.postMessage(resposta);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});
