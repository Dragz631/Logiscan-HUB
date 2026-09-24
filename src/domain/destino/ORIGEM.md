# Origem da regra de destino

Estes arquivos são uma **cópia fiel** da regra de destino do LogiScan Street (SafaSanha),
para que HUB e Street usem **a mesma** definição de destino (rua + número + contexto).

- Repositório: `SafaSanha` (github.com/Dragz631/SafaSanha-main)
- Commit: `ac22565` (REDESIGN)
- Pasta de origem: `src/domain/`
- Copiado em: 2026-09-23

| Arquivo | sha256 |
|---|---|
| texto.ts | 9b9c5c37801ac90007d994e79a03bd6933cf86e8ecb44b0aa508bc6aac7eab52 |
| endereco.ts | 7cff53033ddc69d88f0c7c297eca070326f8553b7279d3f1250d84b0739c475b |
| destino.ts | 11f35af80948ef5ebd1015efb3eeff681aaaa94c36f0f013ebd9c11a9d096972 |
| endereco.test.ts | 380f8a823ca601fdc1293d9187d2a0e931af00ad74302af18aa433db86458dda |

## Regras

- **Não editar estes arquivos no HUB.** Mudança de regra de destino se faz no Street e é copiada de novo.
- `npm run check:destino` compara esta cópia com a pasta `../SafaSanha` (se existir) e avisa se divergiram.
- Futuro: extrair para um pacote compartilhado usado pelos dois projetos.
