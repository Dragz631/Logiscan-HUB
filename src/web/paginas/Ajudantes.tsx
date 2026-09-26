import { useState } from 'react';
import { api } from '../api';
import { Aviso, useCarregar } from './comum';
import { BarraProgresso, ROTULO_SITUACAO_PERFIL } from './Orquestrador';

/** Perfis operacionais. O perfil (não o aparelho) é quem recebe carga no Street. */
export function Ajudantes() {
  const dados = useCarregar(() => api.orquestrador(), []);
  const [form, setForm] = useState({ nome: '', veiculo: '' });
  const [erro, setErro] = useState<string | null>(null);

  async function cadastrar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.criarPerfil({ nome: form.nome, veiculo: form.veiculo || null });
      setForm({ nome: '', veiculo: '' });
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
        <button type="submit" className="primario" disabled={!form.nome.trim()}>Criar perfil</button>
      </form>
      {erro && <Aviso>{erro}</Aviso>}
      <div className="grade-perfis">
        {perfis.map((p) => (
          <a key={p.ajudante.id} className={`cartao card-link ${p.ajudante.ativo ? '' : 'travado'}`} href={`#/ajudantes/${p.ajudante.id}`}>
            <div className="linha-topo">
              <b>{p.ajudante.nome}</b>
              <span className="fraco">
                <b className="qtd">{p.pacotes}</b> pacotes · <b className="qtd">{p.ruas}</b> ruas
              </span>
            </div>
            <div className="detalhe">
              <span className={`chip ${p.carga ? `perfil-${p.carga.situacao}` : ''}`}>
                {p.carga ? ROTULO_SITUACAO_PERFIL[p.carga.situacao] : p.ajudante.ativo ? 'Sem carga' : 'Inativo'}
              </span>
              {p.ajudante.veiculo && <span>{p.ajudante.veiculo}</span>}
              {p.carga && <span>{p.progresso}% concluído</span>}
            </div>
            {p.pacotes > 0 && <BarraProgresso feitos={p.entregues + p.insucessos} total={p.pacotes} />}
          </a>
        ))}
        {dados.dados && perfis.length === 0 && <p className="fraco">Nenhum perfil cadastrado.</p>}
      </div>
    </section>
  );
}
