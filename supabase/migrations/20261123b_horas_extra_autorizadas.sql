-- ---------------------------------------------------------------------------
-- Horas de más autorizadas por el encargado (pedido de Marco, 23/11/2026)
-- ---------------------------------------------------------------------------
-- Quedarse después del fin del turno solo se paga si un encargado o socio lo
-- autoriza. Hasta ahora la única forma era corregir la salida en Equipo; si la
-- salida ya estaba bien fichada no se podía autorizar sin cambiar la hora.
-- Ahora el encargado toca "Autorizar" en Equipo (mientras sigue trabajando o
-- después de que salió) y queda quién y cuándo, para la liquidación y para
-- controlarlo con las cámaras. A Marco le llega un aviso cada vez.
-- ---------------------------------------------------------------------------

alter table public.attendance_logs add column if not exists extra_autorizada_por uuid references public.profiles(id);
alter table public.attendance_logs add column if not exists extra_autorizada_at timestamptz;

comment on column public.attendance_logs.extra_autorizada_por is
  'Encargado o socio que autorizó que se quede después del fin del turno (se paga hasta la salida)';
comment on column public.attendance_logs.extra_autorizada_at is
  'Cuándo se autorizaron las horas de más (null = no autorizadas, salvo salida corregida: clock_out_type edited)';
