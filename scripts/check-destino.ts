/**
 * Compara a cópia da regra de destino (src/domain/destino) com o Street (../SafaSanha/src/domain).
 * Só LÊ os dois lados. Se divergirem, avisa: a regra deve ser atualizada a partir do Street.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const ARQUIVOS = ['texto.ts', 'endereco.ts', 'destino.ts', 'endereco.test.ts', 'logradouro.ts', 'logradouro.test.ts'];
const STREET = process.env.STREET_DIR ?? '../SafaSanha/src/domain';
const hash = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

if (!existsSync(STREET)) {
  console.log(`Pasta do Street não encontrada (${STREET}). Nada a comparar.`);
  process.exit(0);
}
let divergentes = 0;
for (const f of ARQUIVOS) {
  const igual = hash(`src/domain/destino/${f}`) === hash(`${STREET}/${f}`);
  if (!igual) divergentes++;
  console.log(`${igual ? 'igual     ' : 'DIVERGENTE'}  ${f}`);
}
if (divergentes) {
  console.log('\nA regra de destino do Street mudou. Copie os arquivos de novo e atualize ORIGEM.md.');
  process.exit(1);
}
console.log('\nHUB e Street usam a mesma regra de destino.');
