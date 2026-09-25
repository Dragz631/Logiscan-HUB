/**
 * CONTRATO `logiscan.carga/v0` — HUB → Street.
 *
 * O que o ajudante leva: identidade da carga, o ajudante dono dela e SOMENTE os pacotes dele.
 * O Street não precisa conhecer o HUB por dentro: só este documento.
 * Hoje viaja como arquivo; na sincronização real, o mesmo documento viaja pela rede.
 */
import { z } from 'zod';

export const SCHEMA_CARGA_V0 = 'logiscan.carga/v0';

export const PacoteCargaV0 = z.object({
  hub_pacote_id: z.string().min(1),
  transportadora: z.string().min(1),
  codigo: z.string().min(1),
  destinatario: z.string(),
  rua: z.string(),
  rua_detalhe: z.string(),
  numero: z.string(),
  complemento: z.string(),
  bairro: z.string(),
  cidade: z.string(),
  uf: z.string(),
  cep: z.string(),
  /** rua|número|contexto — mesma regra de destino do Street; null = destino ainda a confirmar. */
  destino_id: z.string().nullable(),
});

export const DocumentoCargaV0 = z.object({
  schema: z.literal(SCHEMA_CARGA_V0),
  gerado_em: z.string(),
  carga: z.object({
    id: z.string().min(1),
    codigo: z.string().min(1),
    criada_em: z.string(),
    criada_por: z.string(),
  }),
  ajudante: z.object({ id: z.string().min(1), nome: z.string().min(1) }),
  pacotes: z.array(PacoteCargaV0),
});

export type PacoteCargaV0 = z.infer<typeof PacoteCargaV0>;
export type DocumentoCargaV0 = z.infer<typeof DocumentoCargaV0>;
