# Santa Fe en la VPS (mudanza desde Vercel)

Santa Fe corría en Vercel (`https://sala-de-profes-lve.vercel.app`) hasta que Vercel la frenó
(24/11/2026, `402 DEPLOYMENT_DISABLED`). Se muda a la VPS del equipo, igual que la 24
(`https://lve24.com.ar`, desde el 19/10; ver la sección 10 de `PENDIENTES-SUCURSAL-24.md` en
ese repo). **La base sigue en Supabase y no se toca.** Solo se muda la app Next.js (pantallas y API).

| | |
|---|---|
| Servidor | `root@2.25.185.242` (Ubuntu 24.04, 1 núcleo, 3,8 GB). **Compartido** con ~18 servicios |
| Usuario / código | `salaprofeslve` (sin shell) · `/home/salaprofeslve/sala-de-profes-LVE` (clon de `main`) |
| Variables | `/etc/salaprofeslve/app.env` (640 root:salaprofeslve) · `dist.env` (carpeta activa) · `cron.curlrc` (600 root) |
| Servicio | `salaprofeslve.service` → `next start -H 127.0.0.1 -p 3150` · Nice=10 · MemoryMax=1G · Restart=always |
| Caddy | `/etc/caddy/salaprofeslve.caddy`, importado al final de `/etc/caddy/Caddyfile` |
| Dirección de prueba | `https://salaprofeslve.2-25-185-242.sslip.io` (hasta tener dominio) |
| Crons | `/etc/cron.d/salaprofeslve` → `127.0.0.1:3150` · log `/var/log/salaprofeslve-cron.log` (recién en la fase 3) |
| Deploy | `bash scripts/deploy-vps.sh` (reemplaza al push a Vercel) |

## Reglas de la VPS compartida

- Solo se crea lo de Santa Fe. **No tocar** ningún otro usuario, servicio, carpeta ni bloque de Caddy.
- `/home/botlve/sala-de-profes-LVE` es la copia del bot de Telegram (`claude-tg-lve`): **no es la app** y no se toca.
- Caddy sirve todos los sitios. Antes de cambiarlo, respaldo; después `caddy validate`; recién ahí
  `systemctl reload caddy` (**nunca restart**). Si `validate` falla, no se recarga: un Caddyfile roto tira todos los sitios.
- **Nunca dos `next build` a la vez** (1 núcleo, poca RAM). El script compila dentro de
  `flock /var/lock/next-build.lock`, el mismo candado que usa la 24.

## Armado (fase 1, en paralelo: Vercel sigue igual)

1. **Usuario y carpeta de variables**
   ```bash
   useradd --system --create-home --home-dir /home/salaprofeslve --shell /usr/sbin/nologin salaprofeslve
   install -d -m 750 -o root -g salaprofeslve /etc/salaprofeslve
   ```
2. **`/etc/salaprofeslve/app.env`** (640 root:salaprofeslve) con las variables de *Production* de Vercel
   (Settings → Environment Variables, o `vercel env pull`). Los valores van **directo a este archivo**:
   nunca en el chat, en un commit ni en el repo. Si se bajan a la Mac, se borra la copia después.
   - Las que usa el código: `ANTHROPIC_API_KEY`, `CRON_SECRET`, `EMAIL_FROM`, `ENVIOS_24_URL`, `ENVIOS_CLAVE`,
     `FUDO_API_KEY`, `FUDO_API_SECRET`, `FUDO_CAJA_ID`, `FUDO_LOGIN`, `FUDO_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`,
     `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
     `OPENROUTER_API_KEY`, `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_IDS`,
     `TELEGRAM_JOB_BOT`, `VAPID_PRIVATE_KEY`.
   - Más `NEXT_PUBLIC_APP_URL=https://salaprofeslve.2-25-185-242.sslip.io` (después, el dominio).
     Es `NEXT_PUBLIC_*`: se fija al compilar, así que si cambia hay que volver a deployar.
     La usan el MCP (OAuth), los PDF de informes, el resumen semanal y el link de los mails (`src/lib/app-url.ts`).
3. **Servicio** `/etc/systemd/system/salaprofeslve.service`: copia de `salaprofes24.service` cambiando
   usuario, carpeta, `/etc/salaprofeslve/` y el puerto. Debería quedar así (comparar con el de la 24 antes de usarlo):
   ```ini
   [Unit]
   Description=Sala de Profes Santa Fe (LVE)
   After=network.target

   [Service]
   User=salaprofeslve
   Group=salaprofeslve
   WorkingDirectory=/home/salaprofeslve/sala-de-profes-LVE
   EnvironmentFile=/etc/salaprofeslve/app.env
   EnvironmentFile=-/etc/salaprofeslve/dist.env
   ExecStart=/opt/node22/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3150
   Nice=10
   MemoryMax=1G
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```
   - Zona horaria: en Vercel la app corre en UTC y el código calcula la hora argentina a mano. Revisar qué
     hace la 24 (`TZ` en su servicio o la zona de la VPS con `timedatectl`) y dejar Santa Fe igual.
   - `systemctl daemon-reload && systemctl enable salaprofeslve` **antes** del primer deploy: el script
     arranca el servicio y prueba `/login`; si el servicio no existe, el deploy da error.
4. **Primer deploy** desde la Mac: `bash scripts/deploy-vps.sh`. Si el clon no existe, lo crea con el
   `git bundle`; instala dependencias, compila con prioridad baja (dentro del candado) y prueba
   `http://127.0.0.1:3150/login` antes de darlo por bueno.
5. **Caddy**: `/etc/caddy/salaprofeslve.caddy` con la dirección de prueba hacia `127.0.0.1:3150`, con los
   mismos headers y `max_size 8MB` que `salaprofes24.caddy`. Después:
   ```bash
   cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.respaldo-$(date +%Y%m%d-%H%M)-antes-de-salaprofeslve
   echo 'import /etc/caddy/salaprofeslve.caddy' >> /etc/caddy/Caddyfile
   caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
   ```
6. **Sin crons todavía**: los sigue corriendo Vercel. Si corren en los dos lados se duplican los avisos,
   los resúmenes y las sincronizaciones con Fudo.

## El cambio (fase 3)

1. Dominio en el DNS (Cloudflare, nube gris, como `lve24.com.ar`) y como primer nombre del bloque de Caddy;
   la dirección de sslip.io redirige al dominio salvo `/api/*` (como la 24).
2. `NEXT_PUBLIC_APP_URL=https://<dominio>` en `app.env` y `bash scripts/deploy-vps.sh`.
3. Crons, al mismo tiempo y nunca en los dos lados a la vez:
   - `/etc/cron.d/salaprofeslve`: los 13 de `vercel.json` salvo `festejo-madre`, contra `127.0.0.1:3150`.
     Los horarios de `vercel.json` están en **UTC**: si la VPS no está en UTC, convertirlos (mirar cómo lo
     hace `/etc/cron.d/salaprofes24`).
     ```
     # m h dom mon dow  usuario  comando   (horarios en UTC, como vercel.json)
     0 6 * * *    root curl -sS -m 300 -K /etc/salaprofeslve/cron.curlrc http://127.0.0.1:3150/api/cron/fudo-sync >> /var/log/salaprofeslve-cron.log 2>&1
     0 19 * * *   root curl -sS -m 300 -K /etc/salaprofeslve/cron.curlrc http://127.0.0.1:3150/api/cron/auto-clockout >> /var/log/salaprofeslve-cron.log 2>&1
     0 18 * * *   root curl -sS -m 300 -K /etc/salaprofeslve/cron.curlrc http://127.0.0.1:3150/api/cron/sales-summary >> /var/log/salaprofeslve-cron.log 2>&1
     0 2 * * *    root curl -sS -m 300 -K /etc/salaprofeslve/cron.curlrc http://127.0.0.1:3150/api/cron/sales-summary >> /var/log/salaprofeslve-cron.log 2>&1
     0 14 * * 1   root curl -sS -m 300 -K /etc/salaprofeslve/cron.curlrc http://127.0.0.1:3150/api/cron/business-alerts >> /var/log/salaprofeslve-cron.log 2>&1
     0 11 * * *   root curl -sS -m 300 -K /etc/salaprofeslve/cron.curlrc http://127.0.0.1:3150/api/cron/expiry-alerts >> /var/log/salaprofeslve-cron.log 2>&1
     30 7 * * *   root curl -sS -m 300 -K /etc/salaprofeslve/cron.curlrc http://127.0.0.1:3150/api/cron/sales-engine >> /var/log/salaprofeslve-cron.log 2>&1
     30 2 * * *   root curl -sS -m 300 -K /etc/salaprofeslve/cron.curlrc http://127.0.0.1:3150/api/cron/sales-daily >> /var/log/salaprofeslve-cron.log 2>&1
     0 2 * * *    root curl -sS -m 300 -K /etc/salaprofeslve/cron.curlrc http://127.0.0.1:3150/api/cron/conteo-recordatorio >> /var/log/salaprofeslve-cron.log 2>&1
     0 10 * * *   root curl -sS -m 300 -K /etc/salaprofeslve/cron.curlrc http://127.0.0.1:3150/api/cron/stock-preclose >> /var/log/salaprofeslve-cron.log 2>&1
     0 18 * * *   root curl -sS -m 300 -K /etc/salaprofeslve/cron.curlrc http://127.0.0.1:3150/api/cron/stock-preclose >> /var/log/salaprofeslve-cron.log 2>&1
     0 2 * * *    root curl -sS -m 300 -K /etc/salaprofeslve/cron.curlrc http://127.0.0.1:3150/api/cron/stock-preclose >> /var/log/salaprofeslve-cron.log 2>&1
     0 21 * * *   root curl -sS -m 300 -K /etc/salaprofeslve/cron.curlrc http://127.0.0.1:3150/api/cron/recordatorio-turno >> /var/log/salaprofeslve-cron.log 2>&1
     ```
   - `/etc/salaprofeslve/cron.curlrc` (600 root), una línea: `header = "Authorization: Bearer <CRON_SECRET>"`
     (las rutas de cron validan ese encabezado).
   - En Vercel, sacar los crons (vaciar `crons` en `vercel.json` y deployar, o desactivarlos en Settings → Cron Jobs).
4. Relojes de la base: los 7 de pg_cron (`fichajes-cierre`, `fudo-pulso`, `fudo-sync-reintento`,
   `protocolos-avisos`, `resumen-semanal`, `resumen-turno-tm`, `resumen-turno-tt`) apuntan a Vercel.
   Se actualizan `supabase/manual/*_reloj.sql` con el dominio y el SQL lo corre Matías.
5. Supabase → Authentication → URL Configuration: Site URL `https://<dominio>` y Redirect URLs
   `https://<dominio>/**` (para "Olvidé mi contraseña"). Lo hace Matías en el panel.
6. Envíos a la 24: no cambia nada (Santa Fe llama a `lve24.com.ar` con `ENVIOS_24_URL` y `ENVIOS_CLAVE`).
   Revisar que estén en `app.env` y probar el estado de la conexión.
7. Vercel queda de respaldo una semana, sin crons y, si se puede, redirigiendo al dominio nuevo.

## Deploy de todos los días

```bash
git push origin matias:main      # lo que está en GitHub en main es lo que se despliega
bash scripts/deploy-vps.sh
```

Compila en la carpeta que no está en uso (`.next-a` / `.next-b`), prueba `http://127.0.0.1:3150/login` y
recién ahí cambia. Si falla, queda la versión anterior.

## Volver atrás

- **Una versión de la app**: poner la otra carpeta en `/etc/salaprofeslve/dist.env` y `systemctl restart salaprofeslve`.
- **La mudanza entera** (si Vercel vuelve a andar): los relojes de pg_cron vuelven a la dirección de Vercel,
  los crons vuelven a `vercel.json` y se borra `/etc/cron.d/salaprofeslve`.

## Diferencias con Vercel

- La VPS está en EE. UU. y la base en San Pablo: cada consulta tarda un poco más.
- No hay límite de tiempo por función (`maxDuration` no aplica), pero sí de memoria (MemoryMax=1G).
- Después del cambio: los que tienen la app instalada la tienen que volver a instalar y reactivar las
  notificaciones (los avisos dependen de la dirección). Los socios con el conector de Claude (MCP) lo
  sacan y lo vuelven a agregar con `https://<dominio>/api/mcp`.
