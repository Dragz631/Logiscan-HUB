import { type ReactNode, useCallback, useEffect, useState } from 'react';
import type { EstadoPacote } from '../../domain/pacote';
import { ROTULO_ESTADO } from '../formato';

/** Carrega dados da API e expõe `recarregar`. */
export function useCarregar<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recarregar = useCallback(() => {
    fn()
      .then((d) => {
        setDados(d);
        setErro(null);
      })
      .catch((e: Error) => setErro(e.message));
  }, deps);
  useEffect(recarregar, [recarregar]);
  return { dados, erro, recarregar, setDados };
}

export function Estado({ estado }: { estado: EstadoPacote }) {
  return <span className={`selo estado-${estado}`}>{ROTULO_ESTADO[estado]}</span>;
}

export function Numero({ rotulo, valor, tom, onClick, ativo }: {
  rotulo: string;
  valor: number;
  tom?: 'alerta' | 'ok' | 'neutro';
  onClick?: () => void;
  ativo?: boolean;
}) {
  return (
    <button type="button" className={`numero tom-${tom ?? 'neutro'} ${ativo ? 'ativo' : ''}`} onClick={onClick} disabled={!onClick}>
      <span className="valor">{valor}</span>
      <span className="rotulo">{rotulo}</span>
    </button>
  );
}

export function Aviso({ tipo = 'erro', children }: { tipo?: 'erro' | 'info' | 'ok'; children: ReactNode }) {
  return <div className={`aviso aviso-${tipo}`}>{children}</div>;
}
