import type { SupabaseClient } from '@supabase/supabase-js'
import { fechaOperativa } from '@/lib/attendance/jornada'
import { sendPushToUser } from '@/lib/push/send'
import { idsConRolEnTurno, ROLES_ENCARGADO_TURNO } from '@/lib/turnos/rol-del-turno'

// ---------------------------------------------------------------------------
// Avisos operativos al encargado (una vez por día cada uno)
// ---------------------------------------------------------------------------
//   · Pedido "en camino" hace 2 días o más → "¿Llegó el pedido de X?"
//     (si llegó y nadie lo marcó, la mercadería nunca se sumó al stock)
//   · Producción esperando validación hace más de 12 h → "Validala o rechazala"
//   · Recetas de Fudo importadas hace más de 30 días → una vez por semana
//     (las recetas de los platos se cambian en Fudo y la app las trae del Excel)
// Solo de 10 a 20 h (no de noche). La clave del día va a avisos_enviados y se
// reserva antes de mandar, así sale una sola vez aunque corran dos procesos.
// Lo corre el pulso de Fudo cada 10 minutos.
// ---------------------------------------------------------------------------

const DIAS_PEDIDO = 2
const HORAS_PRODUCCION = 12
const DIAS_RECETAS = 30

async function destinatarios(admin: SupabaseClient, ahora: Date): Promise<string[]> {
  const enTurno = await idsConRolEnTurno(admin, ROLES_ENCARGADO_TURNO, ahora)
  if (enTurno.length) return enTurno
  const { data } = await admin.from('profiles').select('id').eq('is_active', true).eq('role', 'encargado')
  return (data ?? []).map((d: { id: string }) => d.id)
}

async function reservar(admin: SupabaseClient, clave: string): Promise<boolean> {
  const { data } = await admin.from('avisos_enviados').upsert({ clave }, { onConflict: 'clave', ignoreDuplicates: true }).select('clave')
  return (data ?? []).length > 0
}

const ddmm = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit' })

export async function avisosOperativos(admin: SupabaseClient, ahora = new Date()): Promise<{ pedidos: number; producciones: number; recetas: number }> {
  const out = { pedidos: 0, producciones: 0, recetas: 0 }
  const hora = Number(ahora.toLocaleString('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hour12: false })) % 24
  if (hora < 10 || hora >= 20) return out
  const hoy = fechaOperativa(ahora)
  let para: string[] | null = null
  const getPara = async () => (para ??= await destinatarios(admin, ahora))

  // ---- Pedidos en camino hace días (cocina y barra) ----
  const limite = new Date(ahora.getTime() - DIAS_PEDIDO * 86_400_000).toISOString()
  const [{ data: k }, { data: b }, { data: provs }] = await Promise.all([
    admin.from('kitchen_orders').select('supplier_id, ordered_at, created_at').eq('status', 'ordered').lt('created_at', limite),
    admin.from('bar_orders').select('supplier_id, created_at').eq('status', 'ordered').lt('created_at', limite),
    admin.from('suppliers').select('id, name'),
  ])
  const nombreProv = new Map(((provs ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]))
  const grupos = new Map<string, { proveedor: string; desde: string; n: number }>()
  for (const o of [...(k ?? []), ...(b ?? [])] as { supplier_id: string | null; ordered_at?: string | null; created_at: string }[]) {
    const desde = o.ordered_at ?? o.created_at
    if (desde > limite) continue
    const clave = `${o.supplier_id ?? 'sin'}:${desde.slice(0, 10)}`
    const g = grupos.get(clave) ?? { proveedor: (o.supplier_id && nombreProv.get(o.supplier_id)) || 'proveedor sin cargar', desde, n: 0 }
    g.n++
    grupos.set(clave, g)
  }
  for (const [clave, g] of grupos) {
    if (!(await reservar(admin, `pedido:${clave}:${hoy}`))) continue
    const dias = Math.floor((ahora.getTime() - Date.parse(g.desde)) / 86_400_000)
    await Promise.allSettled((await getPara()).map((id) => sendPushToUser(id, {
      title: `📦 ¿Llegó el pedido de ${g.proveedor}?`,
      body: `${g.n} producto${g.n !== 1 ? 's' : ''} en camino desde el ${ddmm(g.desde)} (hace ${dias} días). Si llegó marcá "Llegó" (si no, no se suma al stock); si no vino, "No vino".`,
      url: '/pedidos',
    })))
    out.pedidos++
  }

  // ---- Producciones esperando validación ----
  const limiteProd = new Date(ahora.getTime() - HORAS_PRODUCCION * 3_600_000).toISOString()
  const { data: prods } = await admin.from('production_orders').select('id, name, submitted_at, created_at').eq('status', 'pending_review')
  for (const p of (prods ?? []) as { id: number; name: string | null; submitted_at: string | null; created_at: string }[]) {
    const desde = p.submitted_at ?? p.created_at
    if (desde > limiteProd) continue
    if (!(await reservar(admin, `produccion:${p.id}:${hoy}`))) continue
    await Promise.allSettled((await getPara()).map((id) => sendPushToUser(id, {
      title: '🍳 Producción sin validar',
      body: `${p.name ?? `Producción #${p.id}`} espera validación desde el ${ddmm(desde)}. Validala (suma el stock) o rechazala con el motivo.`,
      url: '/stock/produccion',
    })))
    out.producciones++
  }

  // ---- Recetas de Fudo desactualizadas (una vez por semana, el lunes o el primer día que toque) ----
  const { data: imp } = await admin.from('app_settings').select('value').eq('key', 'fudo_recetas_import').maybeSingle()
  const ultima = (imp?.value as { last_import_at?: string } | null)?.last_import_at ?? null
  const dias = ultima ? Math.floor((ahora.getTime() - Date.parse(ultima)) / 86_400_000) : null
  if (dias == null || dias > DIAS_RECETAS) {
    const f = new Date(`${hoy}T12:00:00Z`)
    const lunes = new Date(f.getTime() - ((f.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10)
    if (await reservar(admin, `recetas:${lunes}`)) {
      await Promise.allSettled((await getPara()).map((id) => sendPushToUser(id, {
        title: '📋 Actualizá las recetas de Fudo',
        body: `${ultima ? `La última importación fue el ${ddmm(ultima)} (hace ${dias} días)` : 'Nunca se importaron las recetas'}. Si cambiaron recetas en Fudo, exportá el Excel de productos y subilo en Más → Importar recetas.`,
        url: '/admin/fudo/importar',
      })))
      out.recetas++
    }
  }
  return out
}
