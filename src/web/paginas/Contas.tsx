/**
 * CONTAS — só a master vê. Pedidos de conta feitos no Street esperam aqui: ela aprova e DEFINE o que a conta é
 * (Ajudante, ADMIN ou os dois); se for ajudante, liga a um perfil que já existe ou cria um perfil novo.
 * A tela só mostra e chama a API.
 */
import { useState } from 'react';
import type { ContaPublica, Papel } from '../../domain/contas';
import { api } from '../api';
import { dataHora } from '../formato';
import { Aviso, useCarregar } from './comum';

const ROTULO_PAPEL: Record<Papel, string> = { AJUDANTE: 'Ajudante', ADMIN: 'ADMIN', ADMIN_AJUDANTE: 'ADMIN + Ajudante' };
const DESCRICAO_PAPEL: Record<Papel, string> = {
  AJUDANTE: 'só recebe rota e faz as entregas no Street',
  ADMIN: 'vê e opera o HUB (não sai para entregar)',
  ADMIN_AJUDANTE: 'faz os dois: opera o HUB e também recebe rota no Street',
};

function FormAprovacao({ conta, livres, rotuloBotao, onFeito, onErro }: {
  conta: ContaPublica;
  livres: { id: string; nome: string }[];
  rotuloBotao: string;
  onFeito: () => void;
  onErro: (m: string) => void;
}) {
  const [como, setComo] = useState<Papel>(conta.papel ?? 'AJUDANTE');
  // Só vira "perfil novo" por escolha da master, ou enquanto não houver nenhum ajudante livre para ligar.
  // (Decidir isto só no primeiro desenho erra: a lista de ajudantes ainda não tinha chegado.)
  const [escolhido, setModo] = useState<'existente' | 'novo' | null>(null);
  const modo = escolhido ?? (conta.ajudanteId || livres.length > 0 ? 'existente' : 'novo');
  const [ajudanteId, setAjudanteId] = useState(conta.ajudanteId ?? '');
  const [enviando, setEnviando] = useState(false);
  const precisaPerfil = como !== 'ADMIN';
  const faltaEscolha = precisaPerfil && modo === 'existente' && !ajudanteId;

  async function enviar() {
    setEnviando(true);
    try {
      await api.aprovarConta(conta.id, como, precisaPerfil ? (modo === 'novo' ? { criarPerfilNovo: true } : { ajudanteId }) : {});
      onFeito();
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="form-aprovacao">
      <fieldset className="opcoes" aria-label={`O que ${conta.nome} é`}>
        {(Object.keys(ROTULO_PAPEL) as Papel[]).map((p) => (
          <label key={p} className={como === p ? 'marcada' : ''}>
            <input type="radio" name={`papel-${conta.id}`} aria-label={`${conta.nome}: ${ROTULO_PAPEL[p]}`} checked={como === p} onChange={() => setComo(p)} />
            <span><b>{ROTULO_PAPEL[p]}</b><small>{DESCRICAO_PAPEL[p]}</small></span>
          </label>
        ))}
      </fieldset>
      {precisaPerfil && (
        <fieldset className="opcoes" aria-label="Perfil de ajudante">
          <label className={modo === 'existente' ? 'marcada' : ''}>
            <input type="radio" name={`perfil-${conta.id}`} aria-label={`${conta.nome}: ligar a um ajudante que já existe`} checked={modo === 'existente'} onChange={() => setModo('existente')} />
            <span>
              <b>Ligar a um ajudante que já existe</b>
              <select aria-label={`Ajudante de ${conta.nome}`} value={ajudanteId} onChange={(e) => setAjudanteId(e.target.value)} disabled={modo !== 'existente'}>
                <option value="">— escolha —</option>
                {livres.map((a) => (
                  <option key={a.id} value={a.id}>{a.nome}</option>
                ))}
              </select>
            </span>
          </label>
          <label className={modo === 'novo' ? 'marcada' : ''}>
            <input type="radio" name={`perfil-${conta.id}`} aria-label={`${conta.nome}: criar perfil novo`} checked={modo === 'novo'} onChange={() => setModo('novo')} />
            <span><b>Criar um perfil novo</b><small>com o nome “{conta.nome}”</small></span>
          </label>
        </fieldset>
      )}
      <div className="linha">
        <button type="button" className="primario" disabled={enviando || faltaEscolha} onClick={enviar}>{enviando ? 'Gravando…' : rotuloBotao}</button>
      </div>
    </div>
  );
}

export function Contas({ onMudou }: { onMudou?: () => void }) {
  const contas = useCarregar(() => api.contas(), []);
  const ajudantes = useCarregar(() => api.ajudantes(), []);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [editando, setEditando] = useState<string | null>(null);

  const lista = contas.dados ?? [];
  const ligados = new Set(lista.map((c) => c.ajudanteId).filter(Boolean));
  const livresPara = (c: ContaPublica) =>
    (ajudantes.dados ?? []).filter((a) => !ligados.has(a.id) || a.id === c.ajudanteId).map((a) => ({ id: a.id, nome: a.nome }));
  const pendentes = lista.filter((c) => c.situacao === 'PENDENTE');
  const outras = lista.filter((c) => c.situacao !== 'PENDENTE');

  const recarregar = () => {
    contas.recarregar();
    ajudantes.recarregar();
    onMudou?.(); // a lista de ajudantes da página também muda (perfil novo, ligação)
  };
  async function recusar(c: ContaPublica) {
    if (!confirm(`Recusar a conta de ${c.nome} (${c.usuario})? Ela não entra no HUB nem no Street.`)) return;
    try {
      await api.recusarConta(c.id);
      setMsg({ tipo: 'ok', texto: `Conta de ${c.nome} recusada.` });
      recarregar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  return (
    <section className="contas" aria-label="Contas">
      <h2>Contas {pendentes.length > 0 && <span className="chip chip-status">{pendentes.length} esperando você</span>}</h2>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      {contas.erro && <Aviso>{contas.erro}</Aviso>}
      {pendentes.length === 0 && contas.dados && <p className="fraco">Nenhum pedido de conta esperando. Quem criar conta no Street aparece aqui.</p>}
      <div className="lista-cards">
        {pendentes.map((c) => (
          <div key={c.id} className="card-unidade">
            <div className="topo">
              <span className="info">
                <b>{c.nome}</b>
                <span className="fraco">
                  usuário <code>{c.usuario}</code>
                  {c.telefone ? ` · ${c.telefone}` : ''}
                  {c.veiculo ? ` · ${c.veiculo}` : ''} · pediu em {dataHora(c.criadaEm)}
                </span>
              </span>
              <button type="button" onClick={() => recusar(c)}>Recusar</button>
            </div>
            <FormAprovacao
              conta={c}
              livres={livresPara(c)}
              rotuloBotao="Aceitar"
              onFeito={() => {
                setMsg({ tipo: 'ok', texto: `Conta de ${c.nome} aprovada.` });
                recarregar();
              }}
              onErro={(m) => setMsg({ tipo: 'erro', texto: `Nada foi gravado: ${m}` })}
            />
          </div>
        ))}
      </div>

      {outras.length > 0 && (
        <>
          <h3>Contas já decididas</h3>
          <ul className="logradouros">
            {outras.map((c) => (
              <li key={c.id}>
                <b>{c.nome}</b> · <code>{c.usuario}</code> ·{' '}
                {c.situacao === 'RECUSADA' ? 'recusada' : `${c.papel ? ROTULO_PAPEL[c.papel] : ''}${c.master ? ' · master' : ''}`}
                {!c.master && (
                  <>
                    {' '}
                    <button type="button" onClick={() => setEditando(editando === c.id ? null : c.id)}>
                      {c.situacao === 'RECUSADA' ? 'Aprovar mesmo assim' : 'Mudar papel'}
                    </button>
                    {c.situacao === 'APROVADA' && <button type="button" onClick={() => recusar(c)}>Recusar</button>}
                  </>
                )}
                {editando === c.id && (
                  <FormAprovacao
                    conta={c}
                    livres={livresPara(c)}
                    rotuloBotao="Gravar"
                    onFeito={() => {
                      setEditando(null);
                      setMsg({ tipo: 'ok', texto: `Papel de ${c.nome} atualizado.` });
                      recarregar();
                    }}
                    onErro={(m) => setMsg({ tipo: 'erro', texto: `Nada foi gravado: ${m}` })}
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
