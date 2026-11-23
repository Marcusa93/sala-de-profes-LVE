-- ---------------------------------------------------------------------------
-- Control interno del Jefe de Operaciones (Joaquín) — Santa Fe
-- ---------------------------------------------------------------------------
-- Pasa a la app el tablero que Joaquín usaba en claude.ai: tareas del día, la
-- semana y el mes, diferencia de caja y pedidos de los socios. La 24 tiene su
-- propio control en su app: acá va solo Santa Fe.
--
-- Lo ven solo los de app_settings 'operaciones_acceso' (socios y Joaquín) y
-- carga los de 'editores' (Joaquín). Todas las tablas tienen RLS sin políticas:
-- nadie las lee ni escribe desde el navegador; la app pasa por
-- /api/operaciones, que controla quién entra.
-- ---------------------------------------------------------------------------

-- Tareas tildadas. periodo: 'd:2026-11-23' (día), 's:2026-W48' (semana ISO)
-- o 'm:2026-11' (mes). tarea: id del catálogo en lib/operaciones/tareas.ts.
create table if not exists public.operaciones_checks (
  periodo text not null check (periodo ~ '^(d:\d{4}-\d{2}-\d{2}|s:\d{4}-W\d{2}|m:\d{4}-\d{2})$'),
  tarea text not null check (char_length(tarea) between 1 and 10),
  hecho_por uuid references public.profiles(id),
  hecho_at timestamptz not null default now(),
  primary key (periodo, tarea)
);
alter table public.operaciones_checks enable row level security;
comment on table public.operaciones_checks is 'Control interno de operaciones: tareas diarias, semanales y mensuales tildadas';

-- Diferencia de caja de Santa Fe por día de cierre (0 = cerró bien).
create table if not exists public.operaciones_caja (
  fecha date primary key,
  diferencia numeric,
  motivo text check (motivo is null or char_length(motivo) <= 300),
  cargado_por uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.operaciones_caja enable row level security;
comment on table public.operaciones_caja is 'Control interno de operaciones: diferencia de caja de Santa Fe por día de cierre y su motivo';

-- Pedidos de los socios: qué pidieron, quién se encarga y cómo terminó.
create table if not exists public.pedidos_socios (
  id uuid primary key default gen_random_uuid(),
  que text not null check (char_length(que) between 1 and 200),
  pedido_por text not null check (char_length(pedido_por) between 1 and 40),
  -- null = lo hace Joaquín; si no, el nombre del encargado
  delegado_a text check (delegado_a is null or char_length(delegado_a) between 1 and 60),
  delegado_at timestamptz,
  vence date not null,
  compromiso date,
  respondido boolean not null default false,
  respondido_at timestamptz,
  estado text not null default 'abierto' check (estado in ('abierto', 'delegado', 'hecho')),
  resultado text check (resultado in ('cumplido', 'no_cumplido')),
  cerrado date,
  a_tiempo boolean,
  reprogramado integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pedidos_socios_estado_idx on public.pedidos_socios (estado, vence);
alter table public.pedidos_socios enable row level security;
comment on table public.pedidos_socios is 'Control interno de operaciones: pedidos de los socios al Jefe de Operaciones';

-- Historial de cada pedido: delegado, avance cada 48 h, verificado, reprogramado.
create table if not exists public.pedidos_socios_seguimiento (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos_socios(id) on delete cascade,
  texto text not null check (char_length(texto) between 1 and 200),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists pedidos_socios_seguimiento_pedido_idx on public.pedidos_socios_seguimiento (pedido_id, created_at);
alter table public.pedidos_socios_seguimiento enable row level security;
comment on table public.pedidos_socios_seguimiento is 'Control interno de operaciones: avance y cambios de cada pedido de socio';

-- Quién entra y quién carga. Bruno se busca por nombre (no hay su id en el código).
insert into public.app_settings (key, value)
select 'operaciones_acceso', jsonb_build_object(
  'user_ids', coalesce((
    select jsonb_agg(p.id order by p.first_name)
    from public.profiles p
    where p.id in ('b8f689ca-85ae-4120-8a02-521e378e8585', '66c1aab8-5f89-434e-8a38-0e8abdbd4848')
       or (p.first_name ilike 'bruno' and p.last_name ilike 'rossi' and p.role = 'socio' and p.is_active)
  ), '[]'::jsonb),
  'editores', jsonb_build_array('66c1aab8-5f89-434e-8a38-0e8abdbd4848'),
  'inicio', to_char((now() at time zone 'America/Argentina/Tucuman')::date, 'YYYY-MM-DD')
)
on conflict (key) do nothing;
