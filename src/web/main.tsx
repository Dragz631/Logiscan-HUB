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
import { PacotePagina } from './paginas/Pacote';

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
    alert('Informe quem está operando (canto superior direito) antes de registrar ações.');
    return null;
  };

  const [pagina, id] = rota;
  let conteudo;
  if (pagina === 'importar') conteudo = <Importar />;
  else if (pagina === 'importacoes' && id) conteudo = <LotePagina id={id} />;
  else if (pagina === 'pacotes' && id) conteudo = <PacotePagina id={id} />;
  else if (pagina === 'ajudantes') conteudo = <Ajudantes />;
  else if (pagina === 'cargas' && id) conteudo = <CargaPagina id={id} />;
  else if (pagina === 'cargas') conteudo = <Cargas />;
  else conteudo = <Inventario />;

  const ativo = (p: string) => ((pagina ?? '') === p ? 'ativo' : '');
  return (
    <OperadorCtx.Provider value={{ operador, exigir }}>
      <header className="topo">
        <div className="marca">
          LOGISCAN <b>HUB</b>
        </div>
        <nav>
          <a href="#/" className={ativo('')}>Inventário</a>
          <a href="#/importar" className={ativo('importar') || ativo('importacoes')}>Importar</a>
          <a href="#/cargas" className={ativo('cargas')}>Cargas</a>
          <a href="#/ajudantes" className={ativo('ajudantes')}>Ajudantes</a>
        </nav>
        <label className="operador">
          Operador
          <input value={operador} onChange={(e) => salvar(e.target.value)} placeholder="seu nome" />
        </label>
      </header>
      <main>{conteudo}</main>
    </OperadorCtx.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
