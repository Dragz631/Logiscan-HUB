/**
 * Rotas do TRANSPORTE HTTP local HUB ↔ Street (/api/street/*).
 * Sem autenticação nesta etapa (rede local de desenvolvimento). CORS liberado só para origens
 * locais (localhost / 127.0.0.1 / rede 192.168.x / 10.x), para o Street rodar em outra porta ou no celular da rede.
 */
import express from 'express';
import { z } from 'zod';
import type { Contexto } from '../application/portas';
import { cargasDoPerfil, confirmarRecebimento, perfisParaStreet, receberEventosStreet } from '../application/transporteStreet';

const ORIGEM_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/;

export function criarRotasStreet(ctx: Contexto): express.Router {
  const r = express.Router();

  r.use((req, res, next) => {
    const origem = req.headers.origin;
    if (origem && ORIGEM_LOCAL.test(origem)) {
      res.setHeader('Access-Control-Allow-Origin', origem);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  r.get('/perfis', (_req, res) => {
    res.json(perfisParaStreet(ctx));
  });

  r.get('/perfis/:id/cargas', (req, res) => {
    res.json(cargasDoPerfil(ctx, req.params.id));
  });

  r.post('/cargas/:id/recebida', (req, res) => {
    const b = z.object({ ajudanteId: z.string().min(1), quantidade: z.number().int().nonnegative() }).parse(req.body);
    res.json(confirmarRecebimento(ctx, { cargaId: req.params.id, ...b }));
  });

  r.post('/eventos', (req, res) => {
    const resultado = receberEventosStreet(ctx, req.body);
    res.status(resultado.ok ? 200 : 422).json(resultado);
  });

  return r;
}
