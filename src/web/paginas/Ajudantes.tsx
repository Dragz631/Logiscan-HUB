import { useState } from 'react';
import type { ResumoPerfil } from '../../application/orquestracao';
import { api } from '../api';
import { Aviso, useCarregar } from './comum';
import { BarraProgresso, ROTULO_SITUACAO_PERFIL } from './Orquestrador';

/**
 * Perfis operacionais. O perfil (não o aparelho) é quem recebe carga no Street.
 * Identidade = helper_id (o nome é só apresentação). ATIVO recebe repasse; INATIVO não.
 */
export function Ajudantes() {
  const dados = useCarregar(() => api.orquestrador(), []);
  const [form, setForm] = useState({ nome: '', veiculo: '' });
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  async function cadastrar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.criarPerfil({ nome: form.nome, veiculo: form.veiculo || null });
      setForm({ nome: '', veiculo: '' });
      setMsg(null);
      dados.recarregar();
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    }
  }

  async function alternarAtivo(p: ResumoPerfil) {
    const a = p.ajudante;
    try {
      await api.editarPerfil(a.id, { nome: a.nome, veiculo: a.veiculo, ativo: !a.ativo });
      setMsg({
        tipo: 'ok',
        texto: a.ativo ? `${a.nome} está INATIVO: não recebe repasse nem aparece no Street.` : `${a.nome} está ATIVO: pode receber repasse.`,
      });
      dados.recarregar();
    } catch (err) {
      setMsg({ tipo: 'erro', texto: `${a.nome} continua ${a.ativo ? 'ATIVO' : 'INATIVO'}: ${(err as Error).message}` });
    }
  }

  const perfis = dados.dados?.perfis ?? [];
  return (
    <section>
      <h1>Ajudantes</h1>
      <p className="fraco">
        Cada ajudante é um perfil operacional, identificado pelo seu ID (não pelo nome nem pelo aparelho). Só perfil
        <b> ATIVO</b> recebe repasse e aparece no Street.
      </p>
      <form className="linha" onSubmit={cadastrar}>
        <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome do ajudante" />
        <input value={form.veiculo} onChange={(e) => setForm({ ...form, veiculo: e.target.value })} placeholder="Veículo (opcional)" />
        <button type="submit" className="primario" disabled={!form.nome.trim()}>Criar perfil</button>
      </form>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      {dados.erro && <Aviso>{dados.erro}</Aviso>}
      <div className="grade-perfis">
        {perfis.map((p) => (
          <div key={p.ajudante.id} className={`cartao ${p.ajudante.ativo ? '' : 'travado'}`}>
            <div className="linha-topo">
              <a href={`#/ajudantes/${p.ajudante.id}`}><b>{p.ajudante.nome}</b></a>
              <span className={`chip ${p.ajudante.ativo ? 'chip-ativo' : 'chip-inativo'}`}>{p.ajudante.ativo ? 'ATIVO' : 'INATIVO'}</span>
            </div>
            <div className="detalhe">
              <span className="fraco">
                <b className="qtd">{p.pacotes}</b> pacotes · <b className="qtd">{p.ruas}</b> ruas
              </span>
              <span className={`chip ${p.carga ? `perfil-${p.carga.situacao}` : ''}`}>
                {p.carga ? `${ROTULO_SITUACAO_PERFIL[p.carga.situacao]} · ${p.carga.codigo}` : 'Sem carga'}
              </span>
              {p.carga && <span>{p.progresso}% concluído</span>}
            </div>
            {p.pacotes > 0 && <BarraProgresso feitos={p.entregues + p.insucessos} total={p.pacotes} />}
            <div className="detalhe">
              <span className="fraco" title="helper_id: identidade usada pelo Street">ID <code>{p.ajudante.id.slice(0, 8)}</code></span>
              <button type="button" onClick={() => alternarAtivo(p)}>{p.ajudante.ativo ? 'Desativar' : 'Ativar'}</button>
              <a href={`#/ajudantes/${p.ajudante.id}`}>perfil →</a>
            </div>
          </div>
        ))}
        {dados.dados && perfis.length === 0 && <p className="fraco">Nenhum perfil cadastrado.</p>}
      </div>
    </section>
  );
}
