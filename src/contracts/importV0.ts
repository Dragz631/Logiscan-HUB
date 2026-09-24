/**
 * CONTRATO DE IMPORTAÇÃO `logiscan.import/v0` — representação própria do HUB.
 *
 * O HUB NÃO depende do código de nenhum extractor: ele valida o documento que recebe.
 * Qualquer importador (J&T hoje; Jadlog, Anjun…) que produza este formato é aceito.
 *
 * Tolerância: campos desconhecidos são preservados (não quebram a importação);
 * campos conhecidos com tipo errado REPROVAM o documento inteiro.
 */
import { z } from 'zod';

export const SCHEMA_IMPORT_V0 = 'logiscan.import/v0';

const texto = z.string().default('');

export const ItemRevisaoV0 = z.looseObject({
  reason: z.string(),
  code: z.string().default('OTHER'),
  field: z.string().default('card'),
  kind: z.string().nullable().optional(),
});

export const OrigemCardV0 = z.looseObject({
  file: z.string(),
  card_index: z.number().int().nonnegative(),
  bbox: z.array(z.number()).nullable().optional(),
});

export const PacoteV0 = z.looseObject({
  tracking_code: texto,
  recipient_name: texto,
  street: texto,
  street_detail: texto,
  number: texto,
  complement: texto,
  neighborhood: texto,
  city: texto,
  state: texto,
  cep: texto,
  card_datetime: texto,
  address_raw: texto,
  tags: z.array(z.string()).default([]),
  source: OrigemCardV0.nullable().optional(),
  review_items: z.array(ItemRevisaoV0).default([]),
  warnings: z.array(z.string()).default([]),
});

export const DocumentoImportV0 = z.looseObject({
  schema: z.literal(SCHEMA_IMPORT_V0),
  source: z.string().min(1, 'fonte (source) obrigatória'),
  extractor: z.looseObject({ name: z.string().min(1), version: z.string().min(1) }),
  generated_at: z.string().min(1),
  packages: z.array(PacoteV0),
});

export type PacoteImportV0 = z.infer<typeof PacoteV0>;
export type DocumentoImportV0 = z.infer<typeof DocumentoImportV0>;

export type ResultadoValidacao =
  | { ok: true; documento: DocumentoImportV0 }
  | { ok: false; erros: string[] };

/** Valida um JSON já parseado contra o contrato. Nunca lança: devolve os erros legíveis. */
export function validarDocumentoImport(bruto: unknown): ResultadoValidacao {
  if (bruto && typeof bruto === 'object' && 'schema' in bruto && (bruto as { schema: unknown }).schema !== SCHEMA_IMPORT_V0) {
    return { ok: false, erros: [`schema não suportado: "${String((bruto as { schema: unknown }).schema)}" (esperado "${SCHEMA_IMPORT_V0}")`] };
  }
  const r = DocumentoImportV0.safeParse(bruto);
  if (r.success) return { ok: true, documento: r.data };
  return {
    ok: false,
    erros: r.error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(documento)'}: ${i.message}`),
  };
}

/** Parseia texto JSON + valida. */
export function lerDocumentoImport(textoJson: string): ResultadoValidacao {
  let bruto: unknown;
  try {
    bruto = JSON.parse(textoJson);
  } catch (e) {
    return { ok: false, erros: [`arquivo não é um JSON válido: ${(e as Error).message}`] };
  }
  return validarDocumentoImport(bruto);
}
