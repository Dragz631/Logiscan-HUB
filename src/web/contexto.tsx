/** Estado de navegação e do operador (só interface; nada de dado operacional aqui). */
import { createContext, useContext, useEffect, useState } from 'react';

/** Rota simples por hash (#/pacotes/123). */
export function useRota(): string[] {
  const ler = () => window.location.hash.replace(/^#\/?/, '').replace(/\?.*$/, '').split('/').filter(Boolean);
  const [partes, setPartes] = useState(ler);
  useEffect(() => {
    const f = () => setPartes(ler());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return partes;
}

export const ir = (caminho: string) => {
  window.location.hash = caminho;
};

/** Operador = quem está usando o HUB agora; vai como `ator` em cada evento. */
export const OperadorCtx = createContext<{ operador: string; exigir(): string | null }>({
  operador: '',
  exigir: () => null,
});
export const useOperador = () => useContext(OperadorCtx);
