/** DIAS — o histórico dos dias encerrados pelo "Novo dia". Dia de teste (só memória) leva o selo TESTE. */
import { useState } from 'react';
import type { Dia } from '../../domain/dias';
import { api } from '../api';
import { dataHora } from '../formato';
import { Aviso, useCarregar } from './comum';

const ROTULO_DESTINO = { amanha: 'ficou para amanhã (Retornado)', galpao: 'voltou ao galpão' } as const;

const dataLonga = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

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
