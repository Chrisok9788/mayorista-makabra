-- Asignación exclusiva de pedidos a trabajadores internos
alter table if exists public.pedidos
  add column if not exists asignado_usuario_id text,
  add column if not exists asignado_usuario text,
  add column if not exists asignado_nombre text,
  add column if not exists asignado_en timestamptz,
  add column if not exists completado_usuario_id text,
  add column if not exists completado_usuario text,
  add column if not exists completado_nombre text,
  add column if not exists completado_en timestamptz;

create index if not exists pedidos_asignado_usuario_id_idx
  on public.pedidos (asignado_usuario_id);

create index if not exists pedidos_completado_usuario_id_idx
  on public.pedidos (completado_usuario_id);
