/**
 * API HTTP do HUB. Camada fina: valida a entrada, chama o caso de uso, devolve JSON.
 * Nenhuma regra de negócio aqui.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  criarCarga,
  detalharCarga,
  exportarCarga,
  listarCargas,
  pacotesParaCarga,
  receberRetornoStreet,
} from '../application/cargas';
import { detalharPacote, listarPacotes, resumoInventario } from '../application/consultas';
import { ErroAplicacao } from '../application/erros';
import {
  confirmarImportacao,
  decidirConflito,
  descartarLote,
  listarLotes,
  prepararImportacao,
  verLote,
} from '../application/importacao';
import { cadastrarAjudante, confirmarDestino, entregarAoAjudante, listarAjudantes } from '../application/operacao';
import type { Contexto } from '../application/portas';
import { ErroDominio } from '../domain/eventos';
import { ESTADOS } from '../domain/pacote';

const ator = z.string().trim().min(1, 'informe quem está operando');

const Esquemas = {
  importar: z.object({ arquivo: z.string().min(1), conteudo: z.string().min(1) }),
  decisao: z.object({ decisao: z.enum(['manter_atual', 'aceitar_novo']) }),
  confirmar: z.object({ ator }),
  ajudante: z.object({ nome: z.string() }),
  entregar: z.object({ pacoteIds: z.array(z.string()).min(1), ajudanteId: z.string(), ator, chave: z.string().min(1) }),
  destino: z.object({ destinoId: z.string().nullable(), ator, chave: z.string().min(1) }),
  carga: z.object({ ajudanteId: z.string().min(1), pacoteIds: z.array(z.string()).min(1), ator }),
  filtro: z.object({
    estado: z.enum(ESTADOS).optional(),
    responsavelId: z.string().optional(),
    semResponsavel: z.literal('1').optional(),
    revisaoPendente: z.literal('1').optional(),
    destinoId: z.string().optional(),
    busca: z.string().optional(),
  }),
};

function corpo<T>(esquema: z.ZodType<T>, valor: unknown): T {
  const r = esquema.safeParse(valor);
  if (!r.success) throw new ErroAplicacao('ENTRADA_INVALIDA', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}

export function criarApi(ctx: Contexto): express.Router {
  const api = express.Router();
  api.use(express.json({ limit: '25mb' }));

  api.get('/resumo', (_req, res) => {
    res.json(resumoInventario(ctx));
  });

  api.get('/pacotes', (req, res) => {
    const f = corpo(Esquemas.filtro, req.query);
    res.json(
      listarPacotes(ctx, {
        estado: f.estado,
        responsavelId: f.responsavelId,
        semResponsavel: f.semResponsavel === '1',
        revisaoPendente: f.revisaoPendente === '1',
        destinoId: f.destinoId,
        busca: f.busca,
      }),
    );
  });

  api.get('/pacotes/:id', (req, res) => {
    res.json(detalharPacote(ctx, req.params.id));
  });

  api.post('/pacotes/entregar', (req, res) => {
    res.json(entregarAoAjudante(ctx, corpo(Esquemas.entregar, req.body)));
  });

  api.post('/pacotes/:id/destino', (req, res) => {
    const b = corpo(Esquemas.destino, req.body);
    confirmarDestino(ctx, { pacoteId: req.params.id, ...b });
    res.json(detalharPacote(ctx, req.params.id));
  });

  api.get('/ajudantes', (_req, res) => {
    res.json(listarAjudantes(ctx));
  });

  api.post('/ajudantes', (req, res) => {
    res.status(201).json(cadastrarAjudante(ctx, corpo(Esquemas.ajudante, req.body).nome));
  });

  api.get('/importacoes', (_req, res) => {
    res.json(listarLotes(ctx));
  });

  api.post('/importacoes', (req, res) => {
    const r = prepararImportacao(ctx, corpo(Esquemas.importar, req.body));
    res.status(r.ok ? 200 : 422).json(r);
  });

  api.get('/importacoes/:id', (req, res) => {
    res.json(verLote(ctx, req.params.id));
  });

  api.post('/importacoes/:id/itens/:indice/decisao', (req, res) => {
    decidirConflito(ctx, req.params.id, Number(req.params.indice), corpo(Esquemas.decisao, req.body).decisao);
    res.json(verLote(ctx, req.params.id));
  });

  api.post('/importacoes/:id/confirmar', (req, res) => {
    res.json(confirmarImportacao(ctx, req.params.id, corpo(Esquemas.confirmar, req.body).ator));
  });

  api.post('/importacoes/:id/descartar', (req, res) => {
    descartarLote(ctx, req.params.id);
    res.json(verLote(ctx, req.params.id));
  });

  api.get('/ajudantes/:id/prontos-para-carga', (req, res) => {
    res.json(pacotesParaCarga(ctx, req.params.id));
  });

  api.get('/cargas', (_req, res) => {
    res.json(listarCargas(ctx));
  });

  api.post('/cargas', (req, res) => {
    res.status(201).json(criarCarga(ctx, corpo(Esquemas.carga, req.body)));
  });

  api.get('/cargas/:id', (req, res) => {
    res.json(detalharCarga(ctx, req.params.id));
  });

  /** Gera o documento logiscan.carga/v0 (e registra a exportação no histórico da carga). */
  api.post('/cargas/:id/exportar', (req, res) => {
    res.json(exportarCarga(ctx, req.params.id, corpo(Esquemas.confirmar, req.body).ator));
  });

  /** Recebe o arquivo logiscan.street-eventos/v0 devolvido pelo Street. */
  api.post('/retornos-street', (req, res) => {
    const r = receberRetornoStreet(ctx, corpo(Esquemas.importar, req.body));
    res.status(r.ok ? 200 : 422).json(r);
  });

  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ErroAplicacao) return res.status(err.status).json({ erro: err.codigo, mensagem: err.message });
    if (err instanceof ErroDominio) return res.status(409).json({ erro: err.codigo, mensagem: err.message });
    console.error(err);
    return res.status(500).json({ erro: 'INTERNO', mensagem: 'erro inesperado no HUB (veja o terminal)' });
  });

  return api;
}
