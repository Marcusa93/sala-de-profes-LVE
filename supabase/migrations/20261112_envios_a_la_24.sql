-- ---------------------------------------------------------------------------
-- Envíos de producción de Santa Fe a la 24 (aprobado por Joaquín el 12/11/2026)
-- ---------------------------------------------------------------------------
-- La cocina de Santa Fe manda producción a la 24. Cada envío se guarda acá con
-- su propio id, se le manda a la 24 (POST /api/envios/entrantes con la clave
-- compartida ENVIOS_CLAVE) y, solo si la 24 lo aceptó, baja el stock de
-- Santa Fe como MOVIMIENTO (delta sobre Fudo, motivo 'out').
--   pendiente_envio → la 24 no respondió: el pulso lo reintenta solo
--   en_camino       → la 24 lo tiene; el pulso le pregunta si llegó
--   recibido        → la 24 tocó «Llegó» (con lo que llegó de cada cosa)
--   anulado         → se anuló antes de llegar (el stock vuelve) o la 24 lo rechazó
-- Solo el servidor lee y escribe estas tablas (RLS sin políticas).
-- ---------------------------------------------------------------------------

create table if not exists public.envios_salientes (
  id uuid primary key default gen_random_uuid(),
  estado text not null default 'pendiente_envio'
    check (estado in ('pendiente_envio', 'en_camino', 'recibido', 'anulado')),
  creado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  nota text,
  -- cuándo la 24 lo aceptó
  enviado_at timestamptz,
  -- marca de que ya se bajó el stock de Santa Fe: nunca se descuenta dos veces
  stock_descontado_at timestamptz,
  recibido_at timestamptz,
  -- nombre de quien lo recibió en la 24 (texto: es un usuario de la otra app)
  recibido_por text,
  nota_recepcion text,
  anulado_at timestamptz,
  ultimo_error text
);

create index if not exists envios_salientes_estado_idx on public.envios_salientes (estado, created_at desc);

create table if not exists public.envios_salientes_items (
  id uuid primary key default gen_random_uuid(),
  envio_id uuid not null references public.envios_salientes(id) on delete cascade,
  stock_item_id uuid references public.stock_items(id) on delete set null,
  -- el producto como salió de Santa Fe (queda aunque después lo renombren)
  nombre text not null,
  unidad text not null,
  cantidad numeric not null check (cantidad > 0),
  -- costo unitario real en Santa Fe al momento del envío (null si no es confiable)
  costo_unitario numeric check (costo_unitario is null or costo_unitario > 0),
  -- lo que la 24 dijo que llegó, en la unidad de la 24
  cantidad_recibida numeric check (cantidad_recibida is null or cantidad_recibida >= 0),
  unidad_recibida text,
  -- el insumo de la 24 donde entró
  producto_24 text,
  created_at timestamptz not null default now(),
  unique (envio_id, stock_item_id)
);

create index if not exists envios_salientes_items_envio_idx on public.envios_salientes_items (envio_id);

alter table public.envios_salientes enable row level security;
alter table public.envios_salientes_items enable row level security;
