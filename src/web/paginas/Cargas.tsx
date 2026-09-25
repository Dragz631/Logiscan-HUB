import { useEffect, useState } from 'react';
import type { ResultadoRetorno } from '../../application/cargas';
import type { Pacote } from '../../domain/pacote';
import { api } from '../api';
import { ir, useOperador } from '../contexto';
import { ROTULO_ESTADO, dataHora, enderecoCurto } from '../formato';
import { Aviso, useCarregar } from './comum';

export const ROTULO_SITUACAO = { EM_ROTA: 'Na rua', CONCLUIDA: 'Concluída' } as const;

export function Cargas() {
  const { exigir } = useOperador();
  const cargas = useCarregar(() => api.cargas(), []);
  const ajudantes = useCarregar(() => api.ajudantes(), []);
  const [ajudanteId, setAjudanteId] = useState('');
  const [prontos, setProntos] = useState<Pacote[]>([]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [retorno, setRetorno] = useState<ResultadoRetorno | { ok: false; erros: string[] } | null>(null);

  useEffect(() => {
    setProntos([]);
    setMarcados(new Set());
    if (!ajudanteId) return;
    api
      .prontosParaCarga(ajudanteId)
      .then((l) => {
        setProntos(l);
        setMarcados(new Set(l.map((p) => p.id)));
      })
      .catch((e: Error) => setErro(e.message));
  }, [ajudanteId]);

  async function criar() {
    const ator = exigir();
    if (!ator) return;
    try {
      const c = await api.criarCarga(ajudanteId, [...marcados], ator);
      ir(`/cargas/${c.id}`);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function receber(arquivo: File | undefined) {
    if (!arquivo) return;
    try {
      setRetorno(await api.receberRetorno(arquivo.name, await arquivo.text()));
      cargas.recarregar();
    } catch (e) {
      setRetorno({ ok: false, erros: [(e as Error).message] });
    }
  }

  const alternar = (id: string) => {
    const s = new Set(marcados);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setMarcados(s);
  };

  return (
    <section>
      <h1>Cargas</h1>
      <p className="fraco">
        Carga = o que um ajudante leva para a rua. O Street recebe só os pacotes dele e devolve as entregas.
      </p>
      {erro && <Aviso>{erro}</Aviso>}

      <div className="cartoes">
        <div className="cartao">
          <h3>1 · Montar carga</h3>
          <select value={ajudanteId} onChange={(e) => setAjudanteId(e.target.value)}>
            <option value="">Escolha o ajudante…</option>
            {ajudantes.dados?.map((a) => (
              <option key={a.id} value={a.id}>{a.nome}</option>
            ))}
          </select>
          {ajudanteId && prontos.length === 0 && (
            <p className="fraco">Nenhum pacote com este ajudante no galpão. Entregue pacotes a ele no Inventário primeiro.</p>
          )}
          {prontos.length > 0 && (
            <>
              <ul className="lista-marcar">
                {prontos.map((p) => (
                  <li key={p.id}>
                    <label>
                      <input type="checkbox" checked={marcados.has(p.id)} onChange={() => alternar(p.id)} />
                      <span className="codigo">{p.codigo}</span> <span className="fraco">{enderecoCurto(p.dados)}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <button type="button" className="primario" disabled={marcados.size === 0} onClick={criar}>
                Criar carga com {marcados.size} pacote(s)
              </button>
            </>
          )}
        </div>
        <div className="cartao">
          <h3>3 · Receber retorno do Street</h3>
          <p className="fraco">Arquivo <code>logiscan.street-eventos/v0</code> exportado pelo Street. Pode reenviar: nada duplica.</p>
          <label className="upload">
            <input type="file" accept=".json,application/json" onChange={(e) => receber(e.target.files?.[0])} />
            <span>Escolher arquivo de retorno</span>
          </label>
          {retorno && !retorno.ok && (
            <Aviso>
              <b>Arquivo recusado:</b>
              <ul>
                {retorno.erros.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Aviso>
          )}
          {retorno?.ok && (
            <Aviso tipo={retorno.recusados.length ? 'erro' : 'ok'}>
              {retorno.aceitos} entrega(s) registrada(s), {retorno.repetidos} repetida(s) ignorada(s), {retorno.recusados.length} recusada(s).
              {retorno.recusados.length > 0 && (
                <ul>
                  {retorno.recusados.map((r) => (
                    <li key={r.idEventoStreet}>
                      {r.codigo || r.idEventoStreet}: {r.motivo}
                    </li>
                  ))}
                </ul>
              )}
            </Aviso>
          )}
        </div>
      </div>

      <h2>Cargas</h2>
      <div className="tabela-rolagem">
        <table>
          <thead>
            <tr>
              <th>Carga</th>
              <th>Ajudante</th>
              <th>Criada</th>
              <th>Situação</th>
              <th>Pacotes</th>
            </tr>
          </thead>
          <tbody>
            {cargas.dados?.map((c) => (
              <tr key={c.id}>
                <td>
                  <a className="codigo" href={`#/cargas/${c.id}`}>{c.codigo}</a>
                </td>
                <td>{c.ajudante.nome}</td>
                <td>{dataHora(c.criadaEm)}</td>
                <td>{ROTULO_SITUACAO[c.situacao]}</td>
                <td>
                  {c.total}
                  <span className="fraco">
                    {' '}(
                    {Object.entries(c.porEstado)
                      .map(([e, n]) => `${n} ${ROTULO_ESTADO[e as keyof typeof ROTULO_ESTADO].toLowerCase()}`)
                      .join(', ')}
                    )
                  </span>
                </td>
              </tr>
            ))}
            {cargas.dados?.length === 0 && (
              <tr>
                <td colSpan={5} className="fraco centro">Nenhuma carga ainda.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
