-- V0.6 — NOVO DIA: fechar o dia operacional, pacotes "Retornado" do dia anterior e o "visto" do Street.
-- Só acréscimos: migração aplicada nunca é editada (se faltar algo, vira a 010).

-- Pacote que voltou para a caixa ao fim do dia: JSON { dia, carga, ajudante } — a etiqueta "Retornado · do dia 26/09".
-- NULL = não é retornado. Projeção derivada dos eventos (DIA_ENCERRADO); limpa quando volta a ser repassado.
ALTER TABLE pacotes ADD COLUMN retornado_de TEXT;

-- Último contato do Street deste perfil com o HUB (HTTP local hoje, nuvem depois). NULL = nunca conectou.
ALTER TABLE ajudantes ADD COLUMN street_visto_em TEXT;

-- Dias encerrados (histórico). Append-only, como os eventos: o passado não se reescreve.
CREATE TABLE dias (
  id                 TEXT PRIMARY KEY,
  data_ref           TEXT NOT NULL,     -- AAAA-MM-DD (São Paulo) do dia encerrado
  encerrado_em       TEXT NOT NULL,
  encerrado_por      TEXT NOT NULL,
  historico          INTEGER NOT NULL,  -- 1 = memória + histórico de entregas; 0 = só memória (dia de TESTE)
  resumo             TEXT NOT NULL,     -- JSON: cargas, destinos escolhidos e totais
  chave_idempotencia TEXT NOT NULL UNIQUE
);
CREATE INDEX dias_data ON dias(data_ref);
CREATE TRIGGER dias_sem_update BEFORE UPDATE ON dias
BEGIN SELECT RAISE(ABORT, 'dias encerrados são append-only: UPDATE proibido'); END;
CREATE TRIGGER dias_sem_delete BEFORE DELETE ON dias
BEGIN SELECT RAISE(ABORT, 'dias encerrados são append-only: DELETE proibido'); END;
