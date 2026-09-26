/**
 * Casos de uso operacionais: ajudantes, entrega ao ajudante (atribuição/reatribuição)
 * e confirmação de destino.
 */
import { destinoDoEndereco } from '../domain/destinoPacote';
import { ErroDominio } from '../domain/eventos';
import { limparEspacos } from '../domain/destino/texto';
import { ErroAplicacao } from './erros';
import type { Ajudante, Contexto } from './portas';
import { registrarEvento } from './registrarEvento';

export function cadastrarAjudante(ctx: Contexto, nome: string): Ajudante {
  const limpo = limparEspacos(nome);
  if (!limpo) throw new ErroAplicacao('NOME_VAZIO', 'informe o nome do ajudante');
  const { armazem } = ctx;
  return armazem.transacao(() => {
    if (armazem.ajudantes.listar().some((a) => a.nome.toLowerCase() === limpo.toLowerCase())) {
      throw new ErroAplicacao('AJUDANTE_DUPLICADO', `já existe um ajudante chamado ${limpo}`, 409);
    }
    const a: Ajudante = { id: ctx.ids.novo(), nome: limpo, ativo: true, criadoEm: ctx.relogio.agora(), veiculo: null };
    armazem.ajudantes.criar(a);
    return a;
  });
}

export function listarAjudantes(ctx: Contexto): Ajudante[] {
  return ctx.armazem.ajudantes.listar();
}

export type ResultadoAtribuicaoItem = {
  pacoteId: string;
  codigo: string;
  resultado: 'ATRIBUIDO' | 'REATRIBUIDO' | 'JA_ESTAVA_COM_ELE' | 'REPETIDO';
};

/**
 * Entrega pacotes a um ajudante: a responsabilidade (quem está com o pacote) passa a ser dele.
 * Tudo ou nada: se um pacote não puder ser entregue, nenhum é.
 *
 * @param chave chave de idempotência da AÇÃO (ex.: gerada pela tela a cada clique);
 *              repetir a mesma chave não gera novos eventos.
 */
export function entregarAoAjudante(
  ctx: Contexto,
  entrada: { pacoteIds: string[]; ajudanteId: string; ator: string; chave: string },
): ResultadoAtribuicaoItem[] {
  if (entrada.pacoteIds.length === 0) throw new ErroAplicacao('SEM_PACOTES', 'selecione ao menos um pacote');
  if (!entrada.chave) throw new ErroAplicacao('SEM_CHAVE', 'chave de idempotência obrigatória');
  const { armazem } = ctx;
  return armazem.transacao(() => {
    const ajudante = armazem.ajudantes.porId(entrada.ajudanteId);
    if (!ajudante || !ajudante.ativo) throw new ErroAplicacao('AJUDANTE_INEXISTENTE', 'ajudante não encontrado', 404);
    const agora = ctx.relogio.agora();
    const para = { id: ajudante.id, nome: ajudante.nome };

    return [...new Set(entrada.pacoteIds)].map((pacoteId): ResultadoAtribuicaoItem => {
      const chaveIdempotencia = `entrega:${entrada.chave}:${pacoteId}`;
      const pacote = armazem.pacotes.porId(pacoteId);
      if (!pacote) throw new ErroAplicacao('PACOTE_INEXISTENTE', `pacote ${pacoteId} não encontrado`, 404);
      if (armazem.eventos.porChave(chaveIdempotencia)) return { pacoteId, codigo: pacote.codigo, resultado: 'REPETIDO' };
      if (pacote.responsavelId === ajudante.id) return { pacoteId, codigo: pacote.codigo, resultado: 'JA_ESTAVA_COM_ELE' };

      const base = {
        id: ctx.ids.novo(),
        pacoteId,
        ator: entrada.ator,
        origem: 'hub' as const,
        ocorridoEm: agora,
        registradoEm: agora,
        chaveIdempotencia,
      };
      try {
        if (pacote.responsavelId === null) {
          registrarEvento(armazem, { ...base, tipo: 'ATRIBUIDO', dados: { ajudante: para } });
          return { pacoteId, codigo: pacote.codigo, resultado: 'ATRIBUIDO' };
        }
        const antigo = armazem.ajudantes.porId(pacote.responsavelId);
        const de = { id: pacote.responsavelId, nome: antigo?.nome ?? '(desconhecido)' };
        registrarEvento(armazem, { ...base, tipo: 'REATRIBUIDO', dados: { de, para } });
        return { pacoteId, codigo: pacote.codigo, resultado: 'REATRIBUIDO' };
      } catch (e) {
        if (e instanceof ErroDominio) throw new ErroAplicacao(e.codigo, `pacote ${pacote.codigo}: ${e.message}`, 409);
        throw e;
      }
    });
  });
}

/**
 * Resolve a pendência DESTINO_A_CONFIRMAR.
 * @param destinoId um dos candidatos, ou `null` = "é outro local": cria o destino do próprio endereço.
 */
export function confirmarDestino(
  ctx: Contexto,
  entrada: { pacoteId: string; destinoId: string | null; ator: string; chave: string },
): void {
  const { armazem } = ctx;
  armazem.transacao(() => {
    const pacote = armazem.pacotes.porId(entrada.pacoteId);
    if (!pacote) throw new ErroAplicacao('PACOTE_INEXISTENTE', 'pacote não encontrado', 404);
    const agora = ctx.relogio.agora();
    let destinoId = entrada.destinoId;
    if (destinoId === null) {
      const proprio = destinoDoEndereco(pacote.dados);
      if (!armazem.destinos.porId(proprio.id)) armazem.destinos.criar(proprio, agora);
      destinoId = proprio.id;
    } else if (!pacote.destinoCandidatos.includes(destinoId)) {
      throw new ErroAplicacao('DESTINO_FORA_DOS_CANDIDATOS', 'destino não está entre os candidatos deste pacote', 409);
    }
    registrarEvento(armazem, {
      id: ctx.ids.novo(),
      pacoteId: pacote.id,
      tipo: 'DESTINO_CONFIRMADO',
      dados: { destinoId, anterior: pacote.destinoId },
      ator: entrada.ator,
      origem: 'hub',
      ocorridoEm: agora,
      registradoEm: agora,
      chaveIdempotencia: `destino:${entrada.chave}:${pacote.id}`,
    });
  });
}
