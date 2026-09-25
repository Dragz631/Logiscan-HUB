import { useState } from 'react';
import { rotuloDestino } from '../../domain/destinoPacote';
import { api } from '../api';
import { useOperador } from '../contexto';
import { ROTULO_REQUISITO } from '../../domain/confirmacao';
import { dataHora } from '../formato';
import { Aviso, Estado, useCarregar } from './comum';

export function PacotePagina({ id }: { id: string }) {
  const { exigir } = useOperador();
  const det = useCarregar(() => api.pacote(id), [id]);
  const ajudantes = useCarregar(() => api.ajudantes(), []);
  const [alvo, setAlvo] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  if (det.erro) return <Aviso>{det.erro}</Aviso>;
  const d = det.dados;
  if (!d) return <p className="fraco">Carregando…</p>;
  const p = d.pacote;

  async function entregar() {
    const ator = exigir();
    if (!ator || !alvo) return;
    try {
      await api.entregar([p.id], alvo, ator);
      setMsg({ tipo: 'ok', texto: 'Responsabilidade transferida.' });
      setAlvo('');
      det.recarregar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    }
  }
  async function escolherDestino(destinoId: string | null) {
    const ator = exigir();
    if (!ator) return;
    try {
      det.setDados(await api.confirmarDestino(p.id, destinoId, ator));
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  return (
    <section>
      <p><a href="#/inventario">← Inventário</a></p>
      <h1 className="codigo">{p.codigo}</h1>
      <p className="fraco">
        {p.transportadora} · entrou em {dataHora(p.criadoEm)}
        {d.lote && (
          <>
            {' '}· <a href={`#/importacoes/${d.lote.id}`}>{d.lote.arquivo}</a>
            {p.origem.card !== null && `, card ${p.origem.card + 1}`} do print {p.origem.arquivo}
          </>
        )}
      </p>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}

      <div className="cartoes">
        <div className="cartao">
          <h3>Status</h3>
          <Estado estado={p.estado} />
          {p.pendencias.length > 0 && <span className="selo alerta">revisão pendente</span>}
          {p.confirmacaoEntrega && (
            <p className="fraco">
              Confirmação da entrega: <b>{p.confirmacaoEntrega.status === 'COMPLETA' ? 'completa' : 'incompleta'}</b>
              {p.confirmacaoEntrega.faltando.length > 0 &&
                ` — falta: ${p.confirmacaoEntrega.faltando.map((f) => ROTULO_REQUISITO[f]).join(', ')}`}
            </p>
          )}
          {p.motivoInsucesso && <p className="fraco">Motivo do insucesso: <b>{p.motivoInsucesso}</b></p>}
          {p.cargaId && (
            <p className="fraco">
              Carga: <a href={`#/cargas/${p.cargaId}`}>ver carga</a>
            </p>
          )}
        </div>
        <div className="cartao">
          <h3>Com quem está</h3>
          <p className="grande">{d.responsavel?.nome ?? <span className="fraco">No galpão (sem responsável)</span>}</p>
          {p.estado === 'NAO_ATRIBUIDO' || (p.estado === 'ATRIBUIDO' && !p.cargaId) ? (
          <div className="linha">
            <select value={alvo} onChange={(e) => setAlvo(e.target.value)}>
              <option value="">{d.responsavel ? 'Passar para…' : 'Entregar a…'}</option>
              {ajudantes.dados
                ?.filter((a) => a.id !== p.responsavelId)
                .map((a) => (
                  <option key={a.id} value={a.id}>{a.nome}</option>
                ))}
            </select>
            <button type="button" className="primario" disabled={!alvo} onClick={entregar}>
              Entregar ao ajudante
            </button>
          </div>
          ) : (
            <p className="fraco">Em carga, na rua ou com desfecho: a responsabilidade segue a carga.</p>
          )}
        </div>
        <div className="cartao">
          <h3>Destinatário (etiqueta)</h3>
          <p className="grande">{p.dados.destinatario || '—'}</p>
          <p className="fraco">Quem recebeu de fato será registrado na entrega.</p>
        </div>
      </div>

      <div className="cartoes">
        <div className="cartao">
          <h3>Endereço (como veio)</h3>
          <p>
            {p.dados.rua}
            {p.dados.ruaDetalhe && <span className="fraco"> ({p.dados.ruaDetalhe})</span>}, {p.dados.numero || 'S/N'}
            {p.dados.complemento && ` — ${p.dados.complemento}`}
          </p>
          <p className="fraco">
            {p.dados.bairro} · {p.dados.cidade}/{p.dados.uf} · CEP {p.dados.cep}
          </p>
        </div>
        <div className="cartao">
          <h3>Destino</h3>
          {d.destino ? (
            <p>{rotuloDestino(d.destino)}</p>
          ) : d.candidatos.length > 0 ? (
            <>
              <p>Mesmo número com mais de um local conhecido. Qual é o deste pacote?</p>
              <div className="escolha vertical">
                {d.candidatos.map((c) => (
                  <button type="button" key={c.id} onClick={() => escolherDestino(c.id)}>{rotuloDestino(c)}</button>
                ))}
                <button type="button" onClick={() => escolherDestino(null)}>É outro local (endereço simples)</button>
              </div>
            </>
          ) : (
            <p className="fraco">Sem destino (endereço sem rua).</p>
          )}
          {d.mesmoDestino.length > 0 && (
            <p className="fraco">
              Outros pacotes neste destino:{' '}
              {d.mesmoDestino.map((o, n) => (
                <span key={o.id}>
                  {n > 0 && ', '}
                  <a href={`#/pacotes/${o.id}`}>{o.codigo}</a> ({o.destinatario})
                </span>
              ))}
            </p>
          )}
        </div>
      </div>

      <h2>O que aconteceu</h2>
      <ol className="timeline">
        {d.timeline.map((e) => (
          <li key={e.id}>
            <time>{dataHora(e.ocorridoEm)}</time>
            <div>
              <b>{e.descricao}</b>
              <div className="fraco">
                por {e.ator} · {e.origem}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
