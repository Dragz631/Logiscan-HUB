/**
 * Importação pela API HTTP de verdade (Express numa porta local) + cliente que classifica as falhas.
 * Contrato ≠ conexão ≠ erro interno ≠ pedido recusado — cada um com a sua mensagem.
 */
import { readFileSync, existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import type { Contexto } from '../src/application/portas';
import { criarApi } from '../src/server/app';
import { ErroApi, requisitar } from '../src/web/requisicao';
import { contextoDeTeste, documento, pacote } from './ajuda';

const abertos: { close: () => void }[] = [];
afterEach(() => abertos.splice(0).forEach((s) => s.close()));

async function subir(ctx: Contexto = contextoDeTeste()) {
  const app = express();
  app.use('/api', criarApi(ctx));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  abertos.push(srv);
  return `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api`;
}

const importar = (base: string, conteudo: string) =>
  requisitar<{ ok: boolean; loteId?: string; jaRecebido?: boolean; erros?: string[] }>(
    `${base}/importacoes`,
    { body: { arquivo: 'jt_import.json', conteudo } },
    [422],
  );

const REAL = '../JT-Extractor/saida/jt_import.json';

describe('importação pela API', () => {
  it('21. JSON válido importa (e o JSON REAL do JT-Extractor também)', async () => {
    const base = await subir();
    expect(await importar(base, documento([pacote({ tracking_code: 'A' })]))).toMatchObject({ ok: true, jaRecebido: false });
    if (existsSync(REAL)) {
      const r = await importar(base, readFileSync(REAL, 'utf8'));
      expect(r).toMatchObject({ ok: true, jaRecebido: false });
    }
  });

  it('22. JSON inválido → erro de CONTRATO com o campo que divergiu (não é falha de rede)', async () => {
    const base = await subir();
    const r = await importar(base, documento([{ ...pacote({}), tracking_code: 123 }]));
    expect(r.ok).toBe(false);
    expect(r.erros?.join('\n')).toContain('packages.0.tracking_code');
  });

  it('23. servidor indisponível → erro de CONEXÃO (e não "contrato")', async () => {
    const base = await subir();
    abertos.splice(0).forEach((s) => s.close()); // derruba o HUB
    await new Promise((r) => setTimeout(r, 50));
    const e = await importar(base, documento([pacote({ tracking_code: 'A' })])).catch((x) => x);
    expect(e).toBeInstanceOf(ErroApi);
    expect(e).toMatchObject({ tipo: 'conexao', status: null });
    expect(e.message).toMatch(/não respondeu/);
  });

  it('24. erro HTTP mostra o erro real: 500 = servidor; 413/400 = pedido recusado', async () => {
    const quebrado = contextoDeTeste();
    quebrado.armazem.transacao = () => {
      throw new Error('disco cheio');
    };
    const base500 = await subir(quebrado);
    const e500 = await importar(base500, documento([pacote({ tracking_code: 'A' })])).catch((x) => x);
    expect(e500).toMatchObject({ tipo: 'servidor', status: 500 });

    const base = await subir();
    // pedido recusado (4xx) pequeno: arquivo vazio
    const e400 = await requisitar(`${base}/importacoes`, { body: { arquivo: 'x', conteudo: '' } }, [422]).catch((x) => x);
    expect(e400).toMatchObject({ tipo: 'requisicao', status: 400, codigo: 'ENTRADA_INVALIDA' });

    // acima do limite de 25 MB: um único envio cru (sem várias cópias do texto na memória)
    const grande = await fetch(`${base}/importacoes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.alloc(26 * 1024 * 1024, 0x20),
    });
    expect(grande.status).toBe(413);
    expect(await grande.json()).toMatchObject({ erro: 'ARQUIVO_GRANDE_DEMAIS' });

    const res = await fetch(`${base}/importacoes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{quebrado' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ erro: 'CORPO_INVALIDO' });
  });

  it('25. reimportação do mesmo arquivo continua idempotente', async () => {
    const base = await subir();
    const conteudo = documento([pacote({ tracking_code: 'A' })]);
    const r1 = await importar(base, conteudo);
    const r2 = await importar(base, conteudo);
    expect(r2).toEqual({ ok: true, loteId: r1.loteId, jaRecebido: true });
  });
});
