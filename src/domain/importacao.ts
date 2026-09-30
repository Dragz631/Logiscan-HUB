/**
 * IMPORTAÇÃO — classifica cada pacote de um documento `logiscan.import/v0`
 * contra o inventário atual. Puro: não grava nada.
 *
 * Regras:
 *  - Identidade = transportadora + código normalizado. Endereço/nome/número iguais NÃO fundem pacotes.
 *  - Sem código → não entra (não tem identidade).
 *  - Revisão ainda aberta no extractor → não entra: revise no extractor e reimporte.
 *  - Mesmo código já no inventário com os mesmos dados → nada a fazer (reimportação idempotente).
 *  - Mesmo código com dados diferentes → CONFLITO: exige decisão humana, nunca sobrescreve sozinho.
 *  - Mesmo código repetido no próprio arquivo: igual conta uma vez; divergente não entra.
 */
import type { DocumentoImportV0, PacoteImportV0 } from '../contracts/importV0';
import { type DadosPacote, type EstadoPacote, chaveNatural, diferencasDados, limparDados, normalizarCodigo } from './pacote';

export type ClasseItem =
  | 'PRONTO'
  | 'JA_EXISTE'
  | 'CONFLITO'
  | 'SEM_CODIGO'
  | 'REVISAO_EXTRACTOR'
  | 'DUPLICADO_NO_ARQUIVO'
  | 'CONFLITO_NO_ARQUIVO'
  /** O código foi DEVOLVIDO ao galpão (Novo dia) e chegou de novo: volta como disponível. */
  | 'REABRIR';

export type DecisaoConflito = 'manter_atual' | 'aceitar_novo';

export interface Diferenca {
  campo: keyof DadosPacote;
  atual: string;
  novo: string;
}

export interface ItemPrevia {
  indice: number;
  codigo: string;
  classe: ClasseItem;
  dados: DadosPacote;
  origem: { arquivo: string; card: number | null };
  motivos: string[];
  diferencas: Diferenca[];
  pacoteExistenteId: string | null;
}

export interface PacoteExistente {
  id: string;
  dados: DadosPacote;
  estado?: EstadoPacote;
}

/** O que cada classe significa para a confirmação. */
export const EFEITO_CLASSE: Record<ClasseItem, { entra: boolean; precisaDecisao: boolean; rotulo: string }> = {
  PRONTO: { entra: true, precisaDecisao: false, rotulo: 'Pronto para entrar' },
  JA_EXISTE: { entra: false, precisaDecisao: false, rotulo: 'Já está no inventário (igual)' },
  CONFLITO: { entra: false, precisaDecisao: true, rotulo: 'Conflito com o inventário' },
  SEM_CODIGO: { entra: false, precisaDecisao: false, rotulo: 'Sem código de rastreio' },
  REVISAO_EXTRACTOR: { entra: false, precisaDecisao: false, rotulo: 'Revisão pendente no extractor' },
  DUPLICADO_NO_ARQUIVO: { entra: false, precisaDecisao: false, rotulo: 'Repetido no arquivo (igual)' },
  CONFLITO_NO_ARQUIVO: { entra: false, precisaDecisao: false, rotulo: 'Repetido no arquivo com dados diferentes' },
  REABRIR: { entra: true, precisaDecisao: false, rotulo: 'Devolvido antes: reabre no galpão' },
};

export function dadosDoContrato(p: PacoteImportV0): DadosPacote {
  return limparDados({
    destinatario: p.recipient_name,
    rua: p.street,
    ruaDetalhe: p.street_detail,
    numero: p.number,
    complemento: p.complement,
    bairro: p.neighborhood,
    cidade: p.city,
    uf: p.state,
    cep: p.cep,
  });
}

export function classificarLote(
  doc: DocumentoImportV0,
  /** Busca no inventário pelo código normalizado (a transportadora é a do documento). */
  buscarExistente: (codigo: string) => PacoteExistente | undefined,
): ItemPrevia[] {
  const vistos = new Map<string, { indice: number; dados: DadosPacote }>();
  // Pré-passo: códigos repetidos no arquivo com dados divergentes → nenhum deles entra.
  const divergentesNoArquivo = new Set<string>();
  for (const p of doc.packages) {
    const codigo = normalizarCodigo(p.tracking_code);
    if (!codigo) continue;
    const chave = chaveNatural(doc.source, codigo);
    const dados = dadosDoContrato(p);
    const primeiro = vistos.get(chave);
    if (!primeiro) vistos.set(chave, { indice: -1, dados });
    else if (diferencasDados(primeiro.dados, dados).length > 0) divergentesNoArquivo.add(chave);
  }
  vistos.clear();

  return doc.packages.map((p, indice): ItemPrevia => {
    const codigo = normalizarCodigo(p.tracking_code);
    const dados = dadosDoContrato(p);
    const item: ItemPrevia = {
      indice,
      codigo,
      classe: 'PRONTO',
      dados,
      origem: { arquivo: p.source?.file ?? '', card: p.source?.card_index ?? null },
      motivos: [],
      diferencas: [],
      pacoteExistenteId: null,
    };

    if (!codigo) {
      return { ...item, classe: 'SEM_CODIGO', motivos: ['pacote sem código de rastreio: não tem identidade para entrar no inventário'] };
    }

    const chave = chaveNatural(doc.source, codigo);
    if (divergentesNoArquivo.has(chave)) {
      return { ...item, classe: 'CONFLITO_NO_ARQUIVO', motivos: [`código ${codigo} aparece mais de uma vez no arquivo com dados diferentes`] };
    }
    const anterior = vistos.get(chave);
    if (anterior) {
      return { ...item, classe: 'DUPLICADO_NO_ARQUIVO', motivos: [`repetição idêntica do item ${anterior.indice + 1}`] };
    }
    vistos.set(chave, { indice, dados });

    if (p.review_items.length > 0) {
      return { ...item, classe: 'REVISAO_EXTRACTOR', motivos: p.review_items.map((r) => r.reason) };
    }

    const existente = buscarExistente(codigo);
    if (existente?.estado === 'DEVOLVIDO') {
      return {
        ...item,
        classe: 'REABRIR',
        pacoteExistenteId: existente.id,
        motivos: ['este código foi devolvido ao galpão e chegou de novo: volta como disponível (dados antigos mantidos)'],
      };
    }
    if (existente) {
      const diferencas = diferencasDados(existente.dados, dados);
      if (diferencas.length === 0) return { ...item, classe: 'JA_EXISTE', pacoteExistenteId: existente.id };
      return {
        ...item,
        classe: 'CONFLITO',
        pacoteExistenteId: existente.id,
        diferencas,
        motivos: diferencas.map((d) => `${d.campo}: "${d.atual}" → "${d.novo}"`),
      };
    }
    return item;
  });
}

export interface ResumoPrevia {
  total: number;
  porClasse: Record<ClasseItem, number>;
  entram: number;
  conflitosSemDecisao: number;
}

export function resumirPrevia(itens: ItemPrevia[], decisoes: Record<number, DecisaoConflito | undefined>): ResumoPrevia {
  const porClasse = Object.fromEntries(Object.keys(EFEITO_CLASSE).map((k) => [k, 0])) as Record<ClasseItem, number>;
  for (const i of itens) porClasse[i.classe]++;
  return {
    total: itens.length,
    porClasse,
    entram: porClasse.PRONTO + porClasse.REABRIR,
    conflitosSemDecisao: itens.filter((i) => i.classe === 'CONFLITO' && !decisoes[i.indice]).length,
  };
}
