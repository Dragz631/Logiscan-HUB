import { useState } from 'react';
import { ESTADOS } from '../../domain/pacote';
import { api } from '../api';
import { useOperador } from '../contexto';
import { ROTULO_ESTADO, enderecoCurto } from '../formato';
import { Aviso, Estado, Numero, useCarregar } from './comum';

interface Filtro {
  busca: string;
  estado: string;
  responsavelId: string;
  semResponsavel: string;
  revisaoPendente: string;
}
const VAZIO: Filtro = { busca: '', estado: '', responsavelId: '', semResponsavel: '', revisaoPendente: '' };

export function Inventario() {
  const { exigir } = useOperador();
  const [filtro, setFiltro] = useState<Filtro>(VAZIO);
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [ajudanteAlvo, setAjudanteAlvo] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const resumo = useCarregar(() => api.resumo(), []);
  const ajudantes = useCarregar(() => api.ajudantes(), []);
  const lista = useCarregar(() => api.pacotes({ ...filtro }), [JSON.stringify(filtro)]);

  const mudar = (parcial: Partial<Filtro>) => {
    setFiltro({ ...filtro, ...parcial });
    setSelecao(new Set());
  };
  const alternar = (id: string) => {
    const s = new Set(selecao);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelecao(s);
  };
  const pacotes = lista.dados ?? [];
  const todosMarcados = pacotes.length > 0 && pacotes.every((p) => selecao.has(p.id));

  async function entregar() {
    const ator = exigir();
    if (!ator || !ajudanteAlvo) return;
    try {
      const r = await api.entregar([...selecao], ajudanteAlvo, ator);
      const nome = ajudantes.dados?.find((a) => a.id === ajudanteAlvo)?.nome;
      const novos = r.filter((x) => x.resultado === 'ATRIBUIDO' || x.resultado === 'REATRIBUIDO').length;
      setMsg({ tipo: 'ok', texto: `${novos} pacote(s) entregue(s) a ${nome}.` });
      setSelecao(new Set());
      lista.recarregar();
      resumo.recarregar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  const r = resumo.dados;
  return (
    <section>
      <h1>Inventário</h1>
      {r && (
        <div className="numeros">
          <Numero rotulo="pacotes no inventário" valor={r.total} onClick={() => mudar(VAZIO)} ativo={JSON.stringify(filtro) === JSON.stringify(VAZIO)} />
          <Numero
            rotulo="precisam de revisão"
            valor={r.revisaoPendente}
            tom={r.revisaoPendente ? 'alerta' : 'ok'}
            onClick={() => mudar({ ...VAZIO, revisaoPendente: '1' })}
            ativo={filtro.revisaoPendente === '1'}
          />
          <Numero
            rotulo="sem responsável"
            valor={r.semResponsavel}
            tom={r.semResponsavel ? 'alerta' : 'ok'}
            onClick={() => mudar({ ...VAZIO, semResponsavel: '1' })}
            ativo={filtro.semResponsavel === '1'}
          />
          {r.porAjudante
            .filter((a) => a.quantidade > 0)
            .map((a) => (
              <Numero
                key={a.ajudante.id}
                rotulo={`com ${a.ajudante.nome}`}
                valor={a.quantidade}
                onClick={() => mudar({ ...VAZIO, responsavelId: a.ajudante.id })}
                ativo={filtro.responsavelId === a.ajudante.id}
              />
            ))}
        </div>
      )}
      {r?.total === 0 && (
        <Aviso tipo="info">
          Inventário vazio. <a href="#/importar">Importe um JSON do extractor</a> para começar.
        </Aviso>
      )}

      <div className="filtros">
        <input
          type="search"
          placeholder="Buscar código, nome, rua…"
          value={filtro.busca}
          onChange={(e) => mudar({ busca: e.target.value })}
        />
        <select value={filtro.estado} onChange={(e) => mudar({ estado: e.target.value })}>
          <option value="">Todos os estados</option>
          {ESTADOS.map((s) => (
            <option key={s} value={s}>{ROTULO_ESTADO[s]}</option>
          ))}
        </select>
        <select
          value={filtro.semResponsavel ? '__sem' : filtro.responsavelId}
          onChange={(e) =>
            e.target.value === '__sem'
              ? mudar({ semResponsavel: '1', responsavelId: '' })
              : mudar({ semResponsavel: '', responsavelId: e.target.value })
          }
        >
          <option value="">Qualquer responsável</option>
          <option value="__sem">Sem responsável</option>
          {ajudantes.dados?.map((a) => (
            <option key={a.id} value={a.id}>{a.nome}</option>
          ))}
        </select>
      </div>

      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      {lista.erro && <Aviso>{lista.erro}</Aviso>}

      {selecao.size > 0 && (
        <div className="barra-acao">
          <b>{selecao.size} selecionado(s)</b>
          <select value={ajudanteAlvo} onChange={(e) => setAjudanteAlvo(e.target.value)}>
            <option value="">Escolha o ajudante…</option>
            {ajudantes.dados?.map((a) => (
              <option key={a.id} value={a.id}>{a.nome}</option>
            ))}
          </select>
          <button type="button" className="primario" disabled={!ajudanteAlvo} onClick={entregar}>
            Entregar ao ajudante
          </button>
          {ajudantes.dados?.length === 0 && <a href="#/ajudantes">Cadastre um ajudante primeiro</a>}
        </div>
      )}

      <div className="tabela-rolagem">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Marcar todos"
                  checked={todosMarcados}
                  onChange={() => setSelecao(todosMarcados ? new Set() : new Set(pacotes.map((p) => p.id)))}
                />
              </th>
              <th>Código</th>
              <th>Destinatário</th>
              <th>Endereço</th>
              <th>Status</th>
              <th>Com quem está</th>
            </tr>
          </thead>
          <tbody>
            {pacotes.map((p) => (
              <tr key={p.id} className={selecao.has(p.id) ? 'marcada' : ''}>
                <td>
                  <input type="checkbox" aria-label={`Marcar ${p.codigo}`} checked={selecao.has(p.id)} onChange={() => alternar(p.id)} />
                </td>
                <td>
                  <a className="codigo" href={`#/pacotes/${p.id}`}>{p.codigo}</a>
                </td>
                <td>{p.dados.destinatario}</td>
                <td>
                  {enderecoCurto(p.dados)}
                  {p.pendencias.length > 0 && <span className="selo alerta">destino a confirmar</span>}
                </td>
                <td><Estado estado={p.estado} /></td>
                <td>{p.responsavelNome ?? <span className="fraco">—</span>}</td>
              </tr>
            ))}
            {lista.dados && pacotes.length === 0 && (
              <tr>
                <td colSpan={6} className="fraco centro">Nenhum pacote com esse filtro.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pacotes.length > 0 && <p className="fraco">Mostrando {pacotes.length} pacote(s). Clique no código para ver a história do pacote.</p>}
    </section>
  );
}
