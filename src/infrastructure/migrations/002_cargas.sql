-- Cargas: o que cada ajudante leva para a rua (HUB → Street) e o histórico próprio da carga.

ALTER TABLE pacotes ADD COLUMN carga_id TEXT;

CREATE TABLE cargas (
  id            TEXT PRIMARY KEY,
  codigo        TEXT NOT NULL UNIQUE,
  ajudante_id   TEXT NOT NULL REFERENCES ajudantes(id),
  ajudante_nome TEXT NOT NULL,
  criada_em     TEXT NOT NULL,
  criada_por    TEXT NOT NULL
);

CREATE TABLE cargas_pacotes (
  carga_id  TEXT NOT NULL REFERENCES cargas(id),
  pacote_id TEXT NOT NULL REFERENCES pacotes(id),
  ordem     INTEGER NOT NULL,
  PRIMARY KEY (carga_id, pacote_id)
);

CREATE TABLE eventos_carga (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  id            TEXT NOT NULL UNIQUE,
  carga_id      TEXT NOT NULL REFERENCES cargas(id),
  tipo          TEXT NOT NULL,
  dados         TEXT NOT NULL,
  ator          TEXT NOT NULL,
  ocorrido_em   TEXT NOT NULL,
  registrado_em TEXT NOT NULL
);
CREATE INDEX eventos_carga_carga ON eventos_carga(carga_id, seq);

CREATE TRIGGER eventos_carga_sem_update BEFORE UPDATE ON eventos_carga
BEGIN SELECT RAISE(ABORT, 'eventos são append-only: UPDATE proibido'); END;
CREATE TRIGGER eventos_carga_sem_delete BEFORE DELETE ON eventos_carga
BEGIN SELECT RAISE(ABORT, 'eventos são append-only: DELETE proibido'); END;
