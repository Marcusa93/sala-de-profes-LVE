-- ---------------------------------------------------------------------------
-- Reloj de los fichajes: cierra cada 15 minutos las salidas olvidadas.
-- Antes el cierre corría una vez por día (16:00): un fichaje olvidado quedaba
-- "abierto" hasta 16 horas mostrando horas de más.
-- Reusa el secreto cron_secret_protocolos de Vault (protocolos_reloj.sql).
-- ---------------------------------------------------------------------------

select cron.unschedule('fichajes-cierre') where exists (select 1 from cron.job where jobname = 'fichajes-cierre');
select cron.schedule(
  'fichajes-cierre',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := 'https://sala-de-profes-lve.vercel.app/api/cron/auto-clockout',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_protocolos')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- Comprobar (a los 15-30 minutos):
--   select status_code, created from net._http_response order by created desc limit 5;
