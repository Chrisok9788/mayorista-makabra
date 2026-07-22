-- Artículos faltantes y cierre manual del armado.
-- Migración no destructiva: puede ejecutarse más de una vez.

begin;

alter table public.pedido_items
  add column if not exists faltante boolean not null default false,
  add column if not exists faltante_resuelto boolean not null default false,
  add column if not exists faltante_marcado_en timestamptz,
  add column if not exists faltante_resuelto_en timestamptz;

-- Un artículo no puede estar armado y faltante al mismo tiempo.
update public.pedido_items
   set armado = false
 where faltante = true
   and armado = true;

alter table public.pedido_items
  drop constraint if exists pedido_items_estado_exclusivo_check;

alter table public.pedido_items
  add constraint pedido_items_estado_exclusivo_check
  check (not (armado = true and faltante = true));

create index if not exists pedido_items_faltantes_pendientes_idx
  on public.pedido_items (faltante, faltante_resuelto, producto_id)
  where faltante = true and faltante_resuelto = false;

create index if not exists pedido_items_faltante_marcado_idx
  on public.pedido_items (faltante_marcado_en)
  where faltante = true;

grant select, insert, update, delete
on table public.pedido_items
  to service_role;

commit;

notify pgrst, 'reload schema';
