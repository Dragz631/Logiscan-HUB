/**
 * ASSOCIAÇÕES — uma lista por associação (10.1 Chatuba, 10.2 São Sebastião…): as pessoas e quantos pacotes cada
 * uma tem. É a lista que o Hugo manda para as mulheres de cada associação (copiar para o WhatsApp ou imprimir).
 * O HUB já pôs sozinho quem ele lembra; o que ele não sabe espera na Triagem (aqui só aparece o aviso).
 * A tela só mostra e chama a API; o texto da lista vem do mesmo formato do Street (`domain/listaAssociacao`).
 */
import { useMemo, useState } from 'react';
import type { AssociacaoComLista } from '../../application/associacoes';
import { textoDaLista } from '../../domain/listaAssociacao';
import { api } from '../api';
import { useOperador } from '../contexto';
import { copiarTexto } from '../copiar';
import { Aviso, useCarregar } from './comum';

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const rotulo = (a: AssociacaoComLista) => (a.numero ? `${a.numero} · ${a.nome}` : a.nome);

function CartaoAssociacao({ a, todas, imprimindo, onImprimir, onMudou }: {
  a: AssociacaoComLista;
  todas: AssociacaoComLista[];
  imprimindo: string | null;
  onImprimir: (id: string) => void;
  onMudou: () => void;
}) {
  const { exigir } = useOperador();
  const [responsavel, setResponsavel] = useState(a.responsavel ?? '');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const agora = useMemo(() => new Date(), [a]);
  const texto = useMemo(
    () => textoDaLista({ associacao: a.nome, responsavel, pessoas: a.pessoas, agora }),
    [a, responsavel, agora],
  );
  const outras = todas.filter((o) => o.caixaId !== a.caixaId);
  const mudouResponsavel = responsavel.trim() !== (a.responsavel ?? '');

  async function salvarResponsavel() {
    setOcupado(true);
    try {
      const r = await api.definirResponsavel(a.caixaId, responsavel);
      setResponsavel(r.responsavel ?? '');
      setMsg({ tipo: 'ok', texto: r.responsavel ? `A/C salvo: ${r.responsavel}.` : 'Sem responsável na lista.' });
      onMudou();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: `Nada foi gravado: ${(e as Error).message}` });
    } finally {
      setOcupado(false);
    }
  }

  async function copiar() {
    const ok = await copiarTexto(texto);
    setMsg(ok ? { tipo: 'ok', texto: 'Lista copiada: é só colar no WhatsApp.' } : { tipo: 'erro', texto: 'O navegador não deixou copiar. Selecione o texto abaixo e copie à mão.' });
  }

  async function mover(pessoa: AssociacaoComLista['pessoas'][number], paraId: string) {
    const ator = exigir();
    if (!ator || !paraId) return;
    const destino = todas.find((o) => o.caixaId === paraId);
    if (!destino) return;
    setOcupado(true);
    try {
      for (const id of pessoa.pacoteIds) {
        const r = await api.classificarPacote(id, paraId, ator, true);
        if (!r.ok) throw new Error(`${pessoa.nome} já está lembrada em ${r.conflito.atual.nome}`);
      }
      setMsg({ tipo: 'ok', texto: `${pessoa.nome} (${plural(pessoa.pacotes, 'pacote', 'pacotes')}) agora está em ${rotulo(destino)}. O HUB lembra para os próximos dias.` });
      onMudou();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: `Nem tudo foi movido: ${(e as Error).message}` });
      onMudou();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <article className={`cartao-assoc ${imprimindo === a.caixaId ? 'imprimindo' : ''}`} aria-label={`Associação ${rotulo(a)}`}>
      <header className="assoc-topo">
        <div>
          <h2 className="sem-margem">{rotulo(a)}</h2>
          <span className="fraco">
            {plural(a.totalPacotes, 'pacote', 'pacotes')} · {plural(a.totalPessoas, 'pessoa', 'pessoas')}
          </span>
        </div>
        <span className="qtd grande-qtd">{a.totalPacotes}</span>
      </header>

      <p className="so-impressao">
        {a.nome}
        {responsavel.trim() ? ` · A/C: ${responsavel.trim()}` : ''} · {new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(agora)}
      </p>

      <div className="linha nao-imprimir">
        <label className="campo-ac">
          A/C (quem recebe a lista)
          <input value={responsavel} maxLength={60} onChange={(e) => setResponsavel(e.target.value)} placeholder="ex.: Dona Rita" aria-label={`Responsável pela ${a.nome}`} />
        </label>
        <button type="button" disabled={ocupado || !mudouResponsavel} onClick={salvarResponsavel}>Salvar A/C</button>
      </div>

      {msg && <div className="nao-imprimir"><Aviso tipo={msg.tipo}>{msg.texto}</Aviso></div>}

      {a.pessoas.length === 0 ? (
        <p className="fraco">
          Nenhum pacote aqui ainda. Na Triagem, quando você põe uma pessoa nesta associação, o HUB lembra dela e já a coloca aqui nos próximos dias.
        </p>
      ) : (
        <table className="tabela-pessoas">
          <thead>
            <tr>
              <th>#</th>
              <th>Nome</th>
              <th className="num">Pacotes</th>
              <th className="nao-imprimir">Mover para…</th>
            </tr>
          </thead>
          <tbody>
            {a.pessoas.map((p, i) => (
              <tr key={p.nome}>
                <td>{i + 1}</td>
                <td>
                  <b>{p.nome}</b>
                  {p.ruas.length > 0 && <span className="fraco nao-imprimir"> · {p.ruas.join(', ')}</span>}
                </td>
                <td className="num"><b>{p.pacotes}</b></td>
                <td className="nao-imprimir">
                  <select
                    value=""
                    disabled={ocupado}
                    aria-label={`Mover ${p.nome} para outra associação`}
                    onChange={(e) => mover(p, e.target.value)}
                  >
                    <option value="">outra associação…</option>
                    {outras.map((o) => (
                      <option key={o.caixaId} value={o.caixaId}>{rotulo(o)}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td><b>Total</b> ({plural(a.totalPessoas, 'pessoa', 'pessoas')})</td>
              <td className="num"><b>{a.totalPacotes}</b></td>
              <td className="nao-imprimir" />
            </tr>
          </tfoot>
        </table>
      )}

      {a.pessoas.length > 0 && (
        <>
          <details className="nao-imprimir">
            <summary>Ver o texto que será copiado</summary>
            <pre className="texto-lista" aria-label={`Texto da lista da ${a.nome}`}>{texto}</pre>
          </details>
          <div className="linha nao-imprimir">
            <button type="button" className="primario" onClick={copiar}>Copiar lista</button>
            <button type="button" onClick={() => onImprimir(a.caixaId)}>Imprimir</button>
          </div>
        </>
      )}
    </article>
  );
}

export function Associacoes() {
  const dados = useCarregar(() => api.associacoes(), []);
  const [imprimindo, setImprimindo] = useState<string | null>(null);

  function imprimir(id: string) {
    setImprimindo(id);
    const limpar = () => {
      setImprimindo(null);
      window.removeEventListener('afterprint', limpar);
    };
    window.addEventListener('afterprint', limpar);
    // espera a página aplicar a classe de impressão antes de abrir a janela de impressão
    window.setTimeout(() => window.print(), 50);
  }

  const v = dados.dados;
  return (
    <section className={`associacoes ${imprimindo ? 'modo-impressao' : ''}`}>
      <div className="nao-imprimir">
        <h1>Associações</h1>
        <p className="fraco">
          Uma lista por associação, com as pessoas e quantos pacotes cada uma tem, para mandar às mulheres de lá. O HUB já coloca
          sozinho quem ele lembra; o resto você decide na Triagem.
        </p>
        {dados.erro && <Aviso>{dados.erro}</Aviso>}
        {v && v.aguardandoRevisao > 0 && (
          <Aviso tipo="info">
            <b>{plural(v.aguardandoRevisao, 'pacote', 'pacotes')}</b> ainda {v.aguardandoRevisao === 1 ? 'espera' : 'esperam'} a Triagem e não entram em nenhuma lista
            (o HUB não adivinha a associação). <a href="#/triagem">Ir para a Triagem →</a>
          </Aviso>
        )}
      </div>
      {v && v.associacoes.length === 0 && <Aviso tipo="info">Nenhuma associação cadastrada no catálogo de caixas.</Aviso>}
      <div className="lista-assoc">
        {v?.associacoes.map((a) => (
          <CartaoAssociacao key={a.caixaId} a={a} todas={v.associacoes} imprimindo={imprimindo} onImprimir={imprimir} onMudou={dados.recarregar} />
        ))}
      </div>
    </section>
  );
}
