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
  iniciarRota,
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
import { confirmarDestino, entregarAoAjudante, listarAjudantes } from '../application/operacao';
import {
  atribuirRuas,
  confirmarRepasses,
  criarPerfil,
  detalharPerfil,
  editarPerfil,
  finalizarRota,
  listarPerfis,
  listarRuas,
  listarUnidades,
  removerRuaDaCarga,
} from '../application/orquestracao';
import { criarRegiao, definirRegiao, listarRegioes, mapaDeRegioes } from '../application/regioes';
import { classificarPacote, classificarRua, pacotesDaCaixa, visaoTriagem } from '../application/triagem';
import { detalharDia, encerrarDia, listarDias, previaNovoDia } from '../application/novoDia';
import { pendenciasDaRota, repassarRota } from '../application/repasseRota';
import { criarRotasStreet } from './street';
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
  perfil: z.object({
    nome: z.string(),
    veiculo: z.string().nullable().optional(),
    ativo: z.boolean().optional(),
  }),
  repasses: z.object({
    repasses: z.array(z.object({ ajudanteId: z.string().min(1), ruas: z.array(z.string()) })).min(1),
    ator,
    chave: z.string().min(1),
  }),
  atribuir: z.object({ ajudanteId: z.string().min(1), ruas: z.array(z.string()).min(1), ator, chave: z.string().min(1) }),
  regiao: z.object({ nome: z.string(), ator, repasseUnico: z.boolean().optional() }),
  definirRegiao: z.object({
    rua: z.string().min(1),
    regiaoId: z.string().nullable(),
    ator,
    substituir: z.boolean().optional(),
    prioridade: z.number().int().positive().nullable().optional(),
  }),
  novoDia: z.object({
    ator,
    chave: z.string().min(1),
    historico: z.boolean(),
    destinos: z.record(z.string(), z.enum(['amanha', 'galpao'])),
  }),
  repassarRota: z.object({
    paraAjudanteId: z.string().min(1),
    caixas: z.array(z.string()).optional(),
    ator,
    chave: z.string().min(1),
    motivo: z.string().optional(),
  }),
  triagemRua: z.object({ rua: z.string().min(1), caixaId: z.string().min(1), ator, substituir: z.boolean().optional() }),
  triagemPacote: z.object({
    pacoteId: z.string().min(1), caixaId: z.string().min(1), ator, substituir: z.boolean().optional(), motivo: z.string().optional(),
  }),
  removerRua: z.object({ rua: z.string().min(1), ator, paraAjudanteId: z.string().optional() }),
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

  // Transporte direto HUB ↔ Street (o arquivo continua como fallback)
  api.use('/street', criarRotasStreet(ctx));

  // ---- Orquestrador ----
  api.get('/orquestrador', (_req, res) => {
    const ruas = listarRuas(ctx);
    // pacotes ainda SEM CAIXA: esperam a revisão do Hugo na triagem (não vão para ajudante)
    const semCaixa = ruas.filter((r) => r.chave.startsWith('sem:'));
    res.json({
      ruas,
      unidades: listarUnidades(ctx),
      perfis: listarPerfis(ctx),
      regioes: listarRegioes(ctx),
      aguardandoRevisao: { pacotes: semCaixa.reduce((n, r) => n + r.disponiveis, 0), ruas: semCaixa.filter((r) => r.disponiveis > 0).length },
    });
  });

  api.post('/regioes', (req, res) => {
    const b = corpo(Esquemas.regiao, req.body);
    res.status(201).json(criarRegiao(ctx, b.nome, b.ator, !!b.repasseUnico));
  });

  /** Mapa operacional: regiões e os logradouros ensinados a cada uma. */
  api.get('/regioes', (_req, res) => {
    res.json(mapaDeRegioes(ctx));
  });

  /** Decide a região de uma rua. Conflito com decisão anterior volta { ok: false, conflito } para revisão. */
  api.post('/regioes/definir', (req, res) => {
    res.json(definirRegiao(ctx, corpo(Esquemas.definirRegiao, req.body)));
  });

  /** Confirma o plano de repasses da tela (várias ruas → vários ajudantes), tudo ou nada. */
  api.post('/orquestrador/repasses', (req, res) => {
    res.json(confirmarRepasses(ctx, corpo(Esquemas.repasses, req.body)));
  });

  /** TRIAGEM: a mesa das caixas — o que já está em caixa e o que espera a revisão do Hugo. */
  api.get('/triagem', (_req, res) => {
    res.json(visaoTriagem(ctx));
  });
  api.get('/triagem/caixas/:id', (req, res) => {
    res.json(pacotesDaCaixa(ctx, req.params.id));
  });
  /** "Esta rua vai nesta caixa" (memória da rua). Conflito volta { ok: false, conflito }. */
  api.post('/triagem/rua', (req, res) => {
    res.json(classificarRua(ctx, corpo(Esquemas.triagemRua, req.body)));
  });
  /** "Este pacote/pessoa vai nesta caixa" (exceção da pessoa). Conflito volta { ok: false, conflito }. */
  api.post('/triagem/pacote', (req, res) => {
    res.json(classificarPacote(ctx, corpo(Esquemas.triagemPacote, req.body)));
  });

  api.post('/orquestrador/atribuir', (req, res) => {
    res.json(atribuirRuas(ctx, corpo(Esquemas.atribuir, req.body)));
  });

  api.get('/perfis/:id', (req, res) => {
    res.json(detalharPerfil(ctx, req.params.id));
  });

  api.post('/cargas/:id/remover-rua', (req, res) => {
    res.json(removerRuaDaCarga(ctx, { cargaId: req.params.id, ...corpo(Esquemas.removerRua, req.body) }));
  });

  api.post('/cargas/:id/finalizar', (req, res) => {
    res.json(finalizarRota(ctx, req.params.id, corpo(Esquemas.confirmar, req.body).ator));
  });

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
    res.status(201).json(criarPerfil(ctx, corpo(Esquemas.perfil, req.body)));
  });

  api.put('/ajudantes/:id', (req, res) => {
    res.json(editarPerfil(ctx, req.params.id, corpo(Esquemas.perfil, req.body)));
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

  /** NOVO DIA: o que vai ser fechado (só leitura) e o fechamento (tudo ou nada, idempotente pela chave). */
  api.get('/novo-dia/previa', (_req, res) => {
    res.json(previaNovoDia(ctx));
  });
  api.post('/novo-dia', (req, res) => {
    res.json(encerrarDia(ctx, corpo(Esquemas.novoDia, req.body)));
  });
  api.get('/dias', (_req, res) => {
    res.json(listarDias(ctx));
  });
  api.get('/dias/:id', (req, res) => {
    res.json(detalharDia(ctx, req.params.id));
  });

  /** REPASSE NA HORA: a rota em andamento passa para outro ajudante ativo (carga nova, eventos próprios). */
  api.get('/cargas/:id/pendencias-da-rota', (req, res) => {
    res.json(pendenciasDaRota(ctx, req.params.id));
  });
  api.post('/cargas/:id/repassar-rota', (req, res) => {
    res.json(repassarRota(ctx, { cargaId: req.params.id, ...corpo(Esquemas.repassarRota, req.body) }));
  });

  /** Ação explícita do operador: a carga montada sai para a rua. */
  api.post('/cargas/:id/iniciar-rota', (req, res) => {
    res.json(iniciarRota(ctx, req.params.id, corpo(Esquemas.confirmar, req.body).ator));
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
    // Erros do próprio corpo HTTP (antes de qualquer regra): não são erro de contrato nem erro interno.
    const tipoCorpo = (err as { type?: string } | null)?.type;
    if (tipoCorpo === 'entity.too.large') {
      return res.status(413).json({ erro: 'ARQUIVO_GRANDE_DEMAIS', mensagem: 'o arquivo passa do limite de 25 MB aceito pelo HUB' });
    }
    if (tipoCorpo === 'entity.parse.failed') {
      return res.status(400).json({ erro: 'CORPO_INVALIDO', mensagem: 'o pedido chegou corrompido (JSON do corpo inválido)' });
    }
    if (err instanceof ErroAplicacao) return res.status(err.status).json({ erro: err.codigo, mensagem: err.message });
    if (err instanceof ErroDominio) return res.status(409).json({ erro: err.codigo, mensagem: err.message });
    if (err instanceof z.ZodError) {
      return res.status(400).json({ erro: 'ENTRADA_INVALIDA', mensagem: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    }
    console.error(err);
    return res.status(500).json({ erro: 'INTERNO', mensagem: 'erro inesperado no HUB (veja o terminal)' });
  });

  return api;
}
