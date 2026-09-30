/**
 * Rotas do TRANSPORTE HTTP HUB ↔ Street (/api/street/*) e das CONTAS (criar conta, entrar, renovar, sair).
 *
 * Públicas (sem token): criar conta, entrar, renovar, primeiro acesso.
 * Com login obrigatório (Vercel): o resto só responde ao ajudante dono do perfil (ver `autenticacao.ts`).
 * CORS: origens locais (localhost / 127.0.0.1 / rede 192.168.x / 10.x), o Street da Vercel e as extras de HUB_ORIGENS.
 */
import express from 'express';
import { z } from 'zod';
import { criarConta, definirPrimeiroPin, entrar, renovar, sair } from '../application/contas';
import type { Contexto } from '../application/portas';
import { cargasDoPerfil, confirmarRecebimento, perfisParaStreet, receberEventosStreet } from '../application/transporteStreet';
import { exigirAjudanteDoPerfil, exigirLogin, lerToken } from './autenticacao';

const ORIGEM_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/;
const ORIGENS_FIXAS = ['https://safa-sanha.vercel.app'];

function origemPermitida(origem: string): boolean {
  if (ORIGEM_LOCAL.test(origem) || ORIGENS_FIXAS.includes(origem)) return true;
  return (process.env.HUB_ORIGENS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .includes(origem);
}

const CriarConta = z.object({
  nome: z.string(),
  usuario: z.string(),
  pin: z.string(),
  telefone: z.string().nullish(),
  veiculo: z.string().nullish(),
});
const Entrar = z.object({ usuario: z.string(), pin: z.string() });
const Renovar = z.object({ renovar: z.string() });
const PrimeiroAcesso = z.object({ usuario: z.string(), codigo: z.string(), pin: z.string() });

export function criarRotasStreet(ctx: Contexto): express.Router {
  const r = express.Router();

  r.use((req, res, next) => {
    const origem = req.headers.origin;
    if (origem && origemPermitida(origem)) {
      res.setHeader('Access-Control-Allow-Origin', origem);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // ---- Contas (públicas) ----
  r.post('/contas', (req, res) => {
    res.status(201).json(criarConta(ctx, CriarConta.parse(req.body)));
  });
  r.post('/login', (req, res) => {
    res.json(entrar(ctx, Entrar.parse(req.body)));
  });
  r.post('/renovar', (req, res) => {
    res.json(renovar(ctx, Renovar.parse(req.body)));
  });
  r.post('/primeiro-acesso', (req, res) => {
    definirPrimeiroPin(ctx, PrimeiroAcesso.parse(req.body));
    res.json({ ok: true });
  });
  r.post('/sair', (req, res) => {
    const token = lerToken(req);
    if (token) sair(ctx, token);
    res.json({ ok: true });
  });

  // ---- Transporte HUB ↔ Street ----
  r.get('/perfis', exigirLogin(ctx), (_req, res) => {
    res.json(perfisParaStreet(ctx));
  });

  r.get('/perfis/:id/cargas', exigirAjudanteDoPerfil(ctx, (req) => req.params.id as string), (req, res) => {
    res.json(cargasDoPerfil(ctx, req.params.id as string));
  });

  const Recebida = z.object({ ajudanteId: z.string().min(1), quantidade: z.number().int().nonnegative() });
  r.post(
    '/cargas/:id/recebida',
    exigirAjudanteDoPerfil(ctx, (req) => (typeof req.body?.ajudanteId === 'string' ? req.body.ajudanteId : undefined)),
    (req, res) => {
      const b = Recebida.parse(req.body);
      res.json(confirmarRecebimento(ctx, { cargaId: req.params.id as string, ...b }));
    },
  );

  r.post(
    '/eventos',
    exigirAjudanteDoPerfil(ctx, (req) => (typeof req.body?.ajudante?.id === 'string' ? req.body.ajudante.id : undefined)),
    (req, res) => {
      const resultado = receberEventosStreet(ctx, req.body);
      res.status(resultado.ok ? 200 : 422).json(resultado);
    },
  );

  return r;
}
