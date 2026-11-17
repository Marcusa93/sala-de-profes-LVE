-- ---------------------------------------------------------------------------
-- Sistema de producción, etapa 2: el parte de cierre del encargado de producción
-- ---------------------------------------------------------------------------
-- Lo que Gastón manda hoy por WhatsApp, en la app: hora de entrada y salida
-- (obligatorias) y, por cada tarea (cajón de pollo, lomo, bondiola, nalga…),
-- los kilos que entraron, las porciones y kilos que salieron (y los kilos
-- cocidos si hay cocción), lo que volvió a materia prima y el desperdicio.
-- La app calcula el rendimiento contra su mínimo (pollo limpio 95 %, lomo en
-- porciones 65 %, vacío limpio 74 %, vacío cocido 64 %, milanesa 1,75 veces la
-- nalga) y, si da bajo, pide el motivo para cerrar.
-- Al cerrar, cada tarea con productos queda como una producción a confirmar
-- (production_orders 'pending_review', con el crudo real descontado, cada
-- salida y el desperdicio): la confirma la jefa de cocina, como «Lo hice».
--
-- Un parte por persona y por noche (fecha operativa, corte a las 06:00).
-- Las tareas van en jsonb (ver src/lib/produccion/parte.ts): el formato se
-- puede ajustar sin otra migración.
-- Solo el servidor lee y escribe esta tabla (RLS sin políticas).
-- Solo agrega una tabla: sin ella la app funciona igual que antes.
-- ---------------------------------------------------------------------------

create table if not exists public.partes_produccion (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  -- fecha operativa de la noche (lo de antes de las 06:00 es del día anterior)
  fecha date not null,
  estado text not null default 'borrador' check (estado in ('borrador', 'cerrado')),
  entrada_at timestamptz,
  salida_at timestamptz,
  nota text,
  tareas jsonb not null default '[]'::jsonb,
  -- al cerrar: rendimientos de cada tarea y producciones creadas
  resultado jsonb,
  -- se marca al empezar a cerrar: si el cierre se corta a la mitad, se retoma
  -- sin duplicar las producciones (cada tarea guarda la suya)
  cerrando_at timestamptz,
  cerrado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fecha)
);

create index if not exists partes_produccion_fecha_idx on public.partes_produccion (fecha desc);

alter table public.partes_produccion enable row level security;
