-- LOGISCAN HUB — esquema inicial.
-- Três mundos separados: dados operacionais (pacotes, destinos, ajudantes, lotes),
-- histórico (eventos, append-only) e provas (metadados; o arquivo fica no armazém de provas).

CREATE TABLE lotes (
  id               TEXT PRIMARY KEY,
  arquivo          TEXT NOT NULL,
  sha256           TEXT NOT NULL,
  schema           TEXT NOT NULL,
  transportadora   TEXT NOT NULL,
  extractor_nome   TEXT NOT NULL,
  extractor_versao TEXT NOT NULL,
  gerado_em        TEXT NOT NULL,
  recebido_em      TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('PREVIA','CONFIRMADO','DESCARTADO')),
  confirmado_em    TEXT,
  confirmado_por   TEXT,
  documento        TEXT NOT NULL -- JSON original, íntegro
);
CREATE INDEX lotes_sha256 ON lotes(sha256);

CREATE TABLE itens_lote (
  lote_id              TEXT NOT NULL REFERENCES lotes(id),
  indice               INTEGER NOT NULL,
  codigo               TEXT NOT NULL,
  classe               TEXT NOT NULL,
  dados                TEXT NOT NULL,
  origem               TEXT NOT NULL,
  motivos              TEXT NOT NULL,
  diferencas           TEXT NOT NULL,
  pacote_existente_id  TEXT,
  decisao              TEXT CHECK (decisao IN ('manter_atual','aceitar_novo')),
  pacote_id            TEXT,
  PRIMARY KEY (lote_id, indice)
);

CREATE TABLE destinos (
  id             TEXT PRIMARY KEY, -- rua|número|contexto (mesma identidade do Street)
  rua_nome       TEXT NOT NULL,
  rua_chave      TEXT NOT NULL,
  numero_nome    TEXT NOT NULL,
  numero_chave   TEXT NOT NULL,
  contexto_chave TEXT NOT NULL,
  contexto_nome  TEXT,
  contexto_tipo  TEXT,
  criado_em      TEXT NOT NULL
);
CREATE INDEX destinos_numero ON destinos(rua_chave, numero_chave);

CREATE TABLE ajudantes (
  id        TEXT PRIMARY KEY,
  nome      TEXT NOT NULL,
  ativo     INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL
);

CREATE TABLE pacotes (
  id                  TEXT PRIMARY KEY,
  transportadora      TEXT NOT NULL,
  codigo              TEXT NOT NULL,
  destinatario        TEXT NOT NULL,
  rua                 TEXT NOT NULL,
  rua_detalhe         TEXT NOT NULL,
  numero              TEXT NOT NULL,
  complemento         TEXT NOT NULL,
  bairro              TEXT NOT NULL,
  cidade              TEXT NOT NULL,
  uf                  TEXT NOT NULL,
  cep                 TEXT NOT NULL,
  destino_id          TEXT REFERENCES destinos(id),
  destino_candidatos  TEXT NOT NULL,
  estado              TEXT NOT NULL,
  responsavel_id      TEXT REFERENCES ajudantes(id),
  pendencias          TEXT NOT NULL,
  origem_lote_id      TEXT NOT NULL,
  origem_arquivo      TEXT NOT NULL,
  origem_card         INTEGER,
  criado_em           TEXT NOT NULL,
  atualizado_em       TEXT NOT NULL,
  versao              INTEGER NOT NULL,
  UNIQUE (transportadora, codigo) -- identidade natural: nunca o mesmo pacote duas vezes
);
CREATE INDEX pacotes_responsavel ON pacotes(responsavel_id);
CREATE INDEX pacotes_destino ON pacotes(destino_id);

CREATE TABLE eventos (
  seq                INTEGER PRIMARY KEY AUTOINCREMENT, -- ordem de gravação
  id                 TEXT NOT NULL UNIQUE,
  pacote_id          TEXT NOT NULL,
  tipo               TEXT NOT NULL,
  dados              TEXT NOT NULL,
  ator               TEXT NOT NULL,
  origem             TEXT NOT NULL,
  ocorrido_em        TEXT NOT NULL,
  registrado_em      TEXT NOT NULL,
  chave_idempotencia TEXT NOT NULL UNIQUE
);
CREATE INDEX eventos_pacote ON eventos(pacote_id, seq);

-- Append-only garantido pelo banco: o passado não se reescreve.
CREATE TRIGGER eventos_sem_update BEFORE UPDATE ON eventos
BEGIN SELECT RAISE(ABORT, 'eventos são append-only: UPDATE proibido'); END;
CREATE TRIGGER eventos_sem_delete BEFORE DELETE ON eventos
BEGIN SELECT RAISE(ABORT, 'eventos são append-only: DELETE proibido'); END;

-- Provas (fotos): só metadados aqui; o conteúdo vive no armazém de provas (pasta, depois nuvem).
-- Sem uso na V0.1 — preparado para a Esteira de Baixas.
CREATE TABLE provas (
  id          TEXT PRIMARY KEY,
  pacote_id   TEXT NOT NULL REFERENCES pacotes(id),
  evento_id   TEXT REFERENCES eventos(id),
  tipo        TEXT NOT NULL CHECK (tipo IN ('FOTO_PACOTE','FOTO_LOCAL')),
  sha256      TEXT NOT NULL,
  mime        TEXT NOT NULL,
  tamanho     INTEGER NOT NULL,
  recebido_em TEXT NOT NULL
);
