// ---------------------------------------------------------------------------
// Conexión con la app de la 24 (envíos, lista de producción, stock de la 24)
// ---------------------------------------------------------------------------
// Todas las llamadas van a <ENVIOS_24_URL>/api/envios/... con la clave
// compartida ENVIOS_CLAVE (Authorization: Bearer <clave>).
// ---------------------------------------------------------------------------

const ESPERA_MS = 8_000

/** null si está todo para hablar con la 24; si no, qué falta */
export function faltaConfigurar(): string | null {
  const clave = process.env.ENVIOS_CLAVE
  if (!clave || clave.length < 32) return 'Falta configurar ENVIOS_CLAVE en la app de Santa Fe (la misma clave que tiene la 24)'
  return null
}

const base24 = () => (process.env.ENVIOS_24_URL || 'https://lve24.com.ar').trim().replace(/\/+$/, '')

/** status 0 = la 24 no respondió (red, tiempo agotado, sin configurar) */
export type Resp24 = { status: number; body: Record<string, unknown> | null; error: string | null }

/** ruta: lo que va después de /api/envios (ej. '/entrantes', '/catalogo') */
export async function pedirA24(method: 'GET' | 'POST' | 'PUT' | 'DELETE', ruta: string, body?: unknown, esperaMs = ESPERA_MS): Promise<Resp24> {
  const falta = faltaConfigurar()
  if (falta) return { status: 0, body: null, error: falta }
  try {
    const res = await fetch(`${base24()}/api/envios${ruta}`, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.ENVIOS_CLAVE}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(esperaMs),
      cache: 'no-store',
    })
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
    const error = res.ok ? null : typeof json?.error === 'string' ? json.error : `La 24 respondió ${res.status}`
    return { status: res.status, body: json, error }
  } catch (err) {
    const nombre = err instanceof Error ? err.name : ''
    return {
      status: 0,
      body: null,
      error: nombre === 'TimeoutError' || nombre === 'AbortError'
        ? 'La 24 no respondió a tiempo'
        : `No se pudo hablar con la 24 (${err instanceof Error ? err.message : 'error de red'})`,
    }
  }
}

/** Sin respuesta o error del lado de la 24: se puede reintentar. 4xx no. */
export const reintentable = (status: number) => status === 0 || status >= 500
