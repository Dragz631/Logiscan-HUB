/**
 * REGIÕES OPERACIONAIS — o mapa interno do LogiScan (memória do HUB).
 * Aqui o operador ensina "logradouro X → região" e ajusta a especificidade (prioridade) dentro da região.
 * Região ≠ rua ≠ destino: nada aqui mexe no destino dos pacotes.
 */
import { useState } from 'react';
import type { RegiaoComRuas } from '../../application/regioes';
import { api } from '../api';
import { useOperador } from '../contexto';
import { dataHora } from '../formato';
import { Aviso, useCarregar } from './comum';

function CartaoRegiao({ r, onEnsinar, onPrioridade, onTirar }: {
  r: RegiaoComRuas;
  onEnsinar: (rua: string) => void;
  onPrioridade: (rua: string, prioridade: number | null) => void;
  onTirar: (rua: string) => void;
}) {
  const [nova, setNova] = useState('');
  return (
    <div className="cartao">
      <div className="linha-topo">
        <h2 className="sem-margem">{r.nome}</h2>
        <span className="fraco">{r.ruas.length} logradouro(s)</span>
      </div>
      {r.repasseUnico && <p className="fraco">No repasse, esta região vale como <b>uma rua só</b>: selecionou, vão todos os pacotes dela.</p>}
      {r.ruas.length === 0 && <p className="fraco">Nenhum logradouro ensinado ainda.</p>}
      {r.ruas.length > 0 && (
        <table className="tabela-regiao">
          <thead>
            <tr>
              <th>Logradouro</th>
              <th title="Menor = mais específica (ex.: Rua B = 1 vence Rua Leão XIII = 2 quando os dois aparecem no mesmo endereço)">Prioridade</th>
              <th>Ensinado por</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {r.ruas.map((x) => (
              <tr key={x.chave}>
                <td>{x.nome}</td>
                <td>
                  <input
                    type="number"
                    min={1}
                    className="prioridade"
                    defaultValue={x.prioridade ?? ''}
                    aria-label={`Prioridade de ${x.nome}`}
                    onBlur={(e) => {
                      const v = e.target.value ? Number(e.target.value) : null;
                      if (v !== x.prioridade) onPrioridade(x.nome, v);
                    }}
                  />
                </td>
                <td className="fraco">
                  {x.definidaPor} · {dataHora(x.definidaEm)}
                </td>
                <td>
                  <button type="button" className="link-mini" onClick={() => onTirar(x.nome)}>
                    tirar da região
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        className="linha"
        onSubmit={(e) => {
          e.preventDefault();
          if (nova.trim()) onEnsinar(nova.trim());
          setNova('');
        }}
      >
        <input value={nova} onChange={(e) => setNova(e.target.value)} placeholder={`Logradouro que pertence a ${r.nome}…`} />
        <button type="submit" disabled={!nova.trim()}>Ensinar</button>
      </form>
    </div>
  );
}

export function Regioes() {
  const { exigir } = useOperador();
  const mapa = useCarregar(() => api.mapaRegioes(), []);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [nova, setNova] = useState({ nome: '', repasseUnico: false });

  async function definir(rua: string, regiaoId: string | null, prioridade?: number | null) {
    const ator = exigir();
    if (!ator) return;
    try {
      let r = await api.definirRegiao(rua, regiaoId, ator, false, prioridade);
      if (!r.ok) {
        const para = regiaoId ? (mapa.dados?.regioes.find((g) => g.id === regiaoId)?.nome ?? '?') : 'Outras ruas do Caju';
        if (!confirm(`${r.conflito.rua} já está em "${r.conflito.atual.nome}". Mudar para "${para}"? (fica no histórico)`)) return;
        r = await api.definirRegiao(rua, regiaoId, ator, true, prioridade);
      }
      setMsg({ tipo: 'ok', texto: `${rua}: salvo na memória do HUB.` });
      mapa.recarregar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    const ator = exigir();
    if (!ator) return;
    try {
      await api.criarRegiao(nova.nome, ator, nova.repasseUnico);
      setNova({ nome: '', repasseUnico: false });
      mapa.recarregar();
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    }
  }

  return (
    <section>
      <h1>Regiões operacionais</h1>
      <p className="fraco">
        O mapa interno do LogiScan. Ensine uma vez "este logradouro pertence a esta região" e o HUB faz sozinho nas próximas importações.
        Região não muda rua nem destino dos pacotes.
      </p>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      <form className="linha" onSubmit={criar}>
        <input value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} placeholder="Nova região" />
        <label className="check fraco">
          <input type="checkbox" checked={nova.repasseUnico} onChange={(e) => setNova({ ...nova, repasseUnico: e.target.checked })} /> repassar como uma rua só
        </label>
        <button type="submit" disabled={!nova.nome.trim()}>Criar região</button>
      </form>
      <div className="grade-regioes">
        {mapa.dados?.regioes.map((r) => (
          <CartaoRegiao
            key={r.id}
            r={r}
            onEnsinar={(rua) => definir(rua, r.id)}
            onPrioridade={(rua, pr) => definir(rua, r.id, pr)}
            onTirar={(rua) => definir(rua, null)}
          />
        ))}
      </div>
      {mapa.dados && mapa.dados.semRegiao.length > 0 && (
        <div className="cartao">
          <h2 className="sem-margem">Outras ruas do Caju (decidido: sem região)</h2>
          <p className="fraco">{mapa.dados.semRegiao.map((x) => x.nome).join(', ')}</p>
        </div>
      )}
    </section>
  );
}
