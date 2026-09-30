/**
 * PERFIL OPERACIONAL DO AJUDANTE — o HUB acompanha; quem entrega é o Street.
 *
 * Três situações:
 *  - sem carga            → só o básico (nada a acompanhar);
 *  - carga ainda não está no Street → ruas da carga (dá para ajustar antes da rota) + "aguardando o Street";
 *  - carga já no Street   → visão de acompanhamento no estilo do SafaSanha: resumo + sequência de paradas.
 * Sem botão "Entregar". Ações do HUB: iniciar/finalizar rota, reatribuir/remover rua (antes da rota), ver histórico.
 */
import { useState } from 'react';
import type { CaixaDoPerfil, DetalhePerfil, NumeroNaCaixa } from '../../application/orquestracao';
import { descreverEvento } from '../../domain/eventos';
import { api } from '../api';
import { useOperador } from '../contexto';
import { ROTULO_ESTADO, dataHora, streetVisto } from '../formato';
import { Aviso, useCarregar } from './comum';
import { BarraProgresso, ROTULO_SITUACAO_PERFIL } from './Orquestrador';
import { RepassarRota } from './RepassarRota';

/** Na sequência de paradas, o que ainda não teve desfecho aparece como "Pendente" (visão do Street). */
const ROTULO_PARADA: Record<string, string> = { ATRIBUIDO: 'Pendente', EM_ROTA: 'Pendente', ENTREGUE: 'Entrega registrada', INSUCESSO: 'Insucesso' };

const ESTADO_PACOTE_CLS: Record<string, string> = {
  ENTREGUE: 'ok',
  INSUCESSO: 'falha',
  EM_ROTA: 'pendente',
  ATRIBUIDO: 'pendente',
};

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Um NÚMERO da caixa, como o card de número do Street: vários pacotes/casas no mesmo número aparecem juntos. */
function CartaoNumero({ n }: { n: NumeroNaCaixa }) {
  const cls = n.pendentes === 0 && n.insucessos === 0 ? 'completo' : n.insucessos > 0 && n.pendentes === 0 ? 'com-falha' : '';
  return (
    <div className={`numero-card ${cls}`}>
      <div className="numero-card-topo">
        <span className="numero-badge">
          <small>Nº</small>
          {n.numero}
        </span>
        <div className="numero-card-titulo">
          <b>{n.rua}, {n.numero}</b>
          <span className="fraco">
            {plural(n.total, 'pacote', 'pacotes')} • <span className={n.pendentes ? 'pendente-txt' : 'ok-txt'}>{plural(n.pendentes, 'pendente', 'pendentes')}</span>
            {n.entregues > 0 && (
              <>
                {' '}• <span className="ok-txt">{plural(n.entregues, 'entregue', 'entregues')}</span>
              </>
            )}
            {n.insucessos > 0 && (
              <>
                {' '}• <span className="alerta-txt">{plural(n.insucessos, 'insucesso', 'insucessos')}</span>
              </>
            )}
          </span>
          {n.total > 1 && n.destinos.length === 1 && <span className="numero-aviso">{n.total} pacotes neste número</span>}
          {n.destinos.length > 1 && <span className="numero-aviso atencao">{n.destinos.length} locais diferentes neste número</span>}
        </div>
      </div>
      {n.destinos.map((d) => (
        <ul key={d.destinoId} className="parada-pacotes">
          {n.destinos.length > 1 && <li className="destino-titulo fraco">{d.titulo}</li>}
          {d.pacotes.map((p) => (
            <li key={p.id} className={`pacote-linha ${ESTADO_PACOTE_CLS[p.estado] ?? ''}`}>
              <b>{p.destinatario || '—'}</b>
              <a className="chip codigo" href={`#/pacotes/${p.id}`}>#{p.codigo.slice(-4)}</a>
              <span className={`chip estado-mini ${ESTADO_PACOTE_CLS[p.estado] ?? ''}`}>{ROTULO_PARADA[p.estado] ?? ROTULO_ESTADO[p.estado]}</span>
              {p.provaIncompleta && <span className="chip chip-alerta estado-mini" title="Faltam foto do pacote e foto do local">prova incompleta</span>}
              {p.complemento && <span className="fraco">{p.complemento}</span>}
              {p.motivoInsucesso && <span className="alerta-txt">{p.motivoInsucesso}</span>}
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

/** Uma CAIXA que o ajudante recebeu: card com setinha; aberta, mostra os números em ordem crescente. */
function CartaoCaixa({ c, abertaInicial }: { c: CaixaDoPerfil; abertaInicial: boolean }) {
  const [aberta, setAberta] = useState(abertaInicial);
  const titulo = c.numero ? `${c.numero} · ${c.nome}` : c.nome;
  return (
    <div className={`caixa-perfil-card ${c.pendentes === 0 ? 'completa' : ''}`}>
      <button
        type="button"
        className="caixa-perfil-topo"
        onClick={() => setAberta(!aberta)}
        aria-expanded={aberta}
        aria-label={`Caixa ${titulo}: ${c.total} pacote(s), ${c.pendentes} pendente(s)`}
      >
        <span className="seta">{aberta ? '▾' : '▸'}</span>
        <span className="caixa-perfil-titulo">
          <b>{titulo}</b>
          <span className="fraco">
            {plural(c.numeros.length, 'número', 'números')} • {plural(c.total, 'pacote', 'pacotes')} •{' '}
            <span className={c.pendentes ? 'pendente-txt' : 'ok-txt'}>{plural(c.pendentes, 'pendente', 'pendentes')}</span>
            {c.entregues > 0 && (
              <>
                {' '}• <span className="ok-txt">{plural(c.entregues, 'entregue', 'entregues')}</span>
              </>
            )}
            {c.insucessos > 0 && (
              <>
                {' '}• <span className="alerta-txt">{plural(c.insucessos, 'insucesso', 'insucessos')}</span>
              </>
            )}
          </span>
        </span>
        <span className="qtd">{c.pendentes}</span>
      </button>
      {aberta && (
        <div className="caixa-perfil-numeros">
          {c.numeros.map((n) => (
            <CartaoNumero key={`${n.rua}|${n.numero}`} n={n} />
          ))}
        </div>
      )}
    </div>
  );
}

function ResumoCarga({ p }: { p: DetalhePerfil }) {
  return (
    <div className="cartao">
      <h3>Resumo das ruas</h3>
      <div className="progresso">
        <div className="anel" style={{ ['--pct' as string]: `${p.progresso}%` }}>
          <span>{p.progresso}%</span>
        </div>
        <div>
          <p className="sem-margem">
            {p.entregues} de {p.pacotes} pacotes entregues
          </p>
          <BarraProgresso feitos={p.entregues + p.insucessos} total={p.pacotes} />
          <p className="fraco sem-margem">{p.ruas} rua(s)</p>
        </div>
      </div>
      <div className="contadores">
        <div><b>{p.pacotes}</b><span>total</span></div>
        <div className="ok"><b>{p.entregues}</b><span>entregues</span></div>
        <div className="pendente"><b>{p.pendentes}</b><span>pendentes</span></div>
        <div className="falha"><b>{p.insucessos}</b><span>falhas</span></div>
      </div>
    </div>
  );
}

export function PerfilPagina({ id }: { id: string }) {
  const { exigir } = useOperador();
  const det = useCarregar(() => api.perfil(id), [id]);
  const outros = useCarregar(() => api.ajudantes(), []);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({ nome: '', veiculo: '', ativo: true });
  const [reatribuirPara, setReatribuirPara] = useState<Record<string, string>>({});
  const [repassando, setRepassando] = useState(false);

  if (det.erro) return <Aviso>{det.erro}</Aviso>;
  const p = det.dados;
  if (!p) return <p className="fraco">Carregando…</p>;
  const a = p.ajudante;
  const montada = p.carga?.situacao === 'MONTADA';
  const noStreet = !!p.recebidaNoStreetEm;

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
      await api.editarPerfil(id, { nome: form.nome, veiculo: form.veiculo || null, ativo: form.ativo });
      setEditando(false);
      setMsg({ tipo: 'ok', texto: 'Perfil atualizado.' });
      det.recarregar();
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    }
  }

  const estado = p.carga ? ROTULO_SITUACAO_PERFIL[p.carga.situacao] : a.ativo ? 'Sem carga' : 'Inativo';
  return (
    <section>
      <p><a href="#/ajudantes">← Ajudantes</a></p>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}

      <div className="perfil">
        <div className="coluna-estreita">
          <div className="cartao">
            <div className="linha-topo">
              <h1 className="sem-margem">{a.nome}</h1>
              <span className="chip codigo">ID {a.id.slice(0, 8)}</span>
            </div>
            <span className={`chip ${p.carga ? `perfil-${p.carga.situacao}` : ''}`}>{estado}</span>
            <p className="fraco">{a.veiculo ?? 'veículo não informado'}</p>
            {p.carga && (
              <p>
                Carga <a className="codigo" href={`#/cargas/${p.carga.id}`}>{p.carga.codigo}</a>
                <br />
                <span className="fraco">
                  montada {dataHora(p.montadaEm)}
                  {p.rotaIniciadaEm && ` · rota iniciada ${dataHora(p.rotaIniciadaEm)}`}
                  <br />
                  {noStreet ? `no Street desde ${dataHora(p.recebidaNoStreetEm)}` : 'ainda não chegou ao Street'}
                </span>
              </p>
            )}
            <p className={`street-visto ${p.streetVistoEm ? '' : 'nunca'}`}>{streetVisto(p.streetVistoEm)}</p>
            {p.repasse && (
              <p className="repasse-aviso" role="status">
                ↔ {p.repasse.sentido === 'enviado' ? `Repasse do ${a.nome} para ${p.repasse.com}` : `Repasse do ${p.repasse.com} para ${a.nome}`} ·{' '}
                {dataHora(p.repasse.em)} · {p.repasse.pacotes} pacote(s)
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
              {p.carga?.situacao === 'EM_ROTA' && (
                <button type="button" onClick={() => setRepassando(true)} title="Se aconteceu algo com o ajudante: passa a rota para outro ajudante ativo">
                  Repassar rota
                </button>
              )}
              {p.carga && p.carga.situacao !== 'MONTADA' && (
                <button
                  type="button"
                  className={p.carga.situacao === 'CONCLUIDA' ? 'primario' : ''}
                  disabled={p.carga.situacao !== 'CONCLUIDA'}
                  title={p.carga.situacao !== 'CONCLUIDA' ? 'Só com todos os pacotes com desfecho (entregue ou insucesso)' : ''}
                  onClick={() => acao((ator) => api.finalizarRota(p.carga!.id, ator), 'Carga finalizada.')}
                >
                  Finalizar carga
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setForm({ nome: a.nome, veiculo: a.veiculo ?? '', ativo: a.ativo });
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
                <label className="check"><input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Ativo</label>
                <button type="submit" className="primario">Salvar</button>
              </form>
            )}
          </div>

          {p.carga && <ResumoCarga p={p} />}

          {p.carga && (
            <div className="cartao">
              <h3>Caixas da carga</h3>
              <p className="fraco sem-margem">A caixa entra e sai da carga inteira (antes de iniciar a rota).</p>
              {[{ ruas: p.ruasDaCarga }].map((g) => (
                <div key="caixas" className="regiao-perfil">
                  {g.ruas.map((r) => (
                    <div key={r.chave} className="rua-perfil">
                      <div className="linha-topo">
                        <span>{r.nome}</span>
                        <span className="qtd">{r.quantidade}</span>
                      </div>
                      <span className="fraco">
                        {r.pendentes} pendente(s) · {r.entregues} entregue(s){r.insucessos ? ` · ${r.insucessos} falha(s)` : ''}
                      </span>
                      {montada && (
                        <div className="linha">
                          <button type="button" onClick={() => acao((ator) => api.removerRua(p.carga!.id, r.chave, ator), `${r.nome} removida — pacotes voltaram ao galpão.`)}>
                            Remover
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
              ))}
            </div>
          )}
        </div>

        <div className="coluna-larga">
          {!p.carga && (
            <div className="cartao vazio">
              <p className="sem-margem">
                {a.nome} está sem carga. <a href="#/">Entregar ruas no Orquestrador →</a>
              </p>
            </div>
          )}

          {p.carga && !noStreet && (
            <div className="cartao vazio">
              <p className="sem-margem">
                <b>Aguardando o Street de {a.nome} receber a carga.</b> A sequência de paradas aparece aqui quando os pacotes estiverem no
                Street dele (o Street confere o HUB sozinho com o perfil de {a.nome} ativo).
              </p>
            </div>
          )}

          {p.carga && (
            <>
              <div className="coluna-topo">
                <h2 className="sem-margem">Caixas de {a.nome}</h2>
                <span className="fraco">{plural(p.caixasRecebidas.length, 'caixa', 'caixas')} • assim aparece no Street dele</span>
              </div>
              <div className="lista-cards">
                {p.caixasRecebidas.map((c) => (
                  <CartaoCaixa key={c.chave} c={c} abertaInicial={p.caixasRecebidas.length === 1} />
                ))}
              </div>
            </>
          )}

          {noStreet && (
            <>
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
              </ol>
            </>
          )}
        </div>
      </div>
      {repassando && p.carga && (
        <RepassarRota
          cargaId={p.carga.id}
          de={a.nome}
          onFechar={() => setRepassando(false)}
          onFeito={(texto) => {
            setRepassando(false);
            setMsg({ tipo: 'ok', texto });
            det.recarregar();
          }}
        />
      )}
    </section>
  );
}
