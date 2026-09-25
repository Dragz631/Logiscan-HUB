-- Perfil operacional do ajudante (o perfil define o ajudante; o aparelho não).
ALTER TABLE ajudantes ADD COLUMN veiculo TEXT;
ALTER TABLE ajudantes ADD COLUMN capacidade INTEGER;

-- Finalizar a rota é uma ação explícita: só então a carga deixa de ser ativa.
ALTER TABLE cargas ADD COLUMN finalizada_em TEXT;
ALTER TABLE cargas ADD COLUMN finalizada_por TEXT;
CREATE INDEX cargas_ajudante ON cargas(ajudante_id);
