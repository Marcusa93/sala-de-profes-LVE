import type { SupabaseClient } from '@supabase/supabase-js'
import { leerLista } from '@/lib/produccion/lista'
import { conteosDeHoy, type ConteoDelDia } from '@/lib/stock/conteo-diario'
import { puedeValidarProduccion } from '@/lib/roles'
import { HORAS_PARA_CAMBIAR, esNotaDeCambio, puedeCambiarValidacion, type Cambio } from '@/lib/produccion/cambiar-validacion'

// ---------------------------------------------------------------------------
// «Lo de hoy» de la jefa de cocina (sistema de producción, punto 2)
// ---------------------------------------------------------------------------
// En una sola pantalla, desde el celular:
//   1. Confirmar lo que cargó producción con «Lo hice» (está en la heladera,
//      falta algo o no está). Se puede hacer antes o después del conteo: si
//      un producto se contó después de cargar la producción, al confirmarla
//      no se vuelve a sumar (lib/produccion/ya-contado).
//   2. Conteo de cierre de los productos de la lista de producción.
//   3. Merma: vencido, mal guardado o consumo del personal.
// ---------------------------------------------------------------------------

export const ROLES_LO_DE_HOY = ['socio', 'encargado', 'chef'] as const

/** Producciones a confirmar de estos días; las más viejas se cuentan aparte */
const DIAS_A_CONFIRMAR = 3

function inicioDelDiaAR(): string {
  const hoyAR = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
  return new Date(`${hoyAR}T00:00:00-03:00`).toISOString()
}

export type SalidaAConfirmar = {
  id: number
  stock_item_id: string | null
  nombre: string
  cantidad: number
  unidad: string
  /** se contó después de cargar la producción: al confirmar no se vuelve a sumar */
  contado_despues: boolean
}

export type ProduccionAConfirmar = {
  id: number
  nombre: string
  quien: string | null
  cargada_at: string
  nota: string | null
  /** por qué no se pudo cerrar sola (ej. stock insuficiente de un crudo) */
  problema: string | null
  /** volvió a "para confirmar": se deshizo la validación o se reabrió (con el motivo) */
  cambio_nota: string | null
  salidas: SalidaAConfirmar[]
  crudos: { nombre: string; cantidad: number; unidad: string }[]
  /** la cargó quien está mirando: la tiene que confirmar otra persona */
  es_mia: boolean
  puede_confirmar: boolean
}

/** Confirmada o rechazada hace poco que quien mira puede cambiar (deshacer / volver a abrir) */
export type ProduccionRevisada = {
  id: number
  nombre: string
  cambio: Cambio
  cuando: string
  quien_reviso: string | null
}

export type MermaDeHoy = { id: string; nombre: string; unidad: string; cantidad: number; nota: string | null; quien: string | null; hora: string }

export type DatosLoDeHoy = {
  lista: { stock_item_id: string; nombre: string; unidad: string; contado_hoy: boolean; contado_at: string | null }[]
  falta_migracion: boolean
  a_confirmar: ProduccionAConfirmar[]
  viejas_sin_confirmar: number
  revisadas: ProduccionRevisada[]
  conteos_hoy: ConteoDelDia[]
  mermas_hoy: MermaDeHoy[]
}

type FilaOrden = {
  id: number
  name: string
  chef_id: string | null
  submitted_at: string | null
  created_at: string
  notes: string | null
  review_notes: string | null
  profiles: { first_name: string | null; last_name: string | null } | null
}

export async function datosLoDeHoy(admin: SupabaseClient, yo: { id: string; role: string }): Promise<DatosLoDeHoy> {
  const hoy = inicioDelDiaAR()
  const desde = new Date(Date.now() - DIAS_A_CONFIRMAR * 86_400_000).toISOString()

  const desdeCambio = new Date(Date.now() - HORAS_PARA_CAMBIAR * 3_600_000).toISOString()
  const [lista, conteos, { data: ordenes }, { count: viejas }, { data: mermas }, { data: revisadasRaw }] = await Promise.all([
    leerLista(admin),
    conteosDeHoy(admin),
    admin.from('production_orders')
      .select('id, name, chef_id, submitted_at, created_at, notes, review_notes, profiles!production_orders_chef_id_fkey(first_name, last_name)')
      .eq('status', 'pending_review').gte('created_at', desde).order('created_at'),
    admin.from('production_orders').select('id', { count: 'exact', head: true })
      .eq('status', 'pending_review').lt('created_at', desde),
    admin.from('stock_movements')
      .select('id, qty, note, created_at, stock_items(name, unit), profiles:created_by(first_name)')
      .eq('reason', 'waste').gte('created_at', hoy).order('created_at', { ascending: false }).limit(50),
    admin.from('production_orders')
      .select('id, name, status, chef_id, reviewed_by, reviewed_at, completed_at')
      .in('status', ['completed', 'rejected'])
      .or(`completed_at.gte.${desdeCambio},reviewed_at.gte.${desdeCambio}`)
      .order('updated_at', { ascending: false }).limit(30),
  ])

  const filas = (ordenes ?? []) as unknown as FilaOrden[]
  const ids = filas.map((o) => o.id)
  const [{ data: salidas }, { data: crudos }] = ids.length
    ? await Promise.all([
      admin.from('production_outputs').select('id, production_order_id, stock_item_id, output_name, qty_produced, unit, is_waste, stock_items(name, unit, last_counted_at)').in('production_order_id', ids),
      admin.from('production_inputs').select('production_order_id, qty_used, unit, stock_items(name, unit)').in('production_order_id', ids),
    ])
    : [{ data: [] }, { data: [] }]

  type FilaSalida = { id: number; production_order_id: number; stock_item_id: string | null; output_name: string; qty_produced: number; unit: string | null; is_waste: boolean | null; stock_items: { name: string; unit: string; last_counted_at: string | null } | null }
  type FilaCrudo = { production_order_id: number; qty_used: number; unit: string | null; stock_items: { name: string; unit: string } | null }

  const a_confirmar: ProduccionAConfirmar[] = filas.map((o) => {
    const cargada = o.submitted_at ?? o.created_at
    const nombreQuien = o.profiles ? [o.profiles.first_name, o.profiles.last_name].filter(Boolean).join(' ').trim() || null : null
    return {
      id: o.id,
      nombre: o.name,
      quien: nombreQuien,
      cargada_at: cargada,
      nota: o.notes,
      problema: o.review_notes?.startsWith('No se pudo cerrar') ? o.review_notes.replace(/^No se pudo cerrar:\s*/, '') : null,
      cambio_nota: esNotaDeCambio(o.review_notes) ? o.review_notes : null,
      salidas: ((salidas ?? []) as unknown as FilaSalida[])
        .filter((s) => s.production_order_id === o.id && !s.is_waste)
        .map((s) => ({
          id: Number(s.id),
          stock_item_id: s.stock_item_id,
          nombre: s.stock_items?.name ?? s.output_name,
          cantidad: Number(s.qty_produced),
          unidad: s.stock_items?.unit ?? s.unit ?? '',
          contado_despues: Boolean(s.stock_items?.last_counted_at && s.stock_items.last_counted_at > cargada),
        })),
      crudos: ((crudos ?? []) as unknown as FilaCrudo[])
        .filter((c) => c.production_order_id === o.id)
        .map((c) => ({ nombre: c.stock_items?.name ?? 'Insumo', cantidad: Number(c.qty_used), unidad: c.stock_items?.unit ?? c.unit ?? '' })),
      es_mia: o.chef_id === yo.id,
      puede_confirmar: puedeValidarProduccion(yo.role, yo.id, o.chef_id),
    }
  })

  // Confirmadas o rechazadas hace poco que esta persona puede cambiar
  type FilaRevisada = { id: number; name: string; status: string; chef_id: string | null; reviewed_by: string | null; reviewed_at: string | null; completed_at: string | null }
  const cambiables = ((revisadasRaw ?? []) as FilaRevisada[])
    .map((o) => ({ o, permiso: puedeCambiarValidacion(yo.role, yo.id, o) }))
    .filter((x): x is { o: FilaRevisada; permiso: { ok: true; cambio: Cambio } } => x.permiso.ok)
  const idsRevisores = [...new Set(cambiables.map((x) => x.o.reviewed_by).filter((v): v is string => !!v))]
  const { data: revisores } = idsRevisores.length
    ? await admin.from('profiles').select('id, first_name').in('id', idsRevisores)
    : { data: [] }
  const nombreRevisor = new Map(((revisores ?? []) as { id: string; first_name: string | null }[]).map((p) => [p.id, p.first_name]))
  const revisadas: ProduccionRevisada[] = cambiables.map(({ o, permiso }) => ({
    id: o.id,
    nombre: o.name,
    cambio: permiso.cambio,
    cuando: (permiso.cambio === 'deshacer' ? o.completed_at ?? o.reviewed_at : o.reviewed_at) ?? '',
    quien_reviso: o.reviewed_by ? nombreRevisor.get(o.reviewed_by) ?? null : null,
  }))

  type FilaMerma = { id: string; qty: number; note: string | null; created_at: string; stock_items: { name: string; unit: string } | null; profiles: { first_name: string | null } | null }
  return {
    lista: lista.productos
      .filter((p) => p.activo)
      .map((p) => ({ stock_item_id: p.stock_item_id, nombre: p.nombre, unidad: p.unidad, contado_at: p.contado_at, contado_hoy: Boolean(p.contado_at && p.contado_at >= hoy) })),
    falta_migracion: lista.falta_migracion,
    a_confirmar,
    viejas_sin_confirmar: viejas ?? 0,
    revisadas,
    conteos_hoy: conteos,
    mermas_hoy: ((mermas ?? []) as unknown as FilaMerma[]).map((m) => ({
      id: m.id,
      nombre: m.stock_items?.name ?? 'Insumo',
      unidad: m.stock_items?.unit ?? '',
      cantidad: Number(m.qty),
      nota: m.note,
      quien: m.profiles?.first_name ?? null,
      hora: m.created_at,
    })),
  }
}
