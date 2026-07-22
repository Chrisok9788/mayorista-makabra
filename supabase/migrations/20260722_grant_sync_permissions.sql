-- Permisos requeridos por los endpoints de sincronización de Makabra.
-- Ejecutar en el SQL Editor de Supabase con un usuario administrador.

grant usage on schema public to service_role;

grant select, insert, update, delete
on table public.clientes
 to service_role;

grant select, insert, update, delete
on table public.categorias
 to service_role;

grant select, insert, update, delete
on table public.subcategorias
 to service_role;

grant usage, select, update
on all sequences in schema public
 to service_role;

alter default privileges in schema public
grant usage, select, update on sequences to service_role;
