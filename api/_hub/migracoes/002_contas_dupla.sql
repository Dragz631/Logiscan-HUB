-- V0.7 — CONTAS e DUPLA no Postgres (equivalente da migração 010 do SQLite). Escrita UMA vez, completa.

CREATE TABLE contas (
  id                 TEXT PRIMARY KEY,
  usuario            TEXT NOT NULL,
  nome               TEXT NOT NULL,
  telefone           TEXT,
  veiculo            TEXT,
  pin_hash           TEXT,
  situacao           TEXT NOT NULL CHECK (situacao IN ('PENDENTE','APROVADA','RECUSADA')),
  papel              TEXT CHECK (papel IN ('AJUDANTE','ADMIN','ADMIN_AJUDANTE')),
  master             INTEGER NOT NULL DEFAULT 0,
  ajudante_id        TEXT REFERENCES ajudantes(id),
  ativacao_hash      TEXT,
  ativacao_expira_em TEXT,
  tentativas         INTEGER NOT NULL DEFAULT 0,
  bloqueada_ate      TEXT,
  criada_em          TEXT NOT NULL,
  decidida_em        TEXT,
  decidida_por       TEXT
);
CREATE UNIQUE INDEX contas_usuario ON contas(usuario);
CREATE UNIQUE INDEX contas_ajudante ON contas(ajudante_id) WHERE ajudante_id IS NOT NULL;

CREATE TABLE sessoes (
  token_hash        TEXT PRIMARY KEY,
  renovar_hash      TEXT NOT NULL UNIQUE,
  conta_id          TEXT NOT NULL REFERENCES contas(id),
  criada_em         TEXT NOT NULL,
  expira_em         TEXT NOT NULL,
  renovar_expira_em TEXT NOT NULL,
  revogada_em       TEXT
);
CREATE INDEX sessoes_conta ON sessoes(conta_id);

CREATE TABLE contas_historico (
  seq         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id          TEXT NOT NULL UNIQUE,
  conta_id    TEXT NOT NULL,
  tipo        TEXT NOT NULL,
  dados       TEXT NOT NULL,
  ator        TEXT NOT NULL,
  ocorrido_em TEXT NOT NULL
);
CREATE TRIGGER contas_historico_sem_update BEFORE UPDATE ON contas_historico
  FOR EACH ROW EXECUTE FUNCTION proibir_alteracao('histórico de contas é append-only: UPDATE proibido');
CREATE TRIGGER contas_historico_sem_delete BEFORE DELETE ON contas_historico
  FOR EACH ROW EXECUTE FUNCTION proibir_alteracao('histórico de contas é append-only: DELETE proibido');

ALTER TABLE cargas ADD COLUMN parceiro_id TEXT REFERENCES ajudantes(id);
ALTER TABLE cargas ADD COLUMN parceiro_nome TEXT;
CREATE INDEX cargas_parceiro ON cargas(parceiro_id);

-- RLS ligada, sem nenhuma política: a API pública do Supabase não enxerga nada daqui.
ALTER TABLE contas ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE contas_historico ENABLE ROW LEVEL SECURITY;
