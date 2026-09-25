import { useState } from 'react';
import { api } from '../api';
import { Aviso, useCarregar } from './comum';
import { BarraCapacidade, ROTULO_SITUACAO_PERFIL } from './Orquestrador';

/** Perfis operacionais. O perfil (não o aparelho) é quem recebe carga no Street. */
export function Ajudantes() {
  const dados = useCarregar(() => api.orquestrador(), []);
  const [form, setForm] = useState({ nome: '', veiculo: '', capacidade: '' });
  const [erro, setErro] = useState<string | null>(null);

  async function cadastrar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.criarPerfil({ nome: form.nome, veiculo: form.veiculo || null, capacidade: form.capacidade ? Number(form.capacidade) : null });
      setForm({ nome: '', veiculo: '', capacidade: '' });
      setErro(null);
      dados.recarregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  const perfis = dados.dados?.perfis ?? [];
  return (
    <section>
      <h1>Ajudantes</h1>
      <p className="fraco">Cada ajudante é um perfil operacional. O Street escolhe o perfil ativo; o aparelho não define quem é.</p>
      <form className="linha" onSubmit={cadastrar}>
        <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome do ajudante" />
        <input value={form.veiculo} onChange={(e) => setForm({ ...form, veiculo: e.target.value })} placeholder="Veículo (opcional)" />
        <input type="number" min={1} value={form.capacidade} onChange={(e) => setForm({ ...form, capacidade: e.target.value })} placeholder="Capacidade (pacotes)" />
        <button type="submit" className="primario" disabled={!form.nome.trim()}>Criar perfil</button>
      </form>
      {erro && <Aviso>{erro}</Aviso>}
      <div className="grade-perfis">
        {perfis.map((p) => (
          <a key={p.ajudante.id} className={`cartao card-link ${p.ajudante.ativo ? '' : 'travado'}`} href={`#/ajudantes/${p.ajudante.id}`}>
            <div className="linha-topo">
              <b>{p.ajudante.nome}</b>
              <span className="qtd">
                {p.pacotes}
                {p.ajudante.capacidade ? `/${p.ajudante.capacidade}` : ''}
              </span>
            </div>
            <div className="detalhe">
              <span className={`chip ${p.carga ? `perfil-${p.carga.situacao}` : ''}`}>
                {p.carga ? ROTULO_SITUACAO_PERFIL[p.carga.situacao] : p.ajudante.ativo ? 'Livre' : 'Inativo'}
              </span>
              {p.ajudante.veiculo && <span>{p.ajudante.veiculo}</span>}
              <span>{p.ruas} rua(s)</span>
              {p.carga && <span>{p.progresso}% concluído</span>}
            </div>
            <BarraCapacidade atual={p.pacotes} capacidade={p.ajudante.capacidade} />
          </a>
        ))}
        {dados.dados && perfis.length === 0 && <p className="fraco">Nenhum perfil cadastrado.</p>}
      </div>
    </section>
  );
}
