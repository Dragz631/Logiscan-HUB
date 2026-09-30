import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api';
import { OperadorCtx, SessaoCtx, useRota } from './contexto';
import './estilo.css';
import { Ajudantes } from './paginas/Ajudantes';
import { CargaPagina } from './paginas/Carga';
import { Cargas } from './paginas/Cargas';
import { Dias } from './paginas/Dias';
import { Entrar } from './paginas/Entrar';
import { Importar } from './paginas/Importar';
import { Inventario } from './paginas/Inventario';
import { LotePagina } from './paginas/Lote';
import { NovoDia } from './paginas/NovoDia';
import { Orquestrador } from './paginas/Orquestrador';
import { PacotePagina } from './paginas/Pacote';
import { PerfilPagina } from './paginas/Perfil';
import { Regioes } from './paginas/Regioes';
import { Triagem } from './paginas/Triagem';
import { ErroApi } from './requisicao';
import { type PerfilDaSessao, type SessaoWeb, limparSessao } from './sessao';

const CHAVE_OPERADOR = 'hub.operador';
const lerOperador = () => {
  try {
    return localStorage.getItem(CHAVE_OPERADOR) ?? '';
  } catch {
    return '';
  }
};

/** O HUB em si. Com login, o operador é a conta logada (não dá para digitar outro nome). */
function Painel({ perfil, onSair }: { perfil: PerfilDaSessao | null; onSair: () => void }) {
  const rota = useRota();
  const [digitado, setDigitado] = useState(lerOperador);
  const operador = perfil ? perfil.nome : digitado;
  const salvar = (v: string) => {
    setDigitado(v);
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
    <SessaoCtx.Provider value={{ perfil }}>
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
            {perfil ? (
              <div className="operador">
                <span>Conectado como</span>
                <b>{perfil.nome}</b>
                {perfil.master && <small>conta master</small>}
                <button type="button" onClick={onSair}>Sair</button>
              </div>
            ) : (
              <label className="operador">
                Operador
                <input value={digitado} onChange={(e) => salvar(e.target.value)} placeholder="seu nome" />
              </label>
            )}
          </aside>
          <main>{conteudo}</main>
        </div>
      </OperadorCtx.Provider>
    </SessaoCtx.Provider>
  );
}

type Situacao = 'carregando' | 'semLogin' | 'entrar' | 'logado';

function App() {
  const [situacao, setSituacao] = useState<Situacao>('carregando');
  const [perfil, setPerfil] = useState<PerfilDaSessao | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  useEffect(() => {
    api
      .eu()
      .then((r) => {
        if (r.semLogin) return setSituacao('semLogin');
        setPerfil(r.perfil);
        setSituacao('logado');
      })
      .catch((e: unknown) => {
        if (e instanceof ErroApi && (e.status === 401 || e.status === 403)) return setSituacao('entrar');
        setFalha((e as Error).message);
      });
    const vencida = () => {
      limparSessao();
      setPerfil(null);
      setSituacao('entrar');
    };
    window.addEventListener('hub:sessao-expirada', vencida);
    return () => window.removeEventListener('hub:sessao-expirada', vencida);
  }, []);

  const sair = () => {
    api.sair().catch(() => undefined);
    limparSessao();
    setPerfil(null);
    setSituacao('entrar');
  };

  if (falha) return <div className="entrar"><div className="entrar-cartao"><b>Sem conexão com o HUB</b><p className="fraco">{falha}</p></div></div>;
  if (situacao === 'carregando') return <div className="entrar"><p className="fraco">Carregando…</p></div>;
  if (situacao === 'entrar') {
    return (
      <Entrar
        onEntrou={(s: SessaoWeb) => {
          setPerfil(s.perfil);
          setSituacao('logado');
        }}
      />
    );
  }
  if (perfil && perfil.papel === 'AJUDANTE') {
    return (
      <div className="entrar">
        <div className="entrar-cartao">
          <b>Esta conta é de ajudante</b>
          <p className="fraco">Ela recebe a rota e registra as entregas no Street. As telas do HUB são só para ADMIN aprovado pelo Hugo.</p>
          <button type="button" onClick={sair}>Sair</button>
        </div>
      </div>
    );
  }
  return <Painel perfil={situacao === 'logado' ? perfil : null} onSair={sair} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
