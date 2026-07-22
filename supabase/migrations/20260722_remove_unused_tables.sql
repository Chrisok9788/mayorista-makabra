-- Tablas que Makabra no utiliza.
-- Ejecutar una vez desde el SQL Editor de Supabase.

begin;

-- La aplicación guarda el pedido principal en public.pedidos.
-- No usa una tabla separada de detalle.
drop table if exists public.detalle_pedidos cascade;

-- Las direcciones siguen viniendo de Google Sheets para armar el mensaje,
-- pero no se mantienen en una tabla independiente de Supabase.
drop table if exists public.direcciones_clientes cascade;

-- Compatibilidad con ambos nombres posibles de la tabla histórica.
drop table if exists public.precios_historicos cascade;
drop table if exists public."precios_históricos" cascade;

commit;

notify pgrst, 'reload schema';
