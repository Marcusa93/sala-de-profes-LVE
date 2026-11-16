-- ---------------------------------------------------------------------------
-- Sistema de producción, punto 1: la lista de lo que se produce y sus mínimos
-- ---------------------------------------------------------------------------
-- Pedido de los socios (16/11): una lista de lo que produce la cocina de
-- Santa Fe, cada producto con su stock mínimo por separado para Santa Fe y
-- para la 24. Se carga en una sola pantalla (Producción → Lista y mínimos).
--   · Mínimo de Santa Fe: es el stock_items.min_qty que ya existe (el mismo
--     que usan el semáforo y los avisos de stock). No se duplica acá.
--   · Mínimo de la 24 y si el producto va a la 24: en esta tabla. A la 24 se
--     le manda su parte con PUT /api/envios/catalogo (la reemplaza entera).
-- Solo el servidor lee y escribe esta tabla (RLS sin políticas).
-- Solo agrega una tabla: sin ella la app funciona igual que antes.
-- ---------------------------------------------------------------------------

create table if not exists public.produccion_lista (
  stock_item_id uuid primary key references public.stock_items(id) on delete cascade,
  -- si la 24 lo cuenta al cierre y se le manda
  va_a_la_24 boolean not null default true,
  -- mínimo de la 24, en la unidad de Santa Fe (null: sin mínimo)
  minimo_24 numeric check (minimo_24 is null or minimo_24 >= 0),
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.produccion_lista enable row level security;
