-- V0.7 — CONTAS (login com PIN, aprovação pelo Hugo) e DUPLA (dois ajudantes numa carga).
-- Só acréscimos: migração aplicada nunca é editada (se faltar algo, vira a 011). Escrita UMA vez, completa.

-- Conta = quem entra no HUB ou no Street. Nasce PENDENTE (pedido feito pelo Street) e só o master aprova,
-- definindo o papel: AJUDANTE (só recebe rota e entrega), ADMIN (vê e opera o HUB) ou os dois.
CREATE TABLE contas (
  id                 TEXT PRIMARY KEY,
  usuario            TEXT NOT NULL,        -- minúsculo, sem acento nem espaço, sem o sufixo @logiscan.log
  nome               TEXT NOT NULL,
  telefone           TEXT,
  veiculo            TEXT,
  pin_hash           TEXT,                 -- scrypt$N$r$p$sal$hash; NULL = ainda sem PIN (master, antes do primeiro acesso)
  situacao           TEXT NOT NULL CHECK (situacao IN ('PENDENTE','APROVADA','RECUSADA')),
  papel              TEXT CHECK (papel IN ('AJUDANTE','ADMIN','ADMIN_AJUDANTE')), -- definido na aprovação
  master             INTEGER NOT NULL DEFAULT 0,
  ajudante_id        TEXT REFERENCES ajudantes(id),  -- perfil de ajudante ligado (papel com AJUDANTE)
  ativacao_hash      TEXT,                 -- sha256 do código de primeiro acesso (uso único)
  ativacao_expira_em TEXT,
  tentativas         INTEGER NOT NULL DEFAULT 0,
  bloqueada_ate      TEXT,
  criada_em          TEXT NOT NULL,
  decidida_em        TEXT,
  decidida_por       TEXT
);
CREATE UNIQUE INDEX contas_usuario ON contas(usuario);
CREATE UNIQUE INDEX contas_ajudante ON contas(ajudante_id) WHERE ajudante_id IS NOT NULL;

-- Sessões: só o HASH do token é guardado (o token em si nunca fica no banco).
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

-- Histórico das decisões sobre contas (append-only, como os eventos).
CREATE TABLE contas_historico (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL UNIQUE,
  conta_id    TEXT NOT NULL,
  tipo        TEXT NOT NULL,
  dados       TEXT NOT NULL,
  ator        TEXT NOT NULL,
  ocorrido_em TEXT NOT NULL
);
CREATE TRIGGER contas_historico_sem_update BEFORE UPDATE ON contas_historico
BEGIN SELECT RAISE(ABORT, 'histórico de contas é append-only: UPDATE proibido'); END;
CREATE TRIGGER contas_historico_sem_delete BEFORE DELETE ON contas_historico
BEGIN SELECT RAISE(ABORT, 'histórico de contas é append-only: DELETE proibido'); END;

-- Dupla: uma carga com DONO e PARCEIRO (a caixa continua com uma carga só).
ALTER TABLE cargas ADD COLUMN parceiro_id TEXT REFERENCES ajudantes(id);
ALTER TABLE cargas ADD COLUMN parceiro_nome TEXT;
CREATE INDEX cargas_parceiro ON cargas(parceiro_id);
