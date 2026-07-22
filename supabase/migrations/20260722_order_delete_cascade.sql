-- Borrado completo de pedidos Makabra.
--
-- Al eliminar una fila de public.pedidos, elimina automáticamente sus datos de:
--   - public.pedido_items (tabla operativa actual)
--   - public.pedido_ingresos
--   - public.articulos_de_pedido (tabla histórica, si todavía existe)
--
-- También limpia registros que hayan quedado huérfanos antes de esta migración.
-- Migración no destructiva e idempotente: puede ejecutarse más de una vez.

begin;

-- ---------------------------------------------------------------------------
-- 1. Limpieza preventiva de registros que ya quedaron huérfanos
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.pedido_items') is not null then
    execute $sql$
      delete from public.pedido_items as item
      where not exists (
        select 1
        from public.pedidos as pedido
        where pedido.order_id = item.pedido_order_id
      )
    $sql$;
  end if;

  if to_regclass('public.pedido_ingresos') is not null then
    execute $sql$
      delete from public.pedido_ingresos as ingreso
      where not exists (
        select 1
        from public.pedidos as pedido
        where pedido.order_id = ingreso.pedido_order_id
      )
    $sql$;
  end if;

  if to_regclass('public.articulos_de_pedido') is not null then
    -- Usa la primera columna de vínculo heredada que exista.
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'articulos_de_pedido'
        and column_name = 'pedido_id'
    ) then
      execute $sql$
        delete from public.articulos_de_pedido as articulo
        where articulo.pedido_id is not null
          and not exists (
            select 1
            from public.pedidos as pedido
            where pedido.id::text = articulo.pedido_id::text
          )
      $sql$;
    elsif exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'articulos_de_pedido'
        and column_name = 'pedido_order_id'
    ) then
      execute $sql$
        delete from public.articulos_de_pedido as articulo
        where articulo.pedido_order_id is not null
          and not exists (
            select 1
            from public.pedidos as pedido
            where pedido.order_id = articulo.pedido_order_id::text
          )
      $sql$;
    elsif exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'articulos_de_pedido'
        and column_name = 'order_id'
    ) then
      execute $sql$
        delete from public.articulos_de_pedido as articulo
        where articulo.order_id is not null
          and not exists (
            select 1
            from public.pedidos as pedido
            where pedido.order_id = articulo.order_id::text
          )
      $sql$;
    elsif exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'articulos_de_pedido'
        and column_name = 'codigo_pedido'
    ) then
      execute $sql$
        delete from public.articulos_de_pedido as articulo
        where articulo.codigo_pedido is not null
          and not exists (
            select 1
            from public.pedidos as pedido
            where coalesce(
              nullif(to_jsonb(pedido) ->> 'codigo_pedido', ''),
              pedido.order_id
            ) = articulo.codigo_pedido::text
          )
      $sql$;
    end if;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Claves foráneas con ON DELETE CASCADE para las tablas operativas nuevas
-- ---------------------------------------------------------------------------

do $$
declare
  current_constraint record;
begin
  if to_regclass('public.pedido_items') is not null then
    for current_constraint in
      select constraint_name.conname
      from pg_constraint as constraint_name
      where constraint_name.conrelid = 'public.pedido_items'::regclass
        and constraint_name.confrelid = 'public.pedidos'::regclass
        and constraint_name.contype = 'f'
    loop
      execute format(
        'alter table public.pedido_items drop constraint if exists %I',
        current_constraint.conname
      );
    end loop;

    execute 'alter table public.pedido_items drop constraint if exists pedido_items_pedido_order_fk';
    execute $sql$
      alter table public.pedido_items
      add constraint pedido_items_pedido_order_fk
      foreign key (pedido_order_id)
      references public.pedidos (order_id)
      on update cascade
      on delete cascade
    $sql$;
  end if;

  if to_regclass('public.pedido_ingresos') is not null then
    for current_constraint in
      select constraint_name.conname
      from pg_constraint as constraint_name
      where constraint_name.conrelid = 'public.pedido_ingresos'::regclass
        and constraint_name.confrelid = 'public.pedidos'::regclass
        and constraint_name.contype = 'f'
    loop
      execute format(
        'alter table public.pedido_ingresos drop constraint if exists %I',
        current_constraint.conname
      );
    end loop;

    execute 'alter table public.pedido_ingresos drop constraint if exists pedido_ingresos_pedido_order_fk';
    execute $sql$
      alter table public.pedido_ingresos
      add constraint pedido_ingresos_pedido_order_fk
      foreign key (pedido_order_id)
      references public.pedidos (order_id)
      on update cascade
      on delete cascade
    $sql$;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Compatibilidad con articulos_de_pedido y cualquier esquema heredado
-- ---------------------------------------------------------------------------

create or replace function public.makabra_delete_order_children()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_row jsonb := to_jsonb(old);
  deleted_order_id text := coalesce(
    nullif(old_row ->> 'order_id', ''),
    nullif(old_row ->> 'codigo_pedido', '')
  );
  deleted_codigo text := coalesce(
    nullif(old_row ->> 'codigo_pedido', ''),
    deleted_order_id
  );
begin
  -- Las claves foráneas ya cubren estas tablas, pero estas eliminaciones hacen
  -- que también funcione con instalaciones parcialmente antiguas.
  if to_regclass('public.pedido_items') is not null and deleted_order_id is not null then
    execute 'delete from public.pedido_items where pedido_order_id = $1'
      using deleted_order_id;
  end if;

  if to_regclass('public.pedido_ingresos') is not null and deleted_order_id is not null then
    execute 'delete from public.pedido_ingresos where pedido_order_id = $1'
      using deleted_order_id;
  end if;

  if to_regclass('public.articulos_de_pedido') is not null then
    -- Algunas versiones antiguas vinculaban por el id numérico del pedido.
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'articulos_de_pedido'
        and column_name = 'pedido_id'
    ) then
      execute 'delete from public.articulos_de_pedido where pedido_id::text = $1'
        using old.id::text;
    end if;

    -- Otras versiones usaban el identificador MK-... directamente.
    if deleted_order_id is not null and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'articulos_de_pedido'
        and column_name = 'pedido_order_id'
    ) then
      execute 'delete from public.articulos_de_pedido where pedido_order_id::text = $1'
        using deleted_order_id;
    end if;

    if deleted_order_id is not null and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'articulos_de_pedido'
        and column_name = 'order_id'
    ) then
      execute 'delete from public.articulos_de_pedido where order_id::text = $1'
        using deleted_order_id;
    end if;

    if deleted_codigo is not null and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'articulos_de_pedido'
        and column_name = 'codigo_pedido'
    ) then
      execute 'delete from public.articulos_de_pedido where codigo_pedido::text = $1'
        using deleted_codigo;
    end if;
  end if;

  return old;
end
$$;

drop trigger if exists makabra_delete_order_children_trigger on public.pedidos;
create trigger makabra_delete_order_children_trigger
before delete on public.pedidos
for each row
execute function public.makabra_delete_order_children();

commit;

notify pgrst, 'reload schema';
