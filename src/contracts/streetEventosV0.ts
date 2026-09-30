/**
 * CONTRATO `logiscan.street-eventos/v0` — Street → HUB.
 *
 * O Street devolve o que aconteceu na rua como uma lista de eventos.
 * Cada evento tem `id_evento` gerado no celular: reenviar o mesmo arquivo (ou o mesmo evento
 * num retry) NÃO cria dois acontecimentos no HUB.
 *
 * v0 conhece ENTREGA_REGISTRADA e INSUCESSO_REGISTRADO (este com `motivo` obrigatório).
 * Tipos desconhecidos são RECUSADOS com motivo (não somem).
 * Sem provas/fotos nesta versão.
 */
import { z } from 'zod';

export const SCHEMA_STREET_EVENTOS_V0 = 'logiscan.street-eventos/v0';

export const EventoStreetV0 = z.looseObject({
  id_evento: z.string().min(1),
  tipo: z.string().min(1),
  carga_id: z.string().min(1),
  hub_pacote_id: z.string().min(1),
  codigo: z.string().default(''),
  ocorrido_em: z.string().min(1),
  /** Só INSUCESSO_REGISTRADO: por que não foi entregue. */
  motivo: z.string().optional(),
  /** O texto que o ajudante copiou e colou para o cliente (entrega ou insucesso). Só texto; fotos vêm depois. */
  texto: z.string().optional(),
  recebedor: z
    .object({ tipo: z.string().default(''), detalhes: z.string().default('') })
    .nullable()
    .optional(),
});

export const DocumentoStreetEventosV0 = z.looseObject({
  schema: z.literal(SCHEMA_STREET_EVENTOS_V0),
  gerado_em: z.string(),
  ajudante: z.object({ id: z.string().min(1), nome: z.string().min(1) }),
  eventos: z.array(EventoStreetV0),
});

export type EventoStreetV0 = z.infer<typeof EventoStreetV0>;
export type DocumentoStreetEventosV0 = z.infer<typeof DocumentoStreetEventosV0>;

export function lerDocumentoStreetEventos(
  texto: string,
): { ok: true; documento: DocumentoStreetEventosV0 } | { ok: false; erros: string[] } {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch (e) {
    return { ok: false, erros: [`arquivo não é um JSON válido: ${(e as Error).message}`] };
  }
  if (bruto && typeof bruto === 'object' && 'schema' in bruto && (bruto as { schema: unknown }).schema !== SCHEMA_STREET_EVENTOS_V0) {
    return { ok: false, erros: [`schema não suportado: "${String((bruto as { schema: unknown }).schema)}" (esperado "${SCHEMA_STREET_EVENTOS_V0}")`] };
  }
  const r = DocumentoStreetEventosV0.safeParse(bruto);
  if (r.success) return { ok: true, documento: r.data };
  return { ok: false, erros: r.error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(documento)'}: ${i.message}`) };
}
