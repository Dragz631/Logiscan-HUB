/**
 * ENTRAR no HUB: usuário + PIN de 6 dígitos. Também tem o PRIMEIRO ACESSO da master: com o código de uso único
 * que veio junto da configuração, ela define o PIN dela. A tela só mostra e chama a API; regra nenhuma aqui.
 */
import { useState } from 'react';
import { api } from '../api';
import { ErroApi } from '../requisicao';
import { type SessaoWeb, gravarSessao } from '../sessao';
import { Aviso } from './comum';

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function mensagemDeErro(e: unknown): { tipo: 'erro' | 'info'; texto: string } {
  if (e instanceof ErroApi) {
    if (e.codigo === 'PIN_INVALIDO') return { tipo: 'erro', texto: 'Usuário ou PIN incorreto.' };
    if (e.codigo === 'BLOQUEADO') {
      const ate = typeof e.dados?.ate === 'string' ? ` até as ${hora(e.dados.ate)}` : '';
      return { tipo: 'erro', texto: `Muitas tentativas erradas. Tente de novo${ate || ' mais tarde'}.` };
    }
    if (e.codigo === 'CONTA_PENDENTE') return { tipo: 'info', texto: 'Seu PIN está certo, mas sua conta ainda espera a aprovação do Hugo.' };
    if (e.codigo === 'CONTA_RECUSADA') return { tipo: 'erro', texto: 'Sua conta não foi aprovada.' };
    if (e.codigo === 'CODIGO_INVALIDO') return { tipo: 'erro', texto: 'Código de primeiro acesso inválido ou vencido.' };
    return { tipo: 'erro', texto: e.message };
  }
  return { tipo: 'erro', texto: (e as Error).message };
}

export function Entrar({ onEntrou }: { onEntrou: (s: SessaoWeb) => void }) {
  const [primeiro, setPrimeiro] = useState(false);
  const [usuario, setUsuario] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [codigo, setCodigo] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'erro' | 'info' | 'ok'; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(u: string, p: string) {
    const r = await api.entrar(u, p);
    const s: SessaoWeb = { token: r.token, renovar: r.renovar, perfil: r.perfil };
    gravarSessao(s);
    onEntrou(s);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setMsg(null);
    try {
      if (primeiro) {
        if (pin !== pin2) {
          setMsg({ tipo: 'erro', texto: 'Os dois PINs não são iguais.' });
          return;
        }
        await api.primeiroAcesso(usuario, codigo, pin);
        await entrar(usuario, pin); // PIN definido: já entra
      } else {
        await entrar(usuario, pin);
      }
    } catch (err) {
      setMsg(mensagemDeErro(err));
    } finally {
      setEnviando(false);
    }
  }

  const pinCerto = /^\d{6}$/.test(pin);
  const pronto = usuario.trim() && pinCerto && (!primeiro || (codigo.trim() && pin2 === pin));
  return (
    <div className="entrar">
      <form className="entrar-cartao" onSubmit={enviar} aria-label={primeiro ? 'Primeiro acesso da conta master' : 'Entrar no HUB'}>
        <div className="marca">
          LOGISCAN <b>HUB</b>
          <small>{primeiro ? 'primeiro acesso da master' : 'entrar'}</small>
        </div>
        <label>
          Usuário
          <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" placeholder="usuario (ou usuario@logiscan.log)" />
        </label>
        {primeiro && (
          <label>
            Código de primeiro acesso
            <input value={codigo} onChange={(e) => setCodigo(e.target.value)} autoComplete="off" placeholder="o código de uso único" />
          </label>
        )}
        <label>
          {primeiro ? 'Novo PIN (6 dígitos)' : 'PIN (6 dígitos)'}
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            type="password"
            inputMode="numeric"
            autoComplete={primeiro ? 'new-password' : 'current-password'}
            placeholder="••••••"
          />
        </label>
        {primeiro && (
          <label>
            Repita o PIN
            <input
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              placeholder="••••••"
            />
          </label>
        )}
        {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
        <button type="submit" className="primario" disabled={!pronto || enviando}>
          {enviando ? 'Entrando…' : primeiro ? 'Definir PIN e entrar' : 'Entrar'}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            setPrimeiro(!primeiro);
            setMsg(null);
            setPin('');
            setPin2('');
          }}
        >
          {primeiro ? 'Voltar para entrar' : 'Primeiro acesso da master'}
        </button>
        <p className="fraco sem-margem">Contas novas são criadas pelo Street e aprovadas pelo Hugo.</p>
      </form>
    </div>
  );
}
