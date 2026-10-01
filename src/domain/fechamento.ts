/**
 * FECHAMENTO DA ROTA — o resumo do que o ajudante fez: quantos entregues, o que não foi entregue e, de cada
 * entrega, quem recebeu, onde, quando e o texto de confirmação que ele copiou no Street.
 *
 * Funções puras: quem lê os eventos é a aplicação. O texto do relatório sai no formato de mensagem de WhatsApp
 * (o Hugo cola onde quiser) e o mesmo texto serve para imprimir.
 */
import { dataEHoraSP } from './listaAssociacao';

export interface EntregaDoFechamento {
  pacoteId: string;
  codigo: string;
  destinatario: string;
  rua: string;
  numero: string;
  complemento: string;
  /** Quando o ajudante registrou a entrega no Street (ISO). */
  quando: string | null;
  recebedor: { tipo: string; detalhes: string } | null;
  /** O texto de confirmação que ele copiou e colou (nome de quem recebeu, onde, confirmação). */
  texto: string | null;
  /** Fotos do pacote e do local já chegaram? (Hoje ainda não: só texto.) */
  provaCompleta: boolean;
}

export interface FalhaDoFechamento {
  pacoteId: string;
  codigo: string;
  destinatario: string;
  rua: string;
  numero: string;
  complemento: string;
  /** INSUCESSO = tentou e não entregou (tem motivo); SEM_DESFECHO = a rota acabou sem registrar nada. */
  situacao: 'INSUCESSO' | 'SEM_DESFECHO';
  motivo: string | null;
  /** O que aconteceu depois (Novo dia): voltou para a caixa ou ao galpão. null = ainda na rota. */
  depois: 'amanha' | 'galpao' | null;
}

export interface CaixaDoFechamento {
  numero: string | null;
  nome: string;
  total: number;
  entregues: number;
}

export interface FechamentoDeRota {
  cargaId: string;
  codigo: string;
  ajudante: { id: string; nome: string };
  saiuEm: string | null;
  ultimaEntregaEm: string | null;
  minutosNaRua: number | null;
  total: number;
  entregues: number;
  insucessos: number;
  semDesfecho: number;
  provasCompletas: number;
  /** PERFEITA = tudo entregue; CONCLUIDA = tudo com desfecho (entregue ou insucesso); PARCIAL = ainda falta resolver. */
  situacao: 'PERFEITA' | 'CONCLUIDA' | 'PARCIAL';
  caixas: CaixaDoFechamento[];
  entregas: EntregaDoFechamento[];
  falhas: FalhaDoFechamento[];
}

export function situacaoDoFechamento(total: number, entregues: number, insucessos: number): FechamentoDeRota['situacao'] {
  if (total > 0 && entregues === total) return 'PERFEITA';
  if (total > 0 && entregues + insucessos === total) return 'CONCLUIDA';
  return 'PARCIAL';
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "2 h 43 min", "45 min". */
export function duracao(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

const TIPOS_DE_RECEBEDOR: Record<string, string> = {
  proprio_morador: 'pelo próprio morador',
  morador: 'pelo morador',
  vizinho: 'por um vizinho',
  portaria: 'pela portaria',
  porteiro: 'pelo porteiro',
  familiar: 'por um familiar',
  funcionario: 'por um funcionário',
};

/** A frase inteira: "Recebido pelo próprio morador", "Recebido por um vizinho: Dona Rita", "Recebedor não informado". */
export function fraseDoRecebedor(r: { tipo: string; detalhes: string } | null): string {
  if (!r) return 'Recebedor não informado';
  const bruto = r.tipo.replace(/_/g, ' ').trim();
  const tipo = TIPOS_DE_RECEBEDOR[r.tipo.trim().toLowerCase()] ?? (bruto ? `por ${bruto}` : 'por quem estava');
  const nome = r.detalhes.trim();
  const dobrar = (t: string) =>
    t
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[\s_]+/g, '');
  // "Próprio Morador" / "proprio_morador" / "pelo próprio morador" dizem a mesma coisa: não repete.
  const repete = [r.tipo, tipo, tipo.replace(/^(por|pelo|pela) (um |uma )?/, '')].some((t) => dobrar(t) === dobrar(nome));
  return `Recebido ${tipo}${nome && !repete ? `: ${nome}` : ''}`;
}

export function horaSP(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

const enderecoCurto = (e: { rua: string; numero: string; complemento: string }) =>
  `${e.rua}, ${e.numero || 'S/N'}${e.complemento ? ` · ${e.complemento}` : ''}`;

const DEPOIS = { amanha: 'ficou para amanhã', galpao: 'voltou ao galpão' } as const;

/** O relatório de UMA rota, pronto para colar no WhatsApp ou imprimir. */
export function textoDoRelatorio(f: FechamentoDeRota, agora: Date): string {
  const titulo = f.situacao === 'PERFEITA' ? '🏆 *Rota perfeita*' : '📋 *Relatório da rota*';
  const linhas: string[] = [
    `${titulo} — ${f.ajudante.nome}`,
    `📅 ${dataEHoraSP(agora)} · carga ${f.codigo}`,
    `🛵 Saiu ${horaSP(f.saiuEm)}${f.ultimaEntregaEm ? ` · última entrega ${horaSP(f.ultimaEntregaEm)}${f.minutosNaRua !== null ? ` (${duracao(f.minutosNaRua)} na rua)` : ''}` : ''}`,
    `✅ *Entregues:* ${f.entregues} de ${f.total}`,
  ];
  const naoEntregues = f.insucessos + f.semDesfecho;
  if (naoEntregues > 0) linhas.push(`⚠️ *Não entregues:* ${naoEntregues}`);
  if (f.entregues > 0) linhas.push(`📷 *Provas com foto:* ${f.provasCompletas} de ${f.entregues}${f.provasCompletas < f.entregues ? ' (fotos pendentes)' : ''}`);

  if (f.falhas.length > 0) {
    linhas.push('', '*Não entregues:*');
    for (const x of f.falhas) {
      const motivo = x.situacao === 'INSUCESSO' ? `insucesso${x.motivo ? `: ${x.motivo}` : ''}` : 'sem registro na rota';
      linhas.push(`- *${x.destinatario || 'Morador'}* — ${enderecoCurto(x)} (${motivo}${x.depois ? ` · ${DEPOIS[x.depois]}` : ''})`);
    }
  }

  if (f.entregas.length > 0) {
    linhas.push('', '*Entregas confirmadas:*');
    f.entregas.forEach((e, i) => {
      linhas.push(`${i + 1}. *${e.destinatario || 'Morador'}* — ${enderecoCurto(e)} · ${horaSP(e.quando)}`);
      if (e.texto?.trim()) {
        for (const l of e.texto.trim().split(/\r?\n/)) linhas.push(`   ${l}`);
      } else {
        linhas.push(`   ${fraseDoRecebedor(e.recebedor)}`);
      }
    });
  }
  return linhas.join('\n');
}

/** O relatório do dia inteiro (todas as rotas do Novo dia), em resumo: quem fez o quê e o que ficou de fora. */
export function textoDoRelatorioDoDia(e: { dataRef: string; teste: boolean; rotas: FechamentoDeRota[]; semResponsavel: { pacotes: number; destino: 'amanha' | 'galpao' } | null }): string {
  const dia = `${e.dataRef.slice(8, 10)}/${e.dataRef.slice(5, 7)}/${e.dataRef.slice(0, 4)}`;
  const total = e.rotas.reduce((n, r) => n + r.total, 0);
  const entregues = e.rotas.reduce((n, r) => n + r.entregues, 0);
  const falhas = e.rotas.flatMap((r) => r.falhas.map((x) => ({ ...x, quem: r.ajudante.nome })));
  const linhas: string[] = [
    `📋 *Relatório do dia — ${dia}*${e.teste ? ' (dia de teste)' : ''}`,
    `✅ *Entregues:* ${entregues} de ${total} em ${plural(e.rotas.length, 'rota', 'rotas')}`,
  ];
  if (falhas.length > 0) linhas.push(`⚠️ *Não entregues:* ${falhas.length}`);
  if (e.semResponsavel && e.semResponsavel.pacotes > 0) {
    linhas.push(`📦 *Nas caixas sem ajudante:* ${e.semResponsavel.pacotes} (${DEPOIS[e.semResponsavel.destino]})`);
  }
  linhas.push('', '*Por ajudante:*');
  for (const r of e.rotas) {
    const selo = r.situacao === 'PERFEITA' ? ' 🏆 rota perfeita' : '';
    linhas.push(`- *${r.ajudante.nome}*: ${r.entregues} de ${r.total}${r.insucessos ? ` · ${plural(r.insucessos, 'insucesso', 'insucessos')}` : ''}${r.semDesfecho ? ` · ${r.semDesfecho} sem registro` : ''}${selo}`);
  }
  if (falhas.length > 0) {
    linhas.push('', '*O que ficou de fora:*');
    for (const x of falhas) {
      const motivo = x.situacao === 'INSUCESSO' ? `insucesso${x.motivo ? `: ${x.motivo}` : ''}` : 'sem registro na rota';
      linhas.push(`- *${x.destinatario || 'Morador'}* — ${enderecoCurto(x)} (${x.quem} · ${motivo}${x.depois ? ` · ${DEPOIS[x.depois]}` : ''})`);
    }
  }
  return linhas.join('\n');
}
