import { useState } from 'react';
import { api } from '../api';
import { Aviso, useCarregar } from './comum';

export function Ajudantes() {
  const lista = useCarregar(() => api.ajudantes(), []);
  const resumo = useCarregar(() => api.resumo(), []);
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function cadastrar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.cadastrarAjudante(nome);
      setNome('');
      setErro(null);
      lista.recarregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }
  const qtd = (id: string) => resumo.dados?.porAjudante.find((a) => a.ajudante.id === id)?.quantidade ?? 0;

  return (
    <section>
      <h1>Ajudantes</h1>
      <form className="linha" onSubmit={cadastrar}>
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do ajudante" />
        <button type="submit" className="primario" disabled={!nome.trim()}>Cadastrar</button>
      </form>
      {erro && <Aviso>{erro}</Aviso>}
      <div className="tabela-rolagem">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Pacotes com ele agora</th>
            </tr>
          </thead>
          <tbody>
            {lista.dados?.map((a) => (
              <tr key={a.id}>
                <td>{a.nome}</td>
                <td>
                  {qtd(a.id) > 0 ? qtd(a.id) : <span className="fraco">0</span>}
                </td>
              </tr>
            ))}
            {lista.dados?.length === 0 && (
              <tr>
                <td colSpan={2} className="fraco centro">Nenhum ajudante cadastrado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
