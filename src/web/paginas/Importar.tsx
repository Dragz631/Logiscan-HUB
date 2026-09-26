import { useState } from 'react';
import { ErroApi, TITULO_FALHA, type TipoFalha, api } from '../api';
import { ir } from '../contexto';
import { dataHora } from '../formato';
import { Aviso, useCarregar } from './comum';

const ROTULO_STATUS = { PREVIA: 'Prévia (não confirmado)', CONFIRMADO: 'Confirmado', DESCARTADO: 'Descartado' } as const;

export function Importar() {
  const lotes = useCarregar(() => api.lotes(), []);
  // Contrato (o arquivo) ≠ conexão (o HUB não respondeu) ≠ servidor (erro interno) ≠ pedido recusado.
  const [falha, setFalha] = useState<{ tipo: 'contrato'; erros: string[] } | { tipo: TipoFalha; mensagem: string } | null>(null);
  const [ultimo, setUltimo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function escolher(arquivo: File | undefined) {
    if (!arquivo) return;
    setFalha(null);
    setUltimo(arquivo);
    setEnviando(true);
    try {
      const r = await api.importar(arquivo.name, await arquivo.text());
      if (r.ok) ir(`/importacoes/${r.loteId}${r.jaRecebido ? '?jaRecebido' : ''}`);
      else setFalha({ tipo: 'contrato', erros: r.erros });
    } catch (e) {
      setFalha(e instanceof ErroApi ? { tipo: e.tipo, mensagem: e.message } : { tipo: 'servidor', mensagem: (e as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section>
      <h1>Importar pacotes</h1>
      <p className="fraco">
        Selecione o JSON gerado pelo extractor (contrato <code>logiscan.import/v0</code>). Nada entra no inventário
        antes de você revisar a prévia e confirmar.
      </p>
      <label className="upload">
        <input type="file" accept=".json,application/json" disabled={enviando} onChange={(e) => escolher(e.target.files?.[0])} />
        <span>{enviando ? 'Validando…' : 'Escolher arquivo JSON'}</span>
      </label>

      {falha?.tipo === 'contrato' && (
        <Aviso>
          <b>Arquivo recusado: não segue o contrato logiscan.import/v0.</b> Nada foi gravado.
          <ul>
            {falha.erros.slice(0, 20).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          {falha.erros.length > 20 && <p>… e mais {falha.erros.length - 20} erro(s).</p>}
        </Aviso>
      )}
      {falha && falha.tipo !== 'contrato' && (
        <Aviso>
          <b>{TITULO_FALHA[falha.tipo]}.</b> {falha.tipo === 'conexao' ? 'O arquivo não foi avaliado — o problema não é o JSON.' : 'Nada foi gravado.'}
          <p className="sem-margem">{falha.mensagem}</p>
          {ultimo && (
            <button type="button" onClick={() => escolher(ultimo)}>
              Tentar de novo
            </button>
          )}
        </Aviso>
      )}

      <h2>Importações recebidas</h2>
      <div className="tabela-rolagem">
        <table>
          <thead>
            <tr>
              <th>Arquivo</th>
              <th>Fonte</th>
              <th>Recebido</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {lotes.dados?.map((l) => (
              <tr key={l.id}>
                <td>
                  <a href={`#/importacoes/${l.id}`}>{l.arquivo}</a>
                </td>
                <td>
                  {l.transportadora} · {l.extractor.nome} {l.extractor.versao}
                </td>
                <td>{dataHora(l.recebidoEm)}</td>
                <td>
                  {ROTULO_STATUS[l.status]}
                  {l.confirmadoPor && <span className="fraco"> por {l.confirmadoPor}</span>}
                </td>
              </tr>
            ))}
            {lotes.dados?.length === 0 && (
              <tr>
                <td colSpan={4} className="fraco centro">Nenhuma importação ainda.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
