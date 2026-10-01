import { useState } from 'react';
import type { ClasseItem } from '../../domain/importacao';
import { api } from '../api';
import { ir, useOperador } from '../contexto';
import { dataHora, enderecoCurto } from '../formato';
import { Aviso, Numero, useCarregar } from './comum';

/** Ordem de exibição: primeiro o que pede atenção. */
const GRUPOS: { classe: ClasseItem; titulo: string; tom: 'alerta' | 'ok' | 'neutro' }[] = [
  { classe: 'CONFLITO', titulo: 'Conflitos (decida)', tom: 'alerta' },
  { classe: 'REVISAO_EXTRACTOR', titulo: 'Revisar no extractor', tom: 'alerta' },
  { classe: 'SEM_CODIGO', titulo: 'Sem código', tom: 'alerta' },
  { classe: 'CONFLITO_NO_ARQUIVO', titulo: 'Repetidos divergentes', tom: 'alerta' },
  { classe: 'PRONTO', titulo: 'Novos, prontos para entrar', tom: 'ok' },
  { classe: 'REABRIR', titulo: 'Já estiveram aqui e voltam', tom: 'ok' },
  { classe: 'JA_EXISTE', titulo: 'Já no inventário', tom: 'neutro' },
  { classe: 'DUPLICADO_NO_ARQUIVO', titulo: 'Repetidos iguais', tom: 'neutro' },
];

export function LotePagina({ id }: { id: string }) {
  const { exigir } = useOperador();
  const lote = useCarregar(() => api.lote(id), [id]);
  const [aba, setAba] = useState<ClasseItem | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro' | 'info'; texto: string } | null>(
    window.location.hash.includes('jaRecebido') ? { tipo: 'info', texto: 'Este mesmo arquivo já tinha sido recebido: mostrando a importação existente.' } : null,
  );

  if (lote.erro) return <Aviso>{lote.erro}</Aviso>;
  const v = lote.dados;
  if (!v) return <p className="fraco">Carregando…</p>;

  const previa = v.lote.status === 'PREVIA';
  const atual = aba ?? GRUPOS.find((g) => v.resumo.porClasse[g.classe] > 0)?.classe ?? 'PRONTO';
  const itens = v.itens.filter((i) => i.classe === atual);

  async function decidir(indice: number, decisao: 'manter_atual' | 'aceitar_novo') {
    try {
      lote.setDados(await api.decidir(id, indice, decisao));
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    }
  }
  async function decidirTodos(decisao: 'manter_atual' | 'aceitar_novo') {
    for (const i of v!.itens.filter((x) => x.classe === 'CONFLITO' && !x.decisao)) await decidir(i.indice, decisao);
  }
  async function confirmar() {
    const ator = exigir();
    if (!ator) return;
    try {
      const r = await api.confirmar(id, ator);
      setMsg({ tipo: 'ok', texto: `Importação confirmada: ${r.criados} pacote(s) novo(s) no inventário${r.reabertos ? `, ${r.reabertos} devolvido(s) ao galpão reaberto(s)` : ''}, ${r.conflitosResolvidos} conflito(s) resolvido(s).` });
      lote.recarregar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    }
  }
  async function descartar() {
    if (!confirm('Descartar esta prévia? Nada dela entra no inventário.')) return;
    lote.setDados(await api.descartar(id));
  }

  return (
    <section>
      <p><a href="#/importar">← Importações</a></p>
      <h1>{v.lote.arquivo}</h1>
      <p className="fraco">
        {v.lote.transportadora} · {v.lote.extractor.nome} {v.lote.extractor.versao} · gerado {v.lote.geradoEm} · recebido {dataHora(v.lote.recebidoEm)}
        {v.lote.status === 'CONFIRMADO' && ` · confirmado ${dataHora(v.lote.confirmadoEm)} por ${v.lote.confirmadoPor}`}
        {v.lote.status === 'DESCARTADO' && ' · DESCARTADO'}
      </p>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}

      <div className="numeros">
        <Numero rotulo="pacotes no arquivo" valor={v.resumo.total} />
        {GRUPOS.filter((g) => v.resumo.porClasse[g.classe] > 0).map((g) => (
          <Numero
            key={g.classe}
            rotulo={g.titulo.toLowerCase()}
            valor={v.resumo.porClasse[g.classe]}
            tom={g.tom}
            ativo={atual === g.classe}
            onClick={() => setAba(g.classe)}
          />
        ))}
      </div>

      {previa && (
        <div className="barra-acao">
          <span>
            <b>{v.resumo.entram}</b> pacote(s) vão entrar no inventário
            {v.resumo.porClasse.REABRIR > 0 && (
              <> ({v.resumo.porClasse.PRONTO} novos + {v.resumo.porClasse.REABRIR} que voltam)</>
            )}
            .
            {v.resumo.conflitosSemDecisao > 0 && <> Falta decidir <b>{v.resumo.conflitosSemDecisao}</b> conflito(s).</>}
          </span>
          <button type="button" className="primario" disabled={v.resumo.conflitosSemDecisao > 0} onClick={confirmar}>
            Confirmar importação
          </button>
          <button type="button" onClick={descartar}>Descartar</button>
        </div>
      )}
      {previa && v.resumo.porClasse.REABRIR > 0 && (
        <Aviso tipo="info">
          <b>{v.resumo.porClasse.REABRIR}</b> pacote(s) deste arquivo <b>já estiveram no HUB</b>: o Novo dia os devolveu ao galpão
          e o mesmo código veio de novo. Eles <b>reabrem e entram de novo nas caixas</b>; não são pacotes novos nem repetidos.
        </Aviso>
      )}
      {previa && (v.resumo.porClasse.REVISAO_EXTRACTOR > 0 || v.resumo.porClasse.SEM_CODIGO > 0) && (
        <Aviso tipo="info">
          Pacotes com revisão aberta ou sem código <b>não entram</b>. Revise-os no JT-Extractor, gere o JSON de novo e
          importe: o que já entrou é reconhecido e não duplica.
        </Aviso>
      )}

      {atual === 'CONFLITO' && previa && v.resumo.conflitosSemDecisao > 1 && (
        <p>
          Para todos os pendentes: <button type="button" onClick={() => decidirTodos('manter_atual')}>Manter dados atuais</button>
        </p>
      )}

      <div className="tabela-rolagem">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Código</th>
              <th>Destinatário</th>
              <th>Endereço</th>
              <th>Origem</th>
              <th>{atual === 'CONFLITO' ? 'Diferença / decisão' : 'Motivo'}</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.indice}>
                <td className="fraco">{i.indice + 1}</td>
                <td>
                  {i.pacoteId || i.pacoteExistenteId ? (
                    <a className="codigo" href={`#/pacotes/${i.pacoteId ?? i.pacoteExistenteId}`}>{i.codigo}</a>
                  ) : (
                    <span className="codigo">{i.codigo || '(sem código)'}</span>
                  )}
                </td>
                <td>{i.dados.destinatario}</td>
                <td>{enderecoCurto(i.dados)}</td>
                <td className="fraco">
                  {i.origem.arquivo}
                  {i.origem.card !== null && ` · card ${i.origem.card + 1}`}
                </td>
                <td>
                  {i.classe === 'CONFLITO' ? (
                    <div className="conflito">
                      {i.diferencas.map((d) => (
                        <div key={d.campo}>
                          <b>{d.campo}</b>: <s>{d.atual || '(vazio)'}</s> → <ins>{d.novo || '(vazio)'}</ins>
                        </div>
                      ))}
                      {previa ? (
                        <div className="escolha">
                          <button type="button" className={i.decisao === 'manter_atual' ? 'escolhido' : ''} onClick={() => decidir(i.indice, 'manter_atual')}>
                            Manter atual
                          </button>
                          <button type="button" className={i.decisao === 'aceitar_novo' ? 'escolhido' : ''} onClick={() => decidir(i.indice, 'aceitar_novo')}>
                            Aceitar novo
                          </button>
                        </div>
                      ) : (
                        <div className="fraco">Decisão: {i.decisao === 'aceitar_novo' ? 'aceitou o novo' : 'manteve o atual'}</div>
                      )}
                    </div>
                  ) : (
                    <ul className="motivos">
                      {i.motivos.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                      {i.motivos.length === 0 && <li className="fraco">{i.rotulo}</li>}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {v.lote.status === 'CONFIRMADO' && <ResumoCaixas />}
      {v.lote.status === 'CONFIRMADO' && (
        <p>
          <button type="button" className="primario" onClick={() => ir('/triagem')}>Ir para a triagem</button>{' '}
          <button type="button" onClick={() => ir('/inventario')}>Ver inventário</button>
        </p>
      )}
    </section>
  );
}

/** Depois de importar: quanto o HUB já colocou sozinho nas caixas e quanto espera o Hugo na triagem. */
function ResumoCaixas() {
  const t = useCarregar(() => api.triagem(), []);
  if (!t.dados) return null;
  const { nasCaixas, aguardandoRevisao, semCaixa } = t.dados;
  return (
    <Aviso tipo={aguardandoRevisao ? 'info' : 'ok'}>
      <b>{nasCaixas}</b> pacote(s) já foram sozinhos para as caixas (o HUB lembrou pela pessoa ou pela rua).{' '}
      {aguardandoRevisao > 0 ? (
        <>
          <b>{aguardandoRevisao}</b> pacote(s), de {semCaixa.length} rua(s), esperam você dizer a caixa na <a href="#/triagem">triagem</a>.
        </>
      ) : (
        'Nada esperando revisão.'
      )}
    </Aviso>
  );
}
