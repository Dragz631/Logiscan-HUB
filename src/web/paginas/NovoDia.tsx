/**
 * NOVO DIA — fechar o dia operacional.
 * O operador vê cada ajudante com as sobras dele (pendentes + insucessos) e escolhe, por ajudante, se elas
 * ficam para amanhã (voltam para a caixa como "Retornado") ou voltam ao galpão. Depois escolhe se o dia
 * entra no histórico de entregas ou fica só como memória (teste). Nenhuma regra aqui: a tela mostra e chama a API.
 */
import { useState } from 'react';
import type { Dia } from '../../domain/dias';
import { api, novaChave } from '../api';
import { useOperador } from '../contexto';
import { dataHora, diaCurto } from '../formato';
import { Aviso, useCarregar } from './comum';

type Destino = 'amanha' | 'galpao';

export function NovoDia() {
  const { exigir } = useOperador();
  const previa = useCarregar(() => api.previaNovoDia(), []);
  const [destinos, setDestinos] = useState<Record<string, Destino>>({});
  const [historico, setHistorico] = useState<boolean>(true);
  const [chave] = useState(novaChave); // a mesma chave em todos os cliques: fechar duas vezes não existe
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<Dia | null>(null);

  if (feito) {
    const t = feito.resumo.totais;
    return (
      <section>
        <h1>Dia encerrado</h1>
        <Aviso tipo="ok">
          <b>{diaCurto(feito.dataRef)}</b> encerrado: {t.cargas} carga(s) fechada(s), {t.entregues} entregue(s)
          {t.amanha > 0 && <>, <b>{t.amanha}</b> voltaram para as caixas como Retornado</>}
          {t.galpao > 0 && <>, <b>{t.galpao}</b> devolvidos ao galpão</>}
          {t.desfeitas > 0 && <>, {t.desfeitas} de carga montada voltaram às caixas</>}.{' '}
          {feito.historico ? 'Entrou no histórico de entregas.' : 'Só memória: o dia ficou marcado como TESTE e não conta no histórico de entregas.'}
        </Aviso>
        <p>
          <a href="#/" className="botao-sec">Ir para o repasse</a> <a href="#/dias" className="botao-sec">Ver os dias</a>
        </p>
      </section>
    );
  }

  const v = previa.dados;
  const emRota = v?.cargas.filter((c) => c.situacao === 'EM_ROTA') ?? [];
  const montadas = v?.cargas.filter((c) => c.situacao === 'MONTADA') ?? [];
  const comSobras = emRota.filter((c) => c.sobras > 0);
  const faltam = comSobras.filter((c) => !destinos[c.ajudante.id]);
  const escolhidas = comSobras.filter((c) => destinos[c.ajudante.id]);
  const amanha = escolhidas.filter((c) => destinos[c.ajudante.id] === 'amanha').reduce((n, c) => n + c.sobras, 0);
  const galpao = escolhidas.filter((c) => destinos[c.ajudante.id] === 'galpao').reduce((n, c) => n + c.sobras, 0);
  const todos = (d: Destino) => setDestinos(Object.fromEntries(comSobras.map((c) => [c.ajudante.id, d])));

  async function encerrar() {
    const ator = exigir();
    if (!ator || !v) return;
    const frase =
      `Encerrar o dia ${diaCurto(v.dataRef)}?\n\n` +
      `• ${emRota.length + montadas.length} carga(s) serão fechadas\n` +
      `• ${amanha} pacote(s) voltam para as caixas como Retornado\n` +
      `• ${galpao} pacote(s) saem para o galpão\n` +
      (v.totais.pacotesMontados ? `• ${v.totais.pacotesMontados} pacote(s) de carga montada voltam às caixas\n` : '') +
      `\n${historico ? 'O dia entra no histórico de entregas.' : 'Só memória: o dia fica marcado como TESTE.'}`;
    if (!confirm(frase)) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await api.encerrarDia(destinos, historico, ator, chave);
      setFeito(r.dia);
    } catch (e) {
      setErro(`Nada foi gravado: ${(e as Error).message}`);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="novo-dia">
      <h1>Novo dia</h1>
      <p className="fraco">
        Fecha as cargas abertas, guarda o dia no histórico e decide o que fazer com o que não foi entregue. A memória do HUB
        (caixas, ruas, pessoas) <b>nunca</b> é apagada.
      </p>
      {previa.erro && <Aviso>{previa.erro}</Aviso>}
      {erro && <Aviso>{erro}</Aviso>}
      {v && v.cargas.length === 0 && (
        <Aviso tipo="info">Não há nenhuma carga aberta para encerrar. <a href="#/">Voltar ao repasse</a></Aviso>
      )}

      {emRota.length > 0 && (
        <>
          <div className="linha-topo">
            <h2>O que sobrou, ajudante por ajudante</h2>
            {comSobras.length > 1 && (
              <span className="linha">
                <button type="button" onClick={() => todos('amanha')}>Todos ficam para amanhã</button>
                <button type="button" onClick={() => todos('galpao')}>Todos voltam ao galpão</button>
              </span>
            )}
          </div>
          <div className="lista-cards">
            {emRota.map((c) => (
              <div key={c.cargaId} className="card-unidade">
                <div className="topo">
                  <span className="info">
                    <b>{c.ajudante.nome}</b>
                    <span className="fraco">
                      {c.codigo} · {c.caixas.join(', ') || 'sem caixa'}
                    </span>
                  </span>
                  <span className="resumo-dia">
                    <span className="ok-txt"><b className="qtd">{c.entregues}</b> entregue(s)</span>
                    <span className={c.sobras ? 'alerta-txt' : 'fraco'}><b className="qtd">{c.sobras}</b> sobra(ram)</span>
                  </span>
                </div>
                {c.sobras === 0 ? (
                  <p className="fraco sem-margem">Nada sobrou: a carga só será fechada.</p>
                ) : (
                  <fieldset className="opcoes" aria-label={`O que fazer com as sobras de ${c.ajudante.nome}`}>
                    <label className={destinos[c.ajudante.id] === 'amanha' ? 'marcada' : ''}>
                      <input type="radio" name={`d-${c.ajudante.id}`} aria-label={`${c.ajudante.nome}: fica para amanhã`} checked={destinos[c.ajudante.id] === 'amanha'} onChange={() => setDestinos({ ...destinos, [c.ajudante.id]: 'amanha' })} />
                      <span><b>Fica para amanhã</b><small>volta para a caixa como <em>Retornado</em>, explícito que é do dia anterior</small></span>
                    </label>
                    <label className={destinos[c.ajudante.id] === 'galpao' ? 'marcada' : ''}>
                      <input type="radio" name={`d-${c.ajudante.id}`} aria-label={`${c.ajudante.nome}: devolver ao galpão`} checked={destinos[c.ajudante.id] === 'galpao'} onChange={() => setDestinos({ ...destinos, [c.ajudante.id]: 'galpao' })} />
                      <span><b>Devolver ao galpão</b><small>sai da operação; se o código chegar de novo num lote, reabre</small></span>
                    </label>
                  </fieldset>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {montadas.length > 0 && (
        <>
          <h2>Cargas montadas que não saíram</h2>
          <p className="fraco">Serão desfeitas: os pacotes voltam para as caixas, sem responsável.</p>
          <ul className="logradouros">
            {montadas.map((c) => (
              <li key={c.cargaId}><b>{c.ajudante.nome}</b> — {c.codigo}, {c.pacotes} pacote(s) ({c.caixas.join(', ')})</li>
            ))}
          </ul>
        </>
      )}

      {v && v.cargas.length > 0 && (
        <>
          <h2>Histórico do dia</h2>
          <fieldset className="opcoes" aria-label="Histórico do dia">
            <label className={historico ? 'marcada' : ''}>
              <input type="radio" name="hist" aria-label="Memória mais histórico de entregas" checked={historico} onChange={() => setHistorico(true)} />
              <span><b>Memória + histórico de entregas</b><small>dia de operação de verdade: entra na lista de Dias</small></span>
            </label>
            <label className={!historico ? 'marcada' : ''}>
              <input type="radio" name="hist" aria-label="Só memória (dia de teste)" checked={!historico} onChange={() => setHistorico(false)} />
              <span><b>Só memória</b><small>dia de teste: o HUB guarda o que aprendeu, mas o dia fica marcado como TESTE e não conta nas entregas</small></span>
            </label>
          </fieldset>
          <p className="fraco">
            Nada é apagado do banco em nenhuma das duas: o histórico é só de acréscimo. A diferença é como o dia aparece.
          </p>

          <div className="barra-acao">
            <span>
              {faltam.length > 0
                ? <>Falta escolher para: <b>{faltam.map((f) => f.ajudante.nome).join(', ')}</b></>
                : <>{emRota.length + montadas.length} carga(s) · <b>{amanha}</b> para as caixas · <b>{galpao}</b> para o galpão</>}
            </span>
            <button type="button" className="primario" disabled={faltam.length > 0 || enviando} onClick={encerrar}>
              {enviando ? 'Encerrando…' : 'Encerrar o dia'}
            </button>
          </div>
        </>
      )}
      <p className="fraco">Última atualização: {dataHora(new Date().toISOString())}</p>
    </section>
  );
}
