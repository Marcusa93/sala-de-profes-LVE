// ---------------------------------------------------------------------------
// Utilidades de seguridad para el sistema de fichaje
// ---------------------------------------------------------------------------

export type GeoResult = {
  lat: number
  lng: number
  accuracy: number
}

export type DeviceFingerprint = {
  id: string
  userAgent: string
  language: string
  timezone: string
  screen: string
  platform: string
}

// ---------------------------------------------------------------------------
// Geolocalización
// ---------------------------------------------------------------------------

export function getGeolocation(timeoutMs = 10000): Promise<GeoResult> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocalización no disponible en este dispositivo'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat:      pos.coords.latitude,
        lng:      pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (err) => {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            reject(new Error('Permiso de ubicación denegado. Habilitalo en la configuración del navegador.'))
            break
          case err.POSITION_UNAVAILABLE:
            reject(new Error('No se pudo determinar la ubicación. Verificá que el GPS esté activado.'))
            break
          case err.TIMEOUT:
            reject(new Error('Tiempo de espera agotado al obtener ubicación.'))
            break
          default:
            reject(new Error('Error al obtener ubicación.'))
        }
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    )
  })
}

// ---------------------------------------------------------------------------
// Device Fingerprint — identificador estable del dispositivo
// ---------------------------------------------------------------------------

export function getDeviceFingerprint(): DeviceFingerprint {
  const ua       = navigator.userAgent
  const lang     = navigator.language
  const tz       = Intl.DateTimeFormat().resolvedOptions().timeZone
  const screen   = `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`
  const platform = navigator.platform ?? 'unknown'

  // Generar ID estable basado en características del dispositivo
  const raw = [ua, lang, tz, screen, platform].join('|')
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i)
    hash |= 0 // convertir a 32-bit integer
  }
  const deviceId = Math.abs(hash).toString(36)

  return { id: deviceId, userAgent: ua, language: lang, timezone: tz, screen, platform }
}

// ---------------------------------------------------------------------------
// WiFi SSID — solo disponible vía Network Information API (limitado en browsers)
// En browsers no podemos leer SSID directamente por seguridad.
// Capturamos lo que podemos: tipo de conexión y velocidad efectiva.
// ---------------------------------------------------------------------------

export type NetworkInfo = {
  ssid?: string          // no disponible en browsers
  connectionType?: string
  effectiveType?: string
  downlink?: number
}

export function getNetworkInfo(): NetworkInfo {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn = (navigator as any).connection ?? (navigator as any).mozConnection ?? (navigator as any).webkitConnection
  if (!conn) return {}
  return {
    connectionType: conn.type,
    effectiveType:  conn.effectiveType,
    downlink:       conn.downlink,
  }
}

// ---------------------------------------------------------------------------
// Distancia Haversine (metros) entre dos puntos GPS — cálculo client-side
// ---------------------------------------------------------------------------

export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000 // metros
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

function toRad(deg: number) { return (deg * Math.PI) / 180 }

// ---------------------------------------------------------------------------
// Tipo de config del local
// ---------------------------------------------------------------------------

export type VenueConfig = {
  venue_lat:     number
  venue_lng:     number
  geo_radius_m:  number
  allowed_ssids: string[]
  require_photo: boolean
  require_geo:   boolean
  require_wifi:  boolean
}
