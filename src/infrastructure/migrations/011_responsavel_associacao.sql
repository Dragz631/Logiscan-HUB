-- V0.7 — ASSOCIAÇÕES: quem recebe a lista na associação (o "A/C" que vai no cabeçalho da lista enviada às mulheres).
-- Só acréscimo: migração aplicada nunca é editada (se faltar algo, vira a 012). Escrita UMA vez, completa.
-- NULL = sem responsável informado (a lista sai sem a linha "A/C").
ALTER TABLE regioes ADD COLUMN responsavel TEXT;
