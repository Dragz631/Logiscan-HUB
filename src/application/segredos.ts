/**
 * Segredos: PIN com `scrypt` + sal (nunca em claro), tokens aleatórios (só o hash vai para o banco).
 * Só `node:crypto`, sem dependência nova.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const TAMANHO = 32;

export function hashPin(pin: string): string {
  const sal = randomBytes(16);
  const h = scryptSync(pin, sal, TAMANHO, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${h.toString('base64')}`;
}

export function conferirPin(pin: string, guardado: string | null): boolean {
  if (!guardado) return false;
  const [tipo, n, r, p, sal, hash] = guardado.split('$');
  if (tipo !== 'scrypt' || !sal || !hash) return false;
  const esperado = Buffer.from(hash, 'base64');
  const calculado = scryptSync(pin, Buffer.from(sal, 'base64'), esperado.length, { N: Number(n), r: Number(r), p: Number(p) });
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

let hashFalso: string | undefined;
/** Gasta o mesmo tempo de uma conferência de verdade (usuário inexistente não pode ser percebido pela demora). */
export function conferenciaFalsa(pin: string): void {
  hashFalso ??= hashPin('000000');
  conferirPin(pin, hashFalso);
}

/** Token opaco de 256 bits, para entregar ao cliente. */
export const novoToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
