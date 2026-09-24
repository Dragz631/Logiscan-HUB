/**
 * Armazém de provas em pasta local, endereçado por conteúdo (nome do arquivo = sha256).
 * Separado do banco e do estado da UI (nada de localStorage). Sem uso na V0.1.
 * Futuro: trocar por storage em nuvem implementando a mesma porta.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArmazemDeProvas } from '../application/portas';

export function criarArmazemDeProvasFs(pasta: string): ArmazemDeProvas {
  const caminho = (sha: string) => join(pasta, sha.slice(0, 2), sha);
  return {
    async guardar(conteudo) {
      const sha256 = createHash('sha256').update(conteudo).digest('hex');
      await mkdir(join(pasta, sha256.slice(0, 2)), { recursive: true });
      await writeFile(caminho(sha256), conteudo, { flag: 'w' }); // mesmo conteúdo = mesmo arquivo (idempotente)
      return { sha256, tamanho: conteudo.byteLength };
    },
    async ler(sha256) {
      if (!/^[0-9a-f]{64}$/.test(sha256)) return undefined;
      try {
        return new Uint8Array(await readFile(caminho(sha256)));
      } catch {
        return undefined;
      }
    },
  };
}
