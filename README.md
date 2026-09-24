# LOGISCAN HUB

Memória operacional oficial dos pacotes: recebe o JSON dos extractors (contrato `logiscan.import/v0`),
vira o inventário da operação e registra tudo o que acontece com cada pacote.

**PACOTE ≠ DESTINO ≠ RECEBEDOR.**

## Rodar

```bash
npm install
npm run dev        # http://localhost:4100  (banco em dados/hub.db)
npm test           # testes (domínio + casos de uso + contrato real do JT-Extractor, se a pasta existir)
npm run lint       # checagem de tipos
npm run check:destino   # confere se a regra de destino ainda é igual à do Street
```

Requer Node 24+ (usa o SQLite embutido `node:sqlite`).

## Fluxo V0.1

1. **Importar**: escolher o JSON → o contrato é validado (se for inválido, nada é gravado).
2. **Prévia**: cada pacote é classificado:
   | Classe | Entra? |
   |---|---|
   | Pronto | sim |
   | Já no inventário (igual) | não, nada a fazer (reimportação é segura) |
   | Conflito (mesmo código, dados diferentes) | só depois da decisão humana: manter atual ou aceitar novo |
   | Revisão pendente no extractor | não: revisar no JT-Extractor e reimportar |
   | Sem código | não: sem identidade |
   | Repetido no arquivo (igual / divergente) | conta uma vez / não entra |
3. **Confirmar** → pacotes entram como `NAO_ATRIBUIDO`, com evento `IMPORTADO` (lote, arquivo, card).
4. **Inventário**: quantos entraram, quantos precisam de revisão, quantos sem responsável, quantos com cada ajudante.
5. **Entregar ao ajudante** (um ou vários) → `ATRIBUIDO` / `REATRIBUIDO` (responsabilidade transferida).
6. **Pacote**: status, com quem está, destino, origem e a linha do tempo.

## Arquitetura

```
src/contracts/       contrato logiscan.import/v0 (representação própria do HUB, Zod)
src/domain/          regras puras: estados, transições, eventos, classificação da importação
  destino/           cópia fiel da regra de destino do Street (ver ORIGEM.md; não editar aqui)
src/application/     casos de uso + portas (interfaces). Todo evento passa por registrarEvento()
src/infrastructure/  SQLite, armazém de provas em pasta, relógio, IDs
src/server/          API HTTP (Express) — fina, sem regra de negócio
src/web/             interface React — só exibe e chama a API
```

- **Histórico append-only**: tabela `eventos` com triggers que recusam UPDATE/DELETE. O estado do pacote
  é uma projeção reconstruível a partir dos eventos (`reconstruir()`).
- **Idempotência**: todo evento tem `chave_idempotencia` única — repetir a mesma ação (ou, no futuro,
  um retry do celular) não cria um segundo acontecimento.
- **Identidade**: `UNIQUE(transportadora, codigo)`. Mesmo endereço/nome/número nunca funde pacotes.
- **Provas (fotos)**: porta `ArmazemDeProvas` + pasta local endereçada por sha256 + tabela `provas`.
  Nada em localStorage. Sem uso na V0.1.

## Fora da V0.1 (arquitetura preparada)

Street (envio dos pacotes do ajudante e retorno de eventos), Esteira de Baixas (`PRONTO_PARA_BAIXA` só com
prova completa), fila/sincronizador, integração com transportadora, mapa, chat, dashboards.
