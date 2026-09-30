/**
 * PONTE SÍNCRONA PARA O POSTGRES.
 *
 * O HUB inteiro (casos de uso, resolvedores que leem o banco dentro de funções síncronas do domínio, 243 testes)
 * foi escrito em cima de um armazém SÍNCRONO. Para rodar no Supabase sem reescrever isso, cada consulta vai para
 * uma thread auxiliar que fala com o Postgres (`pg`), e a thread principal espera o resultado com `Atomics.wait`.
 *
 * Isto só é aceitável porque o HUB é uma aplicação de um operador: cada requisição é tratada de ponta a ponta de
 * forma síncrona (sem `await` no meio), então duas requisições nunca se misturam dentro de uma transação, e bloquear
 * a thread principal durante a consulta não atrapalha ninguém. Não copie este padrão para servidor com muita gente.
 *
 * A thread auxiliar abre UMA conexão e a mantém: BEGIN ... COMMIT usam a mesma conexão.
 */
import { MessageChannel, Worker, receiveMessageOnPort } from 'node:worker_threads';

export interface ResultadoConsulta {
  rows: Record<string, unknown>[];
  rowCount: number;
}

/** A thread auxiliar é um arquivo próprio (`ponteThread.cjs`); o empacotador da Vercel o põe ao lado do servidor. */
const ARQUIVO_DA_THREAD = new URL('./ponteThread.cjs', import.meta.url);

export class ErroPostgres extends Error {
  constructor(
    mensagem: string,
    public readonly codigo?: string,
    public readonly detalhe?: string,
    public readonly restricao?: string,
  ) {
    super(mensagem);
    this.name = 'ErroPostgres';
  }
}

export interface OpcoesPonte {
  /** String de conexão (Supabase: pooler em modo transação, porta 6543). */
  url: string;
  /** Liga TLS (Supabase exige). Desligado para o servidor local dos testes. */
  ssl?: boolean;
  /** Tempo máximo de cada consulta, em ms (padrão 50 s, abaixo do limite da função da Vercel). */
  tempoMaximoMs?: number;
}

export class PonteSincrona {
  private readonly thread: Worker;
  private readonly porta: MessagePortLike;
  private readonly flag: Int32Array;
  private readonly tempoMaximoMs: number;
  private fechada = false;

  constructor(opcoes: OpcoesPonte) {
    const sinal = new SharedArrayBuffer(4);
    this.flag = new Int32Array(sinal);
    const canal = new MessageChannel();
    this.porta = canal.port1;
    this.tempoMaximoMs = opcoes.tempoMaximoMs ?? 50_000;
    this.thread = new Worker(ARQUIVO_DA_THREAD, {
      workerData: { sinal, porta: canal.port2, url: opcoes.url, ssl: opcoes.ssl ?? false },
      transferList: [canal.port2],
    });
    this.thread.unref();
    this.thread.on('error', () => undefined); // o erro volta pela resposta da consulta (ou por tempo esgotado)
  }

  consulta(sql: string, params: unknown[] = []): ResultadoConsulta {
    if (this.fechada) throw new ErroPostgres('conexão com o Postgres já foi fechada');
    return this.trocar({ sql, params });
  }

  /** Fecha a conexão. Nunca lança: se o servidor já não responde, só encerra a thread. */
  fechar(): void {
    if (this.fechada) return;
    this.fechada = true;
    try {
      this.trocar({ fechar: true }, 5_000);
    } catch {
      // nada a fazer: a conexão já estava caída
    } finally {
      void this.thread.terminate();
    }
  }

  private trocar(pedido: Record<string, unknown>, tempoMaximoMs = this.tempoMaximoMs): ResultadoConsulta {
    Atomics.store(this.flag, 0, 0);
    this.porta.postMessage(pedido);
    const r = Atomics.wait(this.flag, 0, 0, tempoMaximoMs);
    if (r === 'timed-out') throw new ErroPostgres(`o Postgres não respondeu em ${tempoMaximoMs} ms`);
    const recebido = receiveMessageOnPort(this.porta);
    const resposta = recebido?.message as
      | { ok: true; rows?: Record<string, unknown>[]; rowCount?: number }
      | { ok: false; erro: { message: string; code?: string; detail?: string; constraint?: string } }
      | undefined;
    if (!resposta) throw new ErroPostgres('resposta vazia da thread do Postgres');
    if (!resposta.ok) throw new ErroPostgres(resposta.erro.message, resposta.erro.code, resposta.erro.detail, resposta.erro.constraint);
    return { rows: resposta.rows ?? [], rowCount: resposta.rowCount ?? 0 };
  }
}

type MessagePortLike = MessageChannel['port1'];
