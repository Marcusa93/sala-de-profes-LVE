-- ---------------------------------------------------------------------------
-- Tolva: recarga y descarte en cada pesaje (pedido de Joaquín, 27/11/2026)
-- ---------------------------------------------------------------------------
-- La tolva se pesa 4 veces por día (protocolo "Control de tolva"). En cada
-- pesaje se pide, desde el control anterior:
--   · recarga: cuánto café se cargó
--   · descarte: cuánto se tiró calibrando el molino o purgando
-- Con eso: café usado = peso anterior + recarga − peso actual, y el descarte
-- aparte, para el control de merma de café por día y por semana.
-- tolva_alerta: una caída que no cierra (ej. 146 g → 14 g en 3 minutos) y que
-- quien pesó confirmó igual.
--
-- Hasta correr esta migración la app sigue andando: los controles se cierran
-- igual, pero la recarga y el descarte no quedan guardados en la tarea.
-- ---------------------------------------------------------------------------

alter table public.protocolo_tareas
  add column if not exists tolva_recarga_gr numeric check (tolva_recarga_gr is null or tolva_recarga_gr >= 0),
  add column if not exists tolva_descarte_gr numeric check (tolva_descarte_gr is null or tolva_descarte_gr >= 0),
  add column if not exists tolva_alerta text;

comment on column public.protocolo_tareas.tolva_recarga_gr is 'Control de tolva: café cargado desde el control anterior (g)';
comment on column public.protocolo_tareas.tolva_descarte_gr is 'Control de tolva: café tirado calibrando o purgando desde el control anterior (g)';
comment on column public.protocolo_tareas.tolva_alerta is 'Control de tolva: caída que no cierra y que quien pesó confirmó';

-- Que la API de Supabase vea las columnas nuevas sin esperar
notify pgrst, 'reload schema';
