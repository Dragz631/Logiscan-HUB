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
  /**
   * Identidade da rua (acrescentado sem quebrar v0): `rua_id` = street_id calculado pela regra comum
   * (logradouro.ts, igual no HUB e no Street); `rua_nome` = apresentação; `regiao` = organização operacional
   * (nunca muda a identidade da rua). O Street encaixa pelo id, não pelo texto.
   */
  rua_id: z.string().optional(),
  rua_nome: z.string().optional(),
  regiao: z.object({ id: z.string(), nome: z.string(), repasse_unico: z.boolean() }).nullable().optional(),
});

/** Unidade da carga: UMA rua (street_id) com os pacotes dela. Evita mandar só uma lista de nomes. */
export const ItemCargaV0 = z.object({
  rua_id: z.string().min(1),
  rua_nome: z.string(),
  regiao_id: z.string().nullable(),
  regiao_nome: z.string().nullable(),
  pacote_ids: z.array(z.string().min(1)),
});

export const DocumentoCargaV0 = z.object({
  schema: z.literal(SCHEMA_CARGA_V0),
  gerado_em: z.string(),
  carga: z.object({
    id: z.string().min(1),
    codigo: z.string().min(1),
    criada_em: z.string(),
    criada_por: z.string(),
    /** Opcional (acrescentado sem quebrar v0): MONTADA = ainda no galpão; EM_ROTA = rota iniciada no HUB. */
    situacao: z.enum(['MONTADA', 'EM_ROTA']).optional(),
    rota_iniciada_em: z.string().nullable().optional(),
  }),
  ajudante: z.object({ id: z.string().min(1), nome: z.string().min(1) }),
  pacotes: z.array(PacoteCargaV0),
  /** Opcional (acrescentado sem quebrar v0): pacotes agrupados por rua, com street_id e região. */
  itens: z.array(ItemCargaV0).optional(),
});

export type PacoteCargaV0 = z.infer<typeof PacoteCargaV0>;
export type ItemCargaV0 = z.infer<typeof ItemCargaV0>;
export type DocumentoCargaV0 = z.infer<typeof DocumentoCargaV0>;
