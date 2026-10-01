/**
 * FECHAMENTO DA ROTA — o resumo do que o ajudante fez: faixa ("Rota perfeita" quando entregou tudo), totais, por
 * caixa, o que não foi entregue e a PROVA de cada entrega (quem recebeu, onde, quando e o texto de confirmação que
 * ele copiou no Street). Dá para copiar o relatório (WhatsApp) ou imprimir. A tela só mostra: os números vêm da API.
 */
import { useMemo, useState } from 'react';
import { type FechamentoDeRota, duracao, fraseDoRecebedor, horaSP, textoDoRelatorio } from '../../domain/fechamento';
import { api } from '../api';
import { copiarTexto, imprimirTexto } from '../copiar';
import { Aviso, useCarregar } from './comum';

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const DEPOIS = { amanha: 'ficou para amanhã', galpao: 'voltou ao galpão' } as const;

function titulo(f: FechamentoDeRota) {
  if (f.situacao === 'PERFEITA') return `Rota perfeita: ${f.ajudante.nome} entregou tudo`;
  if (f.situacao === 'CONCLUIDA') return `Rota concluída: ${plural(f.entregues, 'entregue', 'entregues')} e ${plural(f.insucessos, 'insucesso', 'insucessos')}`;
  return `Resumo parcial: ${f.entregues} de ${f.total} entregues`;
}

export function FechamentoDaRota({ cargaId, abertoInicial }: { cargaId: string; abertoInicial: boolean }) {
  const [aberto, setAberto] = useState(abertoInicial);
  const dados = useCarregar(() => api.fechamento(cargaId), [cargaId]);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const f = dados.dados;
  const texto = useMemo(() => (f ? textoDoRelatorio(f, new Date()) : ''), [f]);

  if (!aberto) {
    return (
      <p>
        <button type="button" onClick={() => setAberto(true)}>Ver resumo da rota</button>
      </p>
    );
  }
  if (dados.erro) return <Aviso>{dados.erro}</Aviso>;
  if (!f) return <p className="fraco">Montando o resumo…</p>;

  const ritmo = f.minutosNaRua !== null && f.minutosNaRua > 0 && f.entregues > 0 ? Math.round((f.minutosNaRua / f.entregues) * 10) / 10 : null;
  async function copiar() {
    const ok = await copiarTexto(texto);
    setMsg(ok ? { tipo: 'ok', texto: 'Relatório copiado: é só colar no WhatsApp.' } : { tipo: 'erro', texto: 'O navegador não deixou copiar. Use Imprimir ou selecione o texto à mão.' });
  }

  return (
    <section className="fechamento" aria-label={`Fechamento da rota de ${f.ajudante.nome}`}>
      <div className={`faixa-fechamento ${f.situacao.toLowerCase()}`}>
        <span className="anel-ok" aria-hidden="true">{f.situacao === 'PERFEITA' ? '✓' : f.situacao === 'CONCLUIDA' ? '●' : '…'}</span>
        <div className="faixa-texto">
          <b>{titulo(f)}</b>
          <span>
            {plural(f.total, 'pacote', 'pacotes')} · saiu {horaSP(f.saiuEm)}
            {f.ultimaEntregaEm && ` · última entrega ${horaSP(f.ultimaEntregaEm)}`}
            {f.minutosNaRua !== null && ` · ${duracao(f.minutosNaRua)} na rua`}
          </span>
        </div>
        {f.situacao === 'PERFEITA' && <span className="selo-dia-perfeito">Dia perfeito</span>}
      </div>

      <div className="contadores">
        <div className="ok"><b>{f.entregues}</b><span>entregues</span></div>
        <div className={f.insucessos + f.semDesfecho > 0 ? 'falha' : ''}><b>{f.insucessos + f.semDesfecho}</b><span>não entregues</span></div>
        <div className={f.provasCompletas < f.entregues ? 'pendente' : 'ok'}><b>{f.provasCompletas}</b><span>com foto (de {f.entregues})</span></div>
        <div><b>{ritmo ?? '—'}</b><span>min por pacote</span></div>
      </div>

      <div className="cartao">
        <h3>Por caixa</h3>
        <div className="barras-caixa">
          {f.caixas.map((c) => (
            <div key={`${c.numero}|${c.nome}`} className="barra-caixa">
              <span>{c.numero ? `${c.numero} · ` : ''}{c.nome}</span>
              <div className="trilho"><div className={c.entregues === c.total ? 'cheio' : 'parcial'} style={{ width: `${c.total ? Math.round((c.entregues / c.total) * 100) : 0}%` }} /></div>
              <span className="num">{c.entregues} de {c.total}</span>
            </div>
          ))}
        </div>
      </div>

      {f.falhas.length > 0 && (
        <div className="cartao falhas-fechamento">
          <h3>O que não foi entregue ({f.falhas.length})</h3>
          <ul className="parada-pacotes">
            {f.falhas.map((x) => (
              <li key={x.pacoteId} className="pacote-linha falha">
                <b>{x.destinatario || 'Morador'}</b>
                <a className="chip codigo" href={`#/pacotes/${x.pacoteId}`}>#{x.codigo.slice(-4)}</a>
                <span className="fraco">{x.rua}, {x.numero || 'S/N'}{x.complemento ? ` · ${x.complemento}` : ''}</span>
                <span className="alerta-txt">{x.situacao === 'INSUCESSO' ? `insucesso${x.motivo ? `: ${x.motivo}` : ''}` : 'sem registro na rota'}</span>
                {x.depois && <span className="chip estado-mini">{DEPOIS[x.depois]}</span>}
              </li>
            ))}
          </ul>
          <p className="fraco sem-margem">O que sobrou volta para a caixa ou vai ao galpão no <a href="#/novo-dia">Novo dia</a>.</p>
        </div>
      )}

      {f.entregas.length > 0 && (
        <div className="cartao">
          <h3>Prova de cada entrega ({f.entregas.length})</h3>
          <ul className="provas">
            {f.entregas.map((e) => (
              <ProvaDaEntrega key={e.pacoteId} e={e} />
            ))}
          </ul>
        </div>
      )}

      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      <div className="linha">
        <button type="button" className="primario" onClick={copiar}>Copiar relatório</button>
        <button type="button" onClick={() => imprimirTexto(`Relatório da rota — ${f.ajudante.nome}`, texto)}>Imprimir</button>
      </div>
    </section>
  );
}

function ProvaDaEntrega({ e }: { e: FechamentoDeRota['entregas'][number] }) {
  const [verTexto, setVerTexto] = useState(false);
  return (
    <li className="prova-entrega">
      <div className="prova-topo">
        <b>{e.destinatario || 'Morador'}</b>
        <span className="fraco">{e.rua}, {e.numero || 'S/N'}{e.complemento ? ` · ${e.complemento}` : ''}</span>
        <span className="hora">{horaSP(e.quando)}</span>
      </div>
      <div className="prova-recebedor">{fraseDoRecebedor(e.recebedor)}</div>
      <div className="linha">
        <a className="chip codigo" href={`#/pacotes/${e.pacoteId}`}>#{e.codigo.slice(-4)}</a>
        <span className={`chip estado-mini ${e.provaCompleta ? 'ok' : 'pendente'}`}>{e.provaCompleta ? 'prova completa' : 'fotos pendentes'}</span>
        {e.texto ? (
          <button type="button" className="link-mini" onClick={() => setVerTexto(!verTexto)} aria-expanded={verTexto}>
            {verTexto ? 'Esconder texto de confirmação' : 'Ver texto de confirmação'}
          </button>
        ) : (
          <span className="fraco">sem texto de confirmação</span>
        )}
      </div>
      {verTexto && e.texto && <pre className="texto-lista">{e.texto}</pre>}
    </li>
  );
}
