/**
 * LISTA DE UMA ASSOCIAÇÃO — o que o Hugo manda para as mulheres que recebem os pacotes ali.
 *
 * Uma linha por PESSOA (mesmo nome dentro da associação = uma linha, com a soma dos pacotes) e o texto no
 * MESMO formato da lista de associação do Street (`buildAssociationWhatsAppMessage`), para elas receberem igual.
 * Funções puras: quem monta a lista (quais pacotes) é a aplicação.
 */
import { chaveTexto } from './destino/texto';

export interface PacoteDaLista {
  id: string;
  destinatario: string;
  rua: string;
}

export interface PessoaDaLista {
  nome: string;
  pacotes: number;
  pacoteIds: string[];
  /** Ruas em que esta pessoa aparece (a memória do HUB é nome + rua). */
  ruas: string[];
}

const SEM_NOME = 'Morador';
const LIGACOES = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/**
 * Nome para a lista que vai a terceiros: "claudio" → "Claudio", "joelma lima" → "Joelma Lima", "MARIA DA SILVA" →
 * "Maria da Silva". Só ajeita a primeira letra de cada palavra (e põe em minúscula o que veio TODO em maiúscula);
 * o resto do que foi digitado fica como está ("McDonald" não muda). Só apresentação: a identidade continua sendo
 * o nome sem acento/caixa.
 */
export function nomeParaLista(nome: string): string {
  return nome
    .split(' ')
    .map((palavra, i) => {
      if (!palavra) return palavra;
      const toda = palavra === palavra.toUpperCase() && palavra !== palavra.toLowerCase();
      const base = toda ? palavra.toLowerCase() : palavra;
      if (i > 0 && LIGACOES.has(base.toLowerCase())) return base.toLowerCase();
      return base.charAt(0).toUpperCase() + base.slice(1);
    })
    .join(' ');
}

/** Agrupa por nome (sem acento/maiúscula/pontuação), soma os pacotes e ordena em ordem alfabética. */
export function agruparPessoas(pacotes: PacoteDaLista[]): PessoaDaLista[] {
  const porNome = new Map<string, PessoaDaLista>();
  for (const p of pacotes) {
    const nome = nomeParaLista(p.destinatario.replace(/\s+/g, ' ').trim() || SEM_NOME);
    const chave = chaveTexto(nome) || chaveTexto(SEM_NOME);
    if (!porNome.has(chave)) porNome.set(chave, { nome, pacotes: 0, pacoteIds: [], ruas: [] });
    const g = porNome.get(chave)!;
    g.pacotes++;
    g.pacoteIds.push(p.id);
    if (p.rua && !g.ruas.includes(p.rua)) g.ruas.push(p.rua);
  }
  return [...porNome.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "30/09/2026 às 14:05", no horário de São Paulo. */
export function dataEHoraSP(agora: Date): string {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora);
  const v = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${v('day')}/${v('month')}/${v('year')} às ${v('hour')}:${v('minute')}`;
}

export interface EntradaDoTexto {
  /** Nome da associação ("Associação da Chatuba"). */
  associacao: string;
  /** "A/C": quem recebe. Vazio = a linha não aparece. */
  responsavel?: string | null;
  pessoas: { nome: string; pacotes: number }[];
  agora: Date;
}

/** O texto pronto para colar no WhatsApp (mesmo formato da lista de associação do Street). */
export function textoDaLista(e: EntradaDoTexto): string {
  const total = e.pessoas.reduce((n, p) => n + p.pacotes, 0);
  const responsavel = e.responsavel?.trim();
  const linhas = [
    '📋 *Lista de Encomendas - Associação*',
    `🏘️ *Local:* ${e.associacao}`,
    ...(responsavel ? [`👩 *A/C:* ${responsavel}`] : []),
    `📦 *Total de Pacotes:* ${plural(total, 'volume', 'volumes')} (${plural(e.pessoas.length, 'destinatário', 'destinatários')})`,
    `📅 *Data:* ${dataEHoraSP(e.agora)}`,
    '',
    '📝 *Relação de Nomes:*',
    ...e.pessoas.map((p, i) => `${i + 1}. *${p.nome}* (${plural(p.pacotes, 'pacote', 'pacotes')})`),
    '',
    'Favor conferir os volumes na entrega. Muito obrigado! 🙏',
  ];
  return linhas.join('\n');
}
