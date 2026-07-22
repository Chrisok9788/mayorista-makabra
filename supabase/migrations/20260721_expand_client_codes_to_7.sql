-- Amplía los identificadores de clientes existentes de 5 a 7 cifras.
-- Mantiene los códigos reconocibles agregando "00" al final.

alter table if exists public.clientes
  drop constraint if exists clientes_codigo_formato;

alter table if exists public.clientes
  alter column codigo type varchar(7);

update public.clientes
set codigo = codigo || '00'
where codigo ~ '^[0-9]{5}$';

alter table if exists public.clientes
  add constraint clientes_codigo_formato
  check (codigo ~ '^[0-9]{7}$');

comment on table public.clientes is
  'Clientes identificados para reparto y validación mediante código de 7 dígitos.';
