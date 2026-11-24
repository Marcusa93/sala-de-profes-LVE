#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Deploy de Sala de Profes Santa Fe (LVE) a la VPS (reemplaza al de Vercel).
# Copia del de la 24 (sala-de-profes-24/scripts/deploy-vps.sh), adaptada.
# Armado del servidor y cómo volver atrás: deploy/VPS.md.
#
# La VPS no tiene acceso al repo privado de GitHub: se lleva origin/main como
# git bundle (un clon real, con historial), se actualiza el clon de
# /home/salaprofeslve y se compila con prioridad baja (Nice=15, para no frenar
# a los bots ni a las otras apps).
#
# VPS COMPARTIDA (1 núcleo, poca RAM): el build y `npm ci` van dentro del
# candado /var/lock/next-build.lock, el mismo que usa la 24. Dos `next build`
# a la vez pueden matar servicios. Si la 24 está compilando, este espera.
#
# Sin cortes: el build va a la carpeta que NO está en uso (.next-a / .next-b) y
# recién al terminar el servicio pasa a la nueva (NEXT_DIST_DIR en
# /etc/salaprofeslve/dist.env) y se reinicia (unos segundos), probando antes
# http://127.0.0.1:3150/login. Si el build falla, o la versión nueva no
# levanta, queda la anterior.
# Volver a la versión previa a mano: poner la otra carpeta en dist.env y
# `systemctl restart salaprofeslve` (la previa queda hasta el deploy siguiente).
#
# Uso (desde la raíz del repo; despliega lo que está en GitHub en main):
#   bash scripts/deploy-vps.sh
# ---------------------------------------------------------------------------
set -euo pipefail

VPS=root@2.25.185.242
USUARIO=salaprofeslve
APP=/home/salaprofeslve/sala-de-profes-LVE
ETC=/etc/salaprofeslve
SERVICIO=salaprofeslve.service
PUERTO=3150
CANDADO=/var/lock/next-build.lock
# Dirección pública: la de NEXT_PUBLIC_APP_URL en app.env de la VPS (así no hay
# que tocar el script al pasar de sslip.io al dominio). Esta es por si falta.
URL_POR_DEFECTO=https://santafe.laviejaescuelabar.com.ar

# Se despliega main tal como está en GitHub (acá se trabaja en `matias` y se
# sube con `git push origin matias:main`): lo que no está pusheado no va.
# Solo para probar en la VPS algo que todavía no está en main (la mudanza):
#   REF=matias bash scripts/deploy-vps.sh
REF=${REF:-origin/main}
git fetch -q origin main
REV=$(git rev-parse "$REF")
REF_COMPLETA=$(git rev-parse --symbolic-full-name "$REF")
[ -n "$REF_COMPLETA" ] || { echo "❌ $REF no es una rama."; exit 1; }
if [ "$REF" != "origin/main" ]; then
  echo "⚠️  Se despliega $REF, que no es main (solo para pruebas): $(git log --oneline -1 "$REV")"
elif [ "$(git rev-parse HEAD)" != "$REV" ]; then
  echo "ℹ️  Ojo: tu rama actual no es igual a origin/main. Se despliega origin/main: $(git log --oneline -1 "$REV")"
fi

BUNDLE=$(mktemp -t splve).bundle
git bundle create "$BUNDLE" "$REF_COMPLETA" >/dev/null 2>&1
scp -q "$BUNDLE" "$VPS:/tmp/splve.bundle"
rm -f "$BUNDLE"
echo "📦 Código enviado: $(git log --oneline -1 "$REV")"

URL=$(ssh "$VPS" bash -s <<REMOTO
set -euo pipefail
chown $USUARIO:$USUARIO /tmp/splve.bundle
# Primera vez: repo vacío (el usuario y $ETC los crea el armado, ver deploy/VPS.md)
[ -d $APP/.git ] || sudo -u $USUARIO git init -q $APP
sudo -u $USUARIO git -C $APP fetch -q /tmp/splve.bundle $REF_COMPLETA
sudo -u $USUARIO git -C $APP reset -q --hard FETCH_HEAD
rm -f /tmp/splve.bundle
echo "📥 VPS en: \$(sudo -u $USUARIO git -C $APP log --oneline -1)" >&2

# Carpeta en uso y carpeta nueva (sin dist.env = .next).
DIST_ENV=$ETC/dist.env
ACTIVA=\$(sed -n 's/^NEXT_DIST_DIR=//p' \$DIST_ENV 2>/dev/null || true)
[ "\$ACTIVA" = ".next-a" ] && NUEVA=.next-b || NUEVA=.next-a

# Todo lo pesado, con prioridad baja, memoria acotada y dentro del candado compartido
correr() {
  if ! flock -n $CANDADO true; then echo "⏳ Otra app está compilando: espero a que termine…" >&2; fi
  flock -w 1800 $CANDADO systemd-run --quiet --wait --collect --pipe \
    -p User=$USUARIO -p Group=$USUARIO -p Nice=15 -p CPUWeight=20 -p IOWeight=20 -p MemoryMax=2200M \
    -p EnvironmentFile=$ETC/app.env -p WorkingDirectory=$APP \
    -E HOME=/home/$USUARIO -E PATH=/opt/node22/bin:/usr/bin:/bin -E NEXT_TELEMETRY_DISABLED=1 \
    -E NODE_OPTIONS=--max-old-space-size=1800 -E NEXT_DIST_DIR=\$NUEVA "\$@"
}

LOCK=\$(sha256sum $APP/package-lock.json | cut -d' ' -f1)
if [ "\$(cat $APP/node_modules/.splve-lock.sha256 2>/dev/null || true)" = "\$LOCK" ]; then
  echo "🔧 Dependencias sin cambios" >&2
else
  echo "🔧 Instalando dependencias (cambió package-lock.json)…" >&2
  correr /opt/node22/bin/npm ci --include=dev --no-audit --no-fund >/tmp/splve-deploy.log 2>&1 || { tail -20 /tmp/splve-deploy.log >&2; exit 1; }
  echo "\$LOCK" | sudo -u $USUARIO tee $APP/node_modules/.splve-lock.sha256 >/dev/null
fi

echo "🏗️  Compilando en \$NUEVA (prioridad baja, unos minutos; la app sigue andando)…" >&2
correr /opt/node22/bin/node node_modules/next/dist/bin/next build >>/tmp/splve-deploy.log 2>&1 || { tail -30 /tmp/splve-deploy.log >&2; echo "❌ Falló el build: la app sigue con la versión anterior (\${ACTIVA:-.next})." >&2; exit 1; }
rm -f /tmp/splve-deploy.log

# Elige la carpeta, reinicia y prueba /login en el puerto local antes de darlo por bueno
usar() {
  if [ -n "\$1" ]; then echo "NEXT_DIST_DIR=\$1" > \$DIST_ENV.tmp && chmod 644 \$DIST_ENV.tmp && mv \$DIST_ENV.tmp \$DIST_ENV; else rm -f \$DIST_ENV; fi
  systemctl restart $SERVICIO
  for i in \$(seq 1 30); do
    [ "\$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:$PUERTO/login)" = "200" ] && return 0
    sleep 1
  done
  return 1
}
if usar \$NUEVA; then
  echo "✅ Servicio activo con \$NUEVA (http://127.0.0.1:$PUERTO/login responde)" >&2
  if [ -n "\$ACTIVA" ]; then rm -rf $APP/.next; fi
else
  journalctl -u $SERVICIO -n 20 --no-pager >&2
  echo "❌ La versión nueva no levantó: se vuelve a \${ACTIVA:-.next}." >&2
  usar "\$ACTIVA" && echo "↩️  Volvió la versión anterior" >&2 || echo "⚠️  Tampoco levantó la anterior: revisar YA" >&2
  exit 1
fi

# La dirección pública (para la prueba de afuera)
sed -n 's/^NEXT_PUBLIC_APP_URL=//p' $ETC/app.env | tr -d '"' | head -1
REMOTO
)
URL=${URL:-$URL_POR_DEFECTO}

# Prueba de afuera, forzando la IP de la VPS: algunas redes no resuelven
# sslip.io (la de la oficina, 24/11) y daba error aunque la app anduviera.
HOST=${URL#https://}; HOST=${HOST%%/*}
code=$(curl -s -o /dev/null -m 20 -w "%{http_code}" --resolve "$HOST:443:${VPS#root@}" "$URL/login" || true)
echo "🌐 $URL/login → ${code:-sin respuesta}"
[ "$code" = "200" ]
