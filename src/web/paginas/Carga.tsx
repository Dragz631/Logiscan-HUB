import { useState } from 'react';
import { api } from '../api';
import { useOperador } from '../contexto';
import { dataHora, enderecoCurto } from '../formato';
import { ROTULO_SITUACAO } from './Cargas';
import { Aviso, Estado, useCarregar } from './comum';

export function CargaPagina({ id }: { id: string }) {
  const { exigir } = useOperador();
  const det = useCarregar(() => api.carga(id), [id]);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  if (det.erro) return <Aviso>{det.erro}</Aviso>;
  const c = det.dados;
  if (!c) return <p className="fraco">Carregando…</p>;

  async function baixar() {
    const ator = exigir();
    if (!ator) return;
    try {
      const { arquivo, documento } = await api.exportarCarga(id, ator);
      const url = URL.createObjectURL(new Blob([JSON.stringify(documento, null, 2)], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: arquivo });
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ tipo: 'ok', texto: `${arquivo} gerado com ${documento.pacotes.length} pacote(s). Abra no Street do ${c!.ajudante.nome}.` });
      det.recarregar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  const naRua = c.porEstado.EM_ROTA ?? 0;
  return (
    <section>
      <p><a href="#/cargas">← Cargas</a></p>
      <h1 className="codigo">{c.codigo}</h1>
      <p className="fraco">
        {c.ajudante.nome} · criada {dataHora(c.criadaEm)} por {c.criadaPor} · {ROTULO_SITUACAO[c.situacao]}
      </p>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}

      <div className="barra-acao">
        <span>
          <b>2 · Levar para o Street:</b> {naRua} pacote(s) na rua.
        </span>
        <button type="button" className="primario" disabled={naRua === 0} onClick={baixar}>
          Baixar arquivo da carga
        </button>
      </div>

      <div className="tabela-rolagem">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Destinatário</th>
              <th>Endereço</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {c.pacotes.map((p) => (
              <tr key={p.id}>
                <td>
                  <a className="codigo" href={`#/pacotes/${p.id}`}>{p.codigo}</a>
                </td>
                <td>{p.dados.destinatario}</td>
                <td>{enderecoCurto(p.dados)}</td>
                <td><Estado estado={p.estado} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Histórico da carga</h2>
      <ol className="timeline">
        {c.historico.map((e) => (
          <li key={e.id}>
            <time>{dataHora(e.ocorridoEm)}</time>
            <div>
              <b>{e.descricao}</b>
              <div className="fraco">por {e.ator}</div>
              {e.tipo === 'RETORNO_RECEBIDO' && e.dados.recusados.length > 0 && (
                <ul className="motivos">
                  {e.dados.recusados.map((r) => (
                    <li key={r.idEventoStreet}>
                      {r.codigo || r.idEventoStreet}: {r.motivo}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
