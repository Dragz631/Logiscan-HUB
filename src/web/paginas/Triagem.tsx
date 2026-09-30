/**
 * TRIAGEM — a mesa das caixas.
 * O HUB já colocou nas caixas o que sabe (memória da pessoa ou da rua). O que ele não sabe espera o Hugo:
 * "esta rua vai nesta caixa" (vale para todos os pacotes dela) ou "esta pessoa vai nesta caixa" (exceção).
 * A decisão vira memória: da próxima vez é automático. Nenhuma regra aqui: a tela mostra e chama a API.
 */
import { useState } from 'react';
import type { CaixaNaTriagem, PacoteTriagem, RuaSemCaixa } from '../../application/triagem';
import { api } from '../api';
import { useOperador } from '../contexto';
import { diaCurto } from '../formato';
import { Aviso, useCarregar } from './comum';

export const rotuloCaixa = (c: { numero: string | null; nome: string }) => (c.numero ? `${c.numero} · ${c.nome}` : c.nome);
const ROTULO_ORIGEM = { manual: 'decidido por você', pessoa: 'pela pessoa', rua: 'pela rua' } as const;

/** Só caixas que recebem pacote (a que só agrupa, como Associações, fica de fora da escolha). */
function EscolhaCaixa({ caixas, valor, onMudar, rotulo }: { caixas: CaixaNaTriagem[]; valor: string; onMudar: (v: string) => void; rotulo: string }) {
  return (
    <select value={valor} onChange={(e) => onMudar(e.target.value)} aria-label={rotulo}>
      <option value="">Qual caixa?</option>
      {caixas.filter((c) => !c.agrupa).map((c) => (
        <option key={c.id} value={c.id}>{c.paiId ? '  ' : ''}{rotuloCaixa(c)}</option>
      ))}
    </select>
  );
}

function LinhaPacote({ p, caixas, onMover, rotuloBotao }: {
  p: PacoteTriagem;
  caixas: CaixaNaTriagem[];
  onMover: (p: PacoteTriagem, caixaId: string) => void;
  rotuloBotao: string;
}) {
  const [caixa, setCaixa] = useState('');
  return (
    <li className="pacote-triagem">
      <span className="numero-badge">{p.numero || 'S/N'}</span>
      <span className="quem">
        <b>
          {p.destinatario || '—'}
          {p.retornadoDia && <span className="chip retornado">Retornado · do dia {diaCurto(p.retornadoDia)}</span>}
        </b>
        <span className="fraco">
          {p.rua}
          {p.complemento && ` · ${p.complemento}`} · <a href={`#/pacotes/${p.id}`}>#{p.codigo.slice(-4)}</a>
          {p.origem && ` · ${ROTULO_ORIGEM[p.origem]}`}
        </span>
      </span>
      {p.podeMover ? (
        <span className="acao">
          <EscolhaCaixa caixas={caixas} valor={caixa} onMudar={setCaixa} rotulo={`Caixa de ${p.destinatario}`} />
          <button type="button" disabled={!caixa} onClick={() => onMover(p, caixa)}>{rotuloBotao}</button>
        </span>
      ) : (
        <span className="fraco">já saiu na carga</span>
      )}
    </li>
  );
}

function GrupoSemCaixa({ g, caixas, onRua, onPacote }: {
  g: RuaSemCaixa;
  caixas: CaixaNaTriagem[];
  onRua: (g: RuaSemCaixa, caixaId: string) => void;
  onPacote: (p: PacoteTriagem, caixaId: string) => void;
}) {
  const [caixa, setCaixa] = useState('');
  const [aberto, setAberto] = useState(false);
  return (
    <div className="card-unidade">
      <div className="topo">
        <span className="info">
          <b>{g.ruaNome}</b>
          <span className="fraco">
            {g.pacotes.length} pacote{g.pacotes.length === 1 ? '' : 's'}
            {g.ceps.length > 0 && ` · CEP ${g.ceps.join(', ')}`}
          </span>
        </span>
        <span className="qtd grande-qtd">{g.pacotes.length}</span>
      </div>
      <div className="acoes-unidade">
        <EscolhaCaixa caixas={caixas} valor={caixa} onMudar={setCaixa} rotulo={`Caixa da ${g.ruaNome}`} />
        <button type="button" className="primario" disabled={!caixa} onClick={() => onRua(g, caixa)}>
          Pôr a rua nesta caixa
        </button>
        <button type="button" className="link-mini" aria-expanded={aberto} onClick={() => setAberto(!aberto)}>
          {aberto ? 'Recolher ▴' : 'Ver pessoas ▾'}
        </button>
      </div>
      {aberto && (
        <ul className="lista-triagem">
          {g.pacotes.map((p) => (
            <LinhaPacote key={p.id} p={p} caixas={caixas} onMover={onPacote} rotuloBotao="Só esta pessoa" />
          ))}
        </ul>
      )}
    </div>
  );
}

function CaixaAberta({ c, caixas, onMover }: { c: CaixaNaTriagem; caixas: CaixaNaTriagem[]; onMover: (p: PacoteTriagem, caixaId: string) => void }) {
  const itens = useCarregar(() => api.pacotesDaCaixa(c.id), [c.id, c.total]);
  if (itens.erro) return <Aviso>{itens.erro}</Aviso>;
  if (!itens.dados) return <p className="fraco">Carregando…</p>;
  return (
    <ul className="lista-triagem">
      {itens.dados.map((p) => (
        <LinhaPacote key={p.id} p={p} caixas={caixas.filter((x) => x.id !== c.id)} onMover={onMover} rotuloBotao="Mover" />
      ))}
      {itens.dados.length === 0 && <li className="fraco">Caixa vazia.</li>}
    </ul>
  );
}

export function Triagem() {
  const { exigir } = useOperador();
  const dados = useCarregar(() => api.triagem(), []);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const v = dados.dados;
  const caixas = v?.caixas ?? [];
  const nome = (id: string) => rotuloCaixa(caixas.find((c) => c.id === id) ?? { numero: null, nome: '?' });

  async function porRua(g: RuaSemCaixa, caixaId: string) {
    const ator = exigir();
    if (!ator) return;
    try {
      let r = await api.classificarRua(g.ruaNome, caixaId, ator);
      if (!r.ok) {
        if (!confirm(`${r.conflito.rua} já está em "${r.conflito.atual.nome}". Mudar para "${nome(caixaId)}"? (fica no histórico)`)) return;
        r = await api.classificarRua(g.ruaNome, caixaId, ator, true);
      }
      setMsg({ tipo: 'ok', texto: `${g.ruaNome} → caixa ${nome(caixaId)} (${g.pacotes.length} pacote(s)). Da próxima vez o HUB coloca sozinho.` });
      dados.recarregar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  async function porPacote(p: PacoteTriagem, caixaId: string) {
    const ator = exigir();
    if (!ator) return;
    try {
      let r = await api.classificarPacote(p.id, caixaId, ator);
      if (!r.ok) {
        if (!confirm(`${r.conflito.pessoa} (${r.conflito.rua}) já estava lembrada na caixa ${rotuloCaixa(r.conflito.atual)}. Mudar para ${nome(caixaId)}? (fica no histórico)`)) return;
        r = await api.classificarPacote(p.id, caixaId, ator, true);
      }
      setMsg({ tipo: 'ok', texto: `${p.destinatario} (${p.rua}) → caixa ${nome(caixaId)}. O HUB lembra dessa pessoa nessa rua.` });
      dados.recarregar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  // A mesa só mostra as caixas que têm pacote hoje: as outras só aparecem quando um JSON trouxer pacotes para elas.
  // (A lista completa continua valendo para escolher a caixa de um pacote.)
  const filhas = (id: string) => caixas.filter((c) => c.paiId === id && c.total > 0);
  const topo = caixas.filter((c) => !c.paiId && c.total + caixas.filter((s) => s.paiId === c.id).reduce((n, s) => n + s.total, 0) > 0);

  return (
    <section className="repasse">
      <div className="repasse-cabecalho">
        <div>
          <h1>Triagem</h1>
          <p className="fraco sem-margem">
            O que o HUB já sabe, ele coloca sozinho na caixa. O resto espera você dizer a caixa — e ele aprende.
          </p>
        </div>
        {v && (
          <div className="acoes">
            <span className="chip chip-status">{v.nasCaixas} nas caixas</span>
            <span className={`chip chip-status ${v.aguardandoRevisao ? 'chip-alerta' : ''}`}>{v.aguardandoRevisao} esperando você</span>
          </div>
        )}
      </div>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      {dados.erro && <Aviso>{dados.erro}</Aviso>}

      <div className="orquestrador">
        <div className="coluna painel">
          <div className="painel-topo">
            <h2>Esperando você</h2>
            <span className="selo-contagem">{v?.semCaixa.length ?? 0} rua(s)</span>
          </div>
          <div className="lista-cards">
            {v?.semCaixa.map((g) => <GrupoSemCaixa key={g.ruaChave} g={g} caixas={caixas} onRua={porRua} onPacote={porPacote} />)}
            {v && v.semCaixa.length === 0 && (
              <p className="fraco centro">Tudo nas caixas. <a href="#/">Ir para o repasse →</a></p>
            )}
          </div>
        </div>

        <div className="coluna painel">
          <div className="painel-topo">
            <h2>Caixas</h2>
            <span className="selo-contagem">{v?.nasCaixas ?? 0} pacote(s)</span>
          </div>
          <div className="lista-cards">
            {topo.length === 0 && <p className="fraco centro">Nenhuma caixa com pacote. As caixas aparecem aqui quando você importar um JSON.</p>}
            {topo.map((c) => {
              const subs = filhas(c.id);
              const total = c.total + subs.reduce((n, s) => n + s.total, 0);
              return (
                <div key={c.id} className="card-unidade">
                  <button type="button" className="topo caixa-botao" onClick={() => setAberta(aberta === c.id ? null : c.id)} aria-expanded={aberta === c.id} aria-label={`Abrir caixa ${rotuloCaixa(c)}: ${total} pacote(s)`}>
                    <span className="info">
                      <b>{rotuloCaixa(c)}</b>
                      <span className="fraco">{subs.length ? `${subs.length} caixas dentro` : 'abrir para conferir'}</span>
                    </span>
                    <span className="qtd grande-qtd">{total}</span>
                  </button>
                  {aberta === c.id && !subs.length && <CaixaAberta c={c} caixas={caixas} onMover={porPacote} />}
                  {aberta === c.id &&
                    subs.map((s) => (
                      <div key={s.id} className="ruas-da-unidade">
                        <b>{rotuloCaixa(s)} <span className="fraco">· {s.total} pacote(s)</span></b>
                        <CaixaAberta c={s} caixas={caixas} onMover={porPacote} />
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
