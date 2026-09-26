-- Região que o repasse trata como UMA rua (ex.: "Diversos" = ruas fora da área, repassadas juntas).
-- Migração separada: a 006 já pode ter sido aplicada em bancos reais — migração aplicada nunca é editada.
ALTER TABLE regioes ADD COLUMN repasse_unico INTEGER NOT NULL DEFAULT 0;
