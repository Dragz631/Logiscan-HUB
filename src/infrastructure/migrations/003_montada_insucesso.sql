-- Carga MONTADA ≠ EM ROTA: o início da rota é uma ação própria, com horário próprio.
ALTER TABLE cargas ADD COLUMN rota_iniciada_em TEXT;
ALTER TABLE cargas ADD COLUMN rota_iniciada_por TEXT;

-- Cargas da V0.2 (a saída acontecia junto com a criação): a rota começou quando a carga foi criada.
UPDATE cargas SET rota_iniciada_em = criada_em, rota_iniciada_por = criada_por
WHERE EXISTS (SELECT 1 FROM eventos e WHERE e.tipo = 'SAIU_PARA_ROTA' AND json_extract(e.dados, '$.carga.id') = cargas.id);

-- Confirmação da entrega (≠ status) e motivo do insucesso, na projeção do pacote.
ALTER TABLE pacotes ADD COLUMN confirmacao_entrega TEXT;
ALTER TABLE pacotes ADD COLUMN motivo_insucesso TEXT;
