-- V0.5 — CAIXAS (a mesa de triagem): as regiões viram as caixas oficiais do Hugo, com número e agrupamento,
-- e a memória por PESSOA (nome + rua → caixa). Só acréscimos: migração aplicada nunca é editada.

-- Caixa = região operacional. numero "1", "1.2", "10.1"…; ordem para listar; pai_id = caixa que agrupa (Associações).
ALTER TABLE regioes ADD COLUMN numero TEXT;
ALTER TABLE regioes ADD COLUMN ordem REAL;
ALTER TABLE regioes ADD COLUMN pai_id TEXT REFERENCES regioes(id);

-- Caixa decidida À MÃO para o pacote (evento CAIXA_DEFINIDA). NULL = a caixa vem da memória na hora.
ALTER TABLE pacotes ADD COLUMN caixa_id TEXT;

-- Memória por pessoa: a mesma pessoa (nome) na mesma rua (street_id) vai sempre para a mesma caixa.
CREATE TABLE memoria_pessoas (
  chave        TEXT PRIMARY KEY,       -- nome normalizado | rua_id
  nome         TEXT NOT NULL,
  rua_id       TEXT NOT NULL,
  rua_nome     TEXT NOT NULL,
  cep          TEXT NOT NULL,
  caixa_id     TEXT NOT NULL REFERENCES regioes(id),
  definida_em  TEXT NOT NULL,
  definida_por TEXT NOT NULL
);

CREATE TABLE eventos_pessoa (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL UNIQUE,
  chave       TEXT NOT NULL,
  tipo        TEXT NOT NULL,
  dados       TEXT NOT NULL,
  ator        TEXT NOT NULL,
  ocorrido_em TEXT NOT NULL
);
CREATE TRIGGER eventos_pessoa_sem_update BEFORE UPDATE ON eventos_pessoa
BEGIN SELECT RAISE(ABORT, 'eventos são append-only: UPDATE proibido'); END;
CREATE TRIGGER eventos_pessoa_sem_delete BEFORE DELETE ON eventos_pessoa
BEGIN SELECT RAISE(ABORT, 'eventos são append-only: DELETE proibido'); END;
