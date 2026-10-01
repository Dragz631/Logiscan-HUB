/** DIAS — o histórico dos dias encerrados pelo "Novo dia". Dia de teste (só memória) leva o selo TESTE. */
import { useState } from 'react';
import type { Dia } from '../../domain/dias';
import type { RelatorioDoDia } from '../../application/fechamento';
import { api } from '../api';
import { copiarTexto, imprimirTexto } from '../copiar';
import { dataHora } from '../formato';
import { Aviso, useCarregar } from './comum';

const ROTULO_DESTINO = { amanha: 'ficou para amanhã (Retornado)', galpao: 'voltou ao galpão' } as const;

const dataLonga = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** O relatório do dia: quem entregou quanto, rotas perfeitas e o que ficou de fora; copiar ou imprimir. */
function RelatorioDoDiaCartao({ diaId }: { diaId: string }) {
  const [rel, setRel] = useState<RelatorioDoDia | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  async function ver() {
    setCarregando(true);
    try {
      setRel(await api.relatorioDoDia(diaId));
      setMsg(null);
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    } finally {
      setCarregando(false);
    }
  }

  if (!rel) {
    return (
      <div>
        <button type="button" onClick={ver} disabled={carregando}>{carregando ? 'Montando…' : 'Ver relatório do dia'}</button>
        {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      </div>
    );
  }
  const t = rel.totais;
  return (
    <div className="relatorio-dia">
      <div className="contadores">
        <div><b>{t.rotas}</b><span>rotas</span></div>
        <div className="ok"><b>{t.perfeitas}</b><span>rotas perfeitas</span></div>
        <div className="ok"><b>{t.entregues}</b><span>de {t.total} entregues</span></div>
        <div className={t.naoEntregues > 0 ? 'falha' : ''}><b>{t.naoEntregues}</b><span>não entregues</span></div>
      </div>
      <ul className="logradouros">
        {rel.rotas.map((r) => (
          <li key={r.cargaId}>
            <a href={`#/cargas/${r.cargaId}`}><b>{r.ajudante.nome}</b></a>: {r.entregues} de {r.total}
            {r.situacao === 'PERFEITA' && <span className="selo-dia-perfeito"> Dia perfeito</span>}
            {r.insucessos > 0 && <span className="alerta-txt"> · {r.insucessos} insucesso(s)</span>}
            {r.semDesfecho > 0 && <span className="alerta-txt"> · {r.semDesfecho} sem registro</span>}
          </li>
        ))}
      </ul>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      <div className="linha">
        <button
          type="button"
          className="primario"
          onClick={async () => setMsg((await copiarTexto(rel.texto)) ? { tipo: 'ok', texto: 'Relatório copiado: é só colar no WhatsApp.' } : { tipo: 'erro', texto: 'O navegador não deixou copiar. Use Imprimir.' })}
        >
          Copiar relatório do dia
        </button>
        <button type="button" onClick={() => imprimirTexto(`Relatório do dia ${rel.dia.dataRef}`, rel.texto)}>Imprimir</button>
      </div>
    </div>
  );
}

function LinhaDia({ d }: { d: Dia }) {
  const [aberto, setAberto] = useState(false);
  const t = d.resumo.totais;
  return (
    <div className={`card-unidade ${d.historico ? '' : 'dia-teste'}`}>
      <button type="button" className="topo caixa-botao" aria-expanded={aberto} onClick={() => setAberto(!aberto)}>
        <span className="info">
          <b>
            {dataLonga(d.dataRef)}{' '}
            {d.historico ? <span className="chip chip-ativo">HISTÓRICO</span> : <span className="chip chip-alerta">TESTE · só memória</span>}
          </b>
          <span className="fraco">
            encerrado {dataHora(d.encerradoEm)} por {d.encerradoPor} · {t.cargas} carga(s) · {t.entregues} entregue(s)
            {t.amanha > 0 && ` · ${t.amanha} retornado(s)`}
            {t.galpao > 0 && ` · ${t.galpao} ao galpão`}
            {t.desfeitas > 0 && ` · ${t.desfeitas} de carga montada desfeita`}
          </span>
        </span>
        <span className="qtd grande-qtd">{t.entregues}</span>
      </button>
      {aberto && (
        <ul className="logradouros">
          {d.resumo.cargas.map((c) => (
            <li key={c.cargaId}>
              <a href={`#/cargas/${c.cargaId}`}>{c.codigo}</a> — <b>{c.ajudante.nome}</b>:{' '}
              {c.situacao === 'MONTADA'
                ? `carga montada desfeita (${c.pacotes} pacote(s) voltaram às caixas)`
                : `${c.entregues} entregue(s), ${c.sobras} sobra(ram)${c.destino ? ` — ${ROTULO_DESTINO[c.destino]}` : ''}`}
              <span className="fraco"> · {c.caixas.join(', ')}</span>
            </li>
          ))}
          {d.resumo.cargas.some((c) => c.situacao === 'EM_ROTA') && (
            <li><RelatorioDoDiaCartao diaId={d.id} /></li>
          )}
        </ul>
      )}
    </div>
  );
}

export function Dias() {
  const dias = useCarregar(() => api.dias(), []);
  return (
    <section>
      <h1>Dias</h1>
      <p className="fraco">
        Os dias encerrados pelo botão <a href="#/novo-dia">Novo dia</a>. Dia de <b>teste</b> (só memória) fica marcado e não conta
        no histórico de entregas; nada é apagado.
      </p>
      {dias.erro && <Aviso>{dias.erro}</Aviso>}
      <div className="lista-cards">
        {dias.dados?.map((d) => <LinhaDia key={d.id} d={d} />)}
        {dias.dados && dias.dados.length === 0 && <p className="fraco">Nenhum dia encerrado ainda.</p>}
      </div>
    </section>
  );
}
