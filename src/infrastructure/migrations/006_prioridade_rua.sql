-- Especificidade da rua dentro da região (menor = mais específica). Dado configurável, não regra no código.
ALTER TABLE regioes_ruas ADD COLUMN prioridade INTEGER;
