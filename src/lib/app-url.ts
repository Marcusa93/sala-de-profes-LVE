// ---------------------------------------------------------------------------
// Dirección pública de la app de Santa Fe
// ---------------------------------------------------------------------------
// En la VPS se define NEXT_PUBLIC_APP_URL (/etc/salaprofeslve/app.env). Como
// es NEXT_PUBLIC_*, se fija al compilar: si cambia, hay que recompilar. En
// Vercel no está definida y queda la dirección de siempre.
// La usan el MCP (OAuth), los PDF de informes, el resumen semanal y los mails.
// ---------------------------------------------------------------------------

export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://sala-de-profes-lve.vercel.app').replace(/\/+$/, '')
