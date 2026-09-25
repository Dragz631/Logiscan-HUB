/**
 * PERFIL OPERACIONAL DO AJUDANTE — visão de acompanhamento. O HUB não entrega: aqui se
 * monta/ajusta a carga (antes da rota), inicia e finaliza a rota, e acompanha o que o Street devolve.
 */
import { useState } from 'react';
import { descreverEvento } from '../../domain/eventos';
import { api } from '../api';
import { useOperador } from '../contexto';
import { dataHora } from '../formato';
import { Aviso, useCarregar } from './comum';
import { BarraCapacidade, ROTULO_SITUACAO_PERFIL } from './Orquestrador';

export function PerfilPagina({ id }: { id: string }) {
  const { exigir } = useOperador();
  const det = useCarregar(() => api.perfil(id), [id]);
  const outros = useCarregar(() => api.ajudantes(), []);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({ nome: '', veiculo: '', capacidade: '', ativo: true });
  const [reatribuirPara, setReatribuirPara] = useState<Record<string, string>>({});

  if (det.erro) return <Aviso>{det.erro}</Aviso>;
  const p = det.dados;
  if (!p) return <p className="fraco">Carregando…</p>;
  const a = p.ajudante;
  const montada = p.carga?.situacao === 'MONTADA';

  async function acao(fn: (ator: string) => Promise<unknown>, ok: string) {
    const ator = exigir();
    if (!ator) return;
    try {
      await fn(ator);
      setMsg({ tipo: 'ok', texto: ok });
      det.recarregar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.editarPerfil(id, {
        nome: form.nome,
        veiculo: form.veiculo || null,
        capacidade: form.capacidade ? Number(form.capacidade) : null,
        ativo: form.ativo,
      });
      setEditando(false);
      setMsg({ tipo: 'ok', texto: 'Perfil atualizado.' });
      det.recarregar();
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    }
  }

  const estado = p.carga ? ROTULO_SITUACAO_PERFIL[p.carga.situacao] : a.ativo ? 'Livre' : 'Inativo';
  return (
    <section>
      <p><a href="#/ajudantes">← Ajudantes</a></p>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}

      <div className="perfil">
        <div className="coluna-estreita">
          <div className="cartao">
            <div className="linha-topo">
              <h1 className="sem-margem">{a.nome}</h1>
              <span className={`chip ${p.carga ? `perfil-${p.carga.situacao}` : ''}`}>{estado}</span>
            </div>
            <p className="fraco">
              {a.veiculo ?? 'veículo não informado'} · capacidade {a.capacidade ?? '—'} · id {a.id.slice(0, 8)}
            </p>
            {p.carga && (
              <p>
                Carga <a className="codigo" href={`#/cargas/${p.carga.id}`}>{p.carga.codigo}</a>
                <br />
                <span className="fraco">
                  montada {dataHora(p.montadaEm)}
                  {p.rotaIniciadaEm && ` · rota iniciada ${dataHora(p.rotaIniciadaEm)}`}
                </span>
              </p>
            )}
            <div className="linha">
              {montada && p.pacotes > 0 && (
                <button
                  type="button"
                  className="primario"
                  onClick={() =>
                    confirm(`Iniciar a rota de ${a.nome}? ${p.pacotes} pacote(s) passam a estar na rua.`) &&
                    acao((ator) => api.iniciarRota(p.carga!.id, ator), 'Rota iniciada.')
                  }
                >
                  Iniciar rota
                </button>
              )}
              {p.carga && p.carga.situacao !== 'MONTADA' && (
                <button
                  type="button"
                  className={p.carga.situacao === 'CONCLUIDA' ? 'primario' : ''}
                  disabled={p.carga.situacao !== 'CONCLUIDA'}
                  title={p.carga.situacao !== 'CONCLUIDA' ? 'Só com todos os pacotes com desfecho (entregue ou insucesso)' : ''}
                  onClick={() => acao((ator) => api.finalizarRota(p.carga!.id, ator), 'Rota finalizada.')}
                >
                  Finalizar rota
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setForm({ nome: a.nome, veiculo: a.veiculo ?? '', capacidade: a.capacidade ? String(a.capacidade) : '', ativo: a.ativo });
                  setEditando(!editando);
                }}
              >
                Editar perfil
              </button>
            </div>
            {editando && (
              <form className="form-perfil" onSubmit={salvar}>
                <label>Nome<input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></label>
                <label>Veículo<input value={form.veiculo} placeholder="Moto, bicicleta, a pé…" onChange={(e) => setForm({ ...form, veiculo: e.target.value })} /></label>
                <label>Capacidade (pacotes)<input type="number" min={1} value={form.capacidade} onChange={(e) => setForm({ ...form, capacidade: e.target.value })} /></label>
                <label className="check"><input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Ativo</label>
                <button type="submit" className="primario">Salvar</button>
              </form>
            )}
          </div>

          <div className="cartao">
            <h3>Progresso da carga</h3>
            <div className="progresso">
              <div className="anel" style={{ ['--pct' as string]: `${p.progresso}%` }}>
                <span>{p.progresso}%</span>
              </div>
              <div>
                <p className="sem-margem">
                  {p.entregues + p.insucessos} de {p.pacotes} com desfecho
                </p>
                <BarraCapacidade atual={p.pacotes} capacidade={a.capacidade} />
                <p className="fraco sem-margem">
                  {p.pacotes}
                  {a.capacidade ? ` / ${a.capacidade}` : ''} pacotes · {p.ruas} rua(s)
                  {p.excesso && <span className="alerta-txt"> · acima da capacidade</span>}
                </p>
              </div>
            </div>
            <div className="contadores">
              <div><b>{p.pacotes}</b><span>total</span></div>
              <div className="ok"><b>{p.entregues}</b><span>entregues</span></div>
              <div className="pendente"><b>{p.pendentes}</b><span>pendentes</span></div>
              <div className="falha"><b>{p.insucessos}</b><span>insucessos</span></div>
            </div>
          </div>
        </div>

        <div className="coluna-larga">
          <div className="coluna-topo">
            <h2>Ruas da carga</h2>
            {!p.carga && <a href="#/">atribuir ruas no Orquestrador →</a>}
          </div>
          {p.ruasDaCarga.length === 0 && <p className="fraco">Nenhuma rua com {a.nome} agora.</p>}
          <div className="lista-cards">
            {p.ruasDaCarga.map((r) => (
              <div key={r.chave} className="cartao rua-perfil">
                <div className="linha-topo">
                  <b>{r.nome}</b>
                  <span className="qtd">{r.quantidade}</span>
                </div>
                <div className="detalhe">
                  <span className="pendente-txt">{r.pendentes} pendentes</span>
                  <span className="ok-txt">{r.entregues} entregues</span>
                  {r.insucessos > 0 && <span className="alerta-txt">{r.insucessos} insucessos</span>}
                </div>
                <BarraCapacidade atual={r.entregues + r.insucessos} capacidade={r.quantidade} />
                {montada && (
                  <div className="linha">
                    <button type="button" onClick={() => acao((ator) => api.removerRua(p.carga!.id, r.chave, ator), `${r.nome} removida — pacotes voltaram ao galpão.`)}>
                      Remover da carga
                    </button>
                    <select value={reatribuirPara[r.chave] ?? ''} onChange={(e) => setReatribuirPara({ ...reatribuirPara, [r.chave]: e.target.value })}>
                      <option value="">Reatribuir para…</option>
                      {outros.dados?.filter((o) => o.id !== a.id && o.ativo).map((o) => (
                        <option key={o.id} value={o.id}>{o.nome}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!reatribuirPara[r.chave]}
                      onClick={() => acao((ator) => api.removerRua(p.carga!.id, r.chave, ator, reatribuirPara[r.chave]), `${r.nome} reatribuída.`)}
                    >
                      Reatribuir
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <h2>Últimas ocorrências</h2>
          <ol className="timeline">
            {p.ocorrencias.map((e) => (
              <li key={e.id}>
                <time>{dataHora(e.ocorridoEm)}</time>
                <div>
                  <b>{descreverEvento(e)}</b>
                  <div className="fraco">
                    <a href={`#/pacotes/${e.pacoteId}`}>{e.codigo}</a> · por {e.ator} · {e.origem}
                  </div>
                </div>
              </li>
            ))}
            {p.ocorrencias.length === 0 && <li className="fraco">Sem ocorrências.</li>}
          </ol>
        </div>
      </div>
    </section>
  );
}
