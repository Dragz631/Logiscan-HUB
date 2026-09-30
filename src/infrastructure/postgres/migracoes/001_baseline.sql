-- LOGISCAN HUB — esquema-base do POSTGRES (Supabase). Consolida as migrações 001 a 009 do SQLite, que continuam
-- sendo a história do banco do PC. Daqui para a frente, toda mudança de esquema é uma migração NOVA nas duas
-- pastas (SQLite e Postgres); migração aplicada nunca é editada.
--
-- Mesmas tabelas e colunas do SQLite (datas e JSON como TEXT, 0/1 como INTEGER) para o mesmo código servir aos dois.
-- Segurança: RLS LIGADA EM TODAS as tabelas e NENHUMA política — nem `anon` nem `authenticated` leem ou escrevem
-- direto pela API do Supabase. Só o servidor do HUB (conexão do banco, nas variáveis da Vercel) acessa.

-- Append-only garantido pelo banco: o passado não se reescreve.
CREATE FUNCTION proibir_alteracao() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION '%', TG_ARGV[0];
END;
$$;

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
  documento        TEXT NOT NULL
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
  id             TEXT PRIMARY KEY,
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
  id              TEXT PRIMARY KEY,
  nome            TEXT NOT NULL,
  ativo           INTEGER NOT NULL DEFAULT 1,
  criado_em       TEXT NOT NULL,
  veiculo         TEXT,
  capacidade      INTEGER,
  street_visto_em TEXT
);

-- Caixas (regiões operacionais) e a memória rua → caixa.
CREATE TABLE regioes (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  criada_em     TEXT NOT NULL,
  criada_por    TEXT NOT NULL,
  repasse_unico INTEGER NOT NULL DEFAULT 0,
  numero        TEXT,
  ordem         DOUBLE PRECISION,
  pai_id        TEXT REFERENCES regioes(id)
);
CREATE UNIQUE INDEX regioes_nome_unico ON regioes (lower(nome)); -- = NOT NULL UNIQUE COLLATE NOCASE do SQLite

CREATE TABLE regioes_ruas (
  rua_chave    TEXT PRIMARY KEY,
  rua_nome     TEXT NOT NULL,
  regiao_id    TEXT REFERENCES regioes(id),
  definida_em  TEXT NOT NULL,
  definida_por TEXT NOT NULL,
  prioridade   INTEGER
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
  carga_id            TEXT,
  confirmacao_entrega TEXT,
  motivo_insucesso    TEXT,
  caixa_id            TEXT,
  retornado_de        TEXT,
  UNIQUE (transportadora, codigo)
);
CREATE INDEX pacotes_responsavel ON pacotes(responsavel_id);
CREATE INDEX pacotes_destino ON pacotes(destino_id);

CREATE TABLE eventos (
  seq                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
CREATE TRIGGER eventos_sem_update BEFORE UPDATE ON eventos
  FOR EACH ROW EXECUTE FUNCTION proibir_alteracao('eventos são append-only: UPDATE proibido');
CREATE TRIGGER eventos_sem_delete BEFORE DELETE ON eventos
  FOR EACH ROW EXECUTE FUNCTION proibir_alteracao('eventos são append-only: DELETE proibido');

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

CREATE TABLE cargas (
  id                TEXT PRIMARY KEY,
  codigo            TEXT NOT NULL UNIQUE,
  ajudante_id       TEXT NOT NULL REFERENCES ajudantes(id),
  ajudante_nome     TEXT NOT NULL,
  criada_em         TEXT NOT NULL,
  criada_por        TEXT NOT NULL,
  rota_iniciada_em  TEXT,
  rota_iniciada_por TEXT,
  finalizada_em     TEXT,
  finalizada_por    TEXT
);
CREATE INDEX cargas_ajudante ON cargas(ajudante_id);

CREATE TABLE cargas_pacotes (
  carga_id  TEXT NOT NULL REFERENCES cargas(id),
  pacote_id TEXT NOT NULL REFERENCES pacotes(id),
  ordem     INTEGER NOT NULL,
  PRIMARY KEY (carga_id, pacote_id)
);

CREATE TABLE eventos_carga (
  seq           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
  FOR EACH ROW EXECUTE FUNCTION proibir_alteracao('eventos são append-only: UPDATE proibido');
CREATE TRIGGER eventos_carga_sem_delete BEFORE DELETE ON eventos_carga
  FOR EACH ROW EXECUTE FUNCTION proibir_alteracao('eventos são append-only: DELETE proibido');

CREATE TABLE eventos_regiao (
  seq         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id          TEXT NOT NULL UNIQUE,
  rua_chave   TEXT NOT NULL,
  tipo        TEXT NOT NULL,
  dados       TEXT NOT NULL,
  ator        TEXT NOT NULL,
  ocorrido_em TEXT NOT NULL
);
CREATE TRIGGER eventos_regiao_sem_update BEFORE UPDATE ON eventos_regiao
  FOR EACH ROW EXECUTE FUNCTION proibir_alteracao('eventos são append-only: UPDATE proibido');
CREATE TRIGGER eventos_regiao_sem_delete BEFORE DELETE ON eventos_regiao
  FOR EACH ROW EXECUTE FUNCTION proibir_alteracao('eventos são append-only: DELETE proibido');

CREATE TABLE memoria_pessoas (
  chave        TEXT PRIMARY KEY,
  nome         TEXT NOT NULL,
  rua_id       TEXT NOT NULL,
  rua_nome     TEXT NOT NULL,
  cep          TEXT NOT NULL,
  caixa_id     TEXT NOT NULL REFERENCES regioes(id),
  definida_em  TEXT NOT NULL,
  definida_por TEXT NOT NULL
);

CREATE TABLE eventos_pessoa (
  seq         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id          TEXT NOT NULL UNIQUE,
  chave       TEXT NOT NULL,
  tipo        TEXT NOT NULL,
  dados       TEXT NOT NULL,
  ator        TEXT NOT NULL,
  ocorrido_em TEXT NOT NULL
);
CREATE TRIGGER eventos_pessoa_sem_update BEFORE UPDATE ON eventos_pessoa
  FOR EACH ROW EXECUTE FUNCTION proibir_alteracao('eventos são append-only: UPDATE proibido');
CREATE TRIGGER eventos_pessoa_sem_delete BEFORE DELETE ON eventos_pessoa
  FOR EACH ROW EXECUTE FUNCTION proibir_alteracao('eventos são append-only: DELETE proibido');

CREATE TABLE dias (
  id                 TEXT PRIMARY KEY,
  data_ref           TEXT NOT NULL,
  encerrado_em       TEXT NOT NULL,
  encerrado_por      TEXT NOT NULL,
  historico          INTEGER NOT NULL,
  resumo             TEXT NOT NULL,
  chave_idempotencia TEXT NOT NULL UNIQUE
);
CREATE INDEX dias_data ON dias(data_ref);
CREATE TRIGGER dias_sem_update BEFORE UPDATE ON dias
  FOR EACH ROW EXECUTE FUNCTION proibir_alteracao('dias encerrados são append-only: UPDATE proibido');
CREATE TRIGGER dias_sem_delete BEFORE DELETE ON dias
  FOR EACH ROW EXECUTE FUNCTION proibir_alteracao('dias encerrados são append-only: DELETE proibido');

-- RLS ligada em tudo, sem nenhuma política: acesso direto pela API pública do Supabase fica negado.
ALTER TABLE lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE itens_lote ENABLE ROW LEVEL SECURITY;
ALTER TABLE destinos ENABLE ROW LEVEL SECURITY;
ALTER TABLE ajudantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE regioes ENABLE ROW LEVEL SECURITY;
ALTER TABLE regioes_ruas ENABLE ROW LEVEL SECURITY;
ALTER TABLE pacotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE provas ENABLE ROW LEVEL SECURITY;
ALTER TABLE cargas ENABLE ROW LEVEL SECURITY;
ALTER TABLE cargas_pacotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos_carga ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos_regiao ENABLE ROW LEVEL SECURITY;
ALTER TABLE memoria_pessoas ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos_pessoa ENABLE ROW LEVEL SECURITY;
ALTER TABLE dias ENABLE ROW LEVEL SECURITY;
