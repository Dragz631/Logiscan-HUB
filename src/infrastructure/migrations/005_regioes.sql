-- Regiões operacionais (mapa interno do LogiScan) e a memória rua → região.
CREATE TABLE regioes (
  id         TEXT PRIMARY KEY,
  nome       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  criada_em  TEXT NOT NULL,
  criada_por TEXT NOT NULL
);

-- PK na rua: uma rua pertence a no máximo UMA região. regiao_id NULL = decidido "sem região".
CREATE TABLE regioes_ruas (
  rua_chave   TEXT PRIMARY KEY,
  rua_nome    TEXT NOT NULL,
  regiao_id   TEXT REFERENCES regioes(id),
  definida_em TEXT NOT NULL,
  definida_por TEXT NOT NULL
);

-- Histórico das decisões (append-only).
CREATE TABLE eventos_regiao (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL UNIQUE,
  rua_chave   TEXT NOT NULL,
  tipo        TEXT NOT NULL,
  dados       TEXT NOT NULL,
  ator        TEXT NOT NULL,
  ocorrido_em TEXT NOT NULL
);
CREATE TRIGGER eventos_regiao_sem_update BEFORE UPDATE ON eventos_regiao
BEGIN SELECT RAISE(ABORT, 'eventos são append-only: UPDATE proibido'); END;
CREATE TRIGGER eventos_regiao_sem_delete BEFORE DELETE ON eventos_regiao
BEGIN SELECT RAISE(ABORT, 'eventos são append-only: DELETE proibido'); END;
