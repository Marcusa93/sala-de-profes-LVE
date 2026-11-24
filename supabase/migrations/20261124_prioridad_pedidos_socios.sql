-- ---------------------------------------------------------------------------
-- Prioridad de los pedidos de los socios (control interno de operaciones)
-- ---------------------------------------------------------------------------
-- Cada pedido lleva prioridad alta, media o baja. La elige quien lo anota y la
-- cambian Joaquín o quien lo anotó. En el tablero la lista muestra primero lo
-- urgente y se filtra por prioridad. Los pedidos que ya estaban quedan en media.
--
-- Hasta correr esta migración la app sigue andando: los pedidos se anotan igual,
-- pero no se ve ni se cambia la prioridad.
-- ---------------------------------------------------------------------------

alter table public.pedidos_socios
  add column if not exists prioridad text not null default 'media'
  check (prioridad in ('alta', 'media', 'baja'));

comment on column public.pedidos_socios.prioridad is 'Prioridad del pedido: alta, media o baja. La elige quien lo anota; la cambian Joaquín o quien lo anotó';

-- Que la API de Supabase vea la columna nueva sin esperar
notify pgrst, 'reload schema';
