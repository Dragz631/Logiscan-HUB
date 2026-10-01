-- V0.7 — ASSOCIAÇÕES no Postgres (equivalente da migração 011 do SQLite): responsável ("A/C") da associação.
ALTER TABLE regioes ADD COLUMN responsavel TEXT;
