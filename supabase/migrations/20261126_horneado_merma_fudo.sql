-- ---------------------------------------------------------------------------
-- Horneado: lo que se tira o va al budín de pan se descuenta en Fudo (26/11/2026)
-- ---------------------------------------------------------------------------
-- Hasta ahora «Se tiraron» y «Al budín de pan» quedaban solo en Sala de Profes,
-- y en Fudo esas medialunas (o bollitos, o tortillas) seguían contadas como si
-- estuvieran. Ahora cada carga descuenta el insumo en Fudo como merma, y si se
-- borra la carga, lo descontado vuelve.
--
-- Esta columna marca qué cargas se descontaron, para saber qué devolver al
-- borrar. Hasta correr esta migración la app sigue como antes: se cargan igual,
-- pero no tocan Fudo.
-- ---------------------------------------------------------------------------

alter table public.horneado_registros
  add column if not exists descontado_en_fudo boolean not null default false;

comment on column public.horneado_registros.descontado_en_fudo is
  'La carga (se tiraron / al budín) se descontó del insumo en Fudo como merma; al borrarla se devuelve';

-- Que la API de Supabase vea la columna nueva sin esperar
notify pgrst, 'reload schema';
