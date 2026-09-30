import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OperadorCtx, useRota } from './contexto';
import './estilo.css';
import { Ajudantes } from './paginas/Ajudantes';
import { CargaPagina } from './paginas/Carga';
import { Cargas } from './paginas/Cargas';
import { Importar } from './paginas/Importar';
import { Inventario } from './paginas/Inventario';
import { LotePagina } from './paginas/Lote';
import { Orquestrador } from './paginas/Orquestrador';
import { PerfilPagina } from './paginas/Perfil';
import { Regioes } from './paginas/Regioes';
import { PacotePagina } from './paginas/Pacote';
import { Triagem } from './paginas/Triagem';
import { Dias } from './paginas/Dias';
import { NovoDia } from './paginas/NovoDia';

const CHAVE_OPERADOR = 'hub.operador';
const lerOperador = () => {
  try {
    return localStorage.getItem(CHAVE_OPERADOR) ?? '';
  } catch {
    return '';
  }
};

function App() {
  const rota = useRota();
  const [operador, setOperador] = useState(lerOperador);
  const salvar = (v: string) => {
    setOperador(v);
    try {
      localStorage.setItem(CHAVE_OPERADOR, v);
    } catch {
      /* preferência local; sem problema se falhar */
    }
  };
  const exigir = () => {
    if (operador.trim()) return operador.trim();
    alert('Informe quem está operando (campo "Operador", no menu) antes de registrar ações.');
    return null;
  };

  const [pagina, id] = rota;
  let conteudo;
  if (pagina === 'importar') conteudo = <Importar />;
  else if (pagina === 'importacoes' && id) conteudo = <LotePagina id={id} />;
  else if (pagina === 'pacotes' && id) conteudo = <PacotePagina id={id} />;
  else if (pagina === 'ajudantes' && id) conteudo = <PerfilPagina id={id} />;
  else if (pagina === 'ajudantes') conteudo = <Ajudantes />;
  else if (pagina === 'inventario') conteudo = <Inventario />;
  else if (pagina === 'regioes') conteudo = <Regioes />;
  else if (pagina === 'triagem') conteudo = <Triagem />;
  else if (pagina === 'novo-dia') conteudo = <NovoDia />;
  else if (pagina === 'dias') conteudo = <Dias />;
  else if (pagina === 'cargas' && id) conteudo = <CargaPagina id={id} />;
  else if (pagina === 'cargas') conteudo = <Cargas />;
  else conteudo = <Orquestrador />;

  const ativo = (p: string) => ((pagina ?? '') === p ? 'ativo' : '');
  return (
    <OperadorCtx.Provider value={{ operador, exigir }}>
      <div className="app">
        <aside className="lateral">
          <div className="marca">
            LOGISCAN <b>HUB</b>
            <small>orquestração</small>
          </div>
          <a href="#/importar" className="botao-novo">+ Importar lote</a>
          <nav>
            <span className="secao">Operação</span>
            <a href="#/" className={ativo('')}>Orquestrador de repasse</a>
            <a href="#/cargas" className={ativo('cargas')}>Cargas</a>
            <a href="#/dias" className={ativo('dias') || ativo('novo-dia')}>Dias</a>
            <a href="#/ajudantes" className={ativo('ajudantes')}>Ajudantes</a>
            <a href="#/regioes" className={ativo('regioes')}>Regiões</a>
            <span className="secao">Pacotes</span>
            <a href="#/importar" className={ativo('importar') || ativo('importacoes')}>Importar</a>
            <a href="#/triagem" className={ativo('triagem')}>Triagem (caixas)</a>
            <a href="#/inventario" className={ativo('inventario') || ativo('pacotes')}>Inventário</a>
          </nav>
          <label className="operador">
            Operador
            <input value={operador} onChange={(e) => salvar(e.target.value)} placeholder="seu nome" />
          </label>
        </aside>
        <main>{conteudo}</main>
      </div>
    </OperadorCtx.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
