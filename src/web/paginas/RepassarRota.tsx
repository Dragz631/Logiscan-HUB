/**
 * REPASSAR ROTA — a rota em andamento passa para outro ajudante ativo (aconteceu algo na rua).
 * A janela mostra quem pode receber, as caixas que ainda têm pacote na rua e a frase de confirmação:
 * "Repasse do Hugo para João: 12 pacotes em 3 caixas". Nenhuma regra aqui: a tela mostra e chama a API.
 */
import { useMemo, useState } from 'react';
import type { ResumoPerfil } from '../../application/orquestracao';
import { api } from '../api';
import { useOperador } from '../contexto';
import { Aviso, useCarregar } from './comum';

export function RepassarRota({ cargaId, de, onFechar, onFeito }: {
  cargaId: string;
  /** Nome de quem está com a rota hoje. */
  de: string;
  onFechar: () => void;
  onFeito: (mensagem: string) => void;
}) {
  const { exigir } = useOperador();
  const pend = useCarregar(() => api.pendenciasDaRota(cargaId), [cargaId]);
  const perfis = useCarregar(() => api.orquestrador(), []);
  const [para, setPara] = useState('');
  const [fora, setFora] = useState<Set<string>>(new Set()); // caixas desmarcadas
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const candidatos = useMemo(
    () =>
      (perfis.dados?.perfis ?? [])
        .filter((x) => x.carga?.id !== cargaId)
        .map((x: ResumoPerfil) => ({
          id: x.ajudante.id,
          nome: x.ajudante.nome,
          motivo: !x.ajudante.ativo ? 'inativo' : x.carga ? `já tem a carga ${x.carga.codigo} aberta` : null,
        })),
    [perfis.dados, cargaId],
  );
  const caixas = pend.dados?.caixas ?? [];
  const vao = caixas.filter((c) => !fora.has(c.chave));
  const pacotes = vao.reduce((n, c) => n + c.pendentes, 0);
  const destino = candidatos.find((c) => c.id === para);
  const frase = destino ? `Repasse do ${de} para ${destino.nome}: ${pacotes} pacote(s) em ${vao.length} caixa(s)` : 'Escolha quem assume a rota';

  async function repassar() {
    const ator = exigir();
    if (!ator || !destino) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await api.repassarRota(cargaId, destino.id, fora.size ? vao.map((c) => c.chave) : undefined, motivo, ator);
      onFeito(`Repasse do ${de} para ${destino.nome}: ${r.pacotes} pacote(s) em ${r.caixas.length} caixa(s), carga ${r.cargaNova.codigo} já em rota.`);
    } catch (e) {
      setErro(`Nada foi gravado: ${(e as Error).message}`);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="modal-fundo" role="dialog" aria-modal="true" aria-label={`Repassar a rota de ${de}`}>
      <div className="modal">
        <h2>Repassar a rota de {de}</h2>
        <p className="fraco sem-margem">
          O que {de} já entregou fica com ele. O que ainda está na rua passa para uma carga <b>nova</b> de quem assume, já em rota.
        </p>
        {erro && <Aviso>{erro}</Aviso>}
        {pend.erro && <Aviso>{pend.erro}</Aviso>}

        <h3>Quem assume</h3>
        <div className="opcoes" role="radiogroup" aria-label="Quem assume a rota">
          {candidatos.map((c) => (
            <label key={c.id} className={`${para === c.id ? 'marcada' : ''} ${c.motivo ? 'travada' : ''}`}>
              <input type="radio" name="destino" aria-label={`Quem assume: ${c.nome}${c.motivo ? ` (não pode: ${c.motivo})` : ''}`} disabled={!!c.motivo} checked={para === c.id} onChange={() => setPara(c.id)} />
              <span>
                <b>{c.nome}</b>
                {c.motivo && <small className="alerta-txt">não pode receber: {c.motivo}</small>}
              </span>
            </label>
          ))}
          {perfis.dados && candidatos.length === 0 && <p className="fraco">Não há outro ajudante cadastrado.</p>}
        </div>

        <h3>O que passa ({pacotes} pacote(s) na rua)</h3>
        {caixas.length === 0 && pend.dados && <p className="fraco">Não há pacote na rua para repassar.</p>}
        <ul className="lista-triagem">
          {caixas.map((c) => (
            <li key={c.chave} className="pacote-triagem">
              <label className="check">
                <input
                  type="checkbox"
                  aria-label={`Repassar a caixa ${c.numero ? `${c.numero} · ` : ''}${c.nome} (${c.pendentes} pacote(s))`}
                  checked={!fora.has(c.chave)}
                  onChange={() => {
                    const s = new Set(fora);
                    if (s.has(c.chave)) s.delete(c.chave);
                    else s.add(c.chave);
                    setFora(s);
                  }}
                />{' '}
                <b>{c.numero ? `${c.numero} · ` : ''}{c.nome}</b>
              </label>
              <span className="qtd">{c.pendentes}</span>
            </li>
          ))}
        </ul>

        <label className="campo">
          Motivo (opcional)
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex.: Hugo caiu da moto" />
        </label>

        <p className="frase-repasse"><b>{frase}</b></p>
        <div className="linha">
          <button type="button" onClick={onFechar}>Cancelar</button>
          <button type="button" className="primario" disabled={!destino || pacotes === 0 || enviando} onClick={repassar}>
            {enviando ? 'Repassando…' : 'Repassar rota'}
          </button>
        </div>
      </div>
    </div>
  );
}
