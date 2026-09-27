import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { logAudit } from '@/lib/audit'
import { syncToFudo } from '@/lib/fudo/stock-sync'
import { analizarConteo, estadoConteoHoy } from '@/lib/stock/conteo-texto'

// ---------------------------------------------------------------------------
// /api/stock/conteo-texto — conteo diario pegando el mensaje de WhatsApp
//   GET  → estado del conteo de hoy { contados, total, ultimo }
//   POST { accion: 'analizar', texto }  → renglones interpretados
//   POST { accion: 'guardar', lineas: [{ alias, stock_item_id|null, qty, recordar }], nota? }
//        → cada insumo se guarda como conteo físico (mismo camino que el
//          conteo normal: actualiza Fudo, pide nota en diferencias grandes).
// Pueden contar: socio, encargado, chef, cocina y barista.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ROLES = ['socio', 'encargado', 'chef', 'cocina', 'barista']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET() {
  const auth = await requireRole(ROLES)
  if (auth.response) return auth.response
  return NextResponse.json(await estadoConteoHoy(createAdminClient()))
}

type LineaGuardar = { alias?: string; stock_item_id?: string | null; qty?: number; recordar?: boolean }

export async function POST(request: Request) {
  try {
    const auth = await requireRole(ROLES)
    if (auth.response) return auth.response
    const body = await request.json().catch(() => null) as { accion?: string; texto?: string; lineas?: LineaGuardar[]; nota?: string | null } | null
    const admin = createAdminClient()

    if (body?.accion === 'analizar') {
      const texto = String(body.texto ?? '').slice(0, 20_000)
      if (!texto.trim()) return NextResponse.json({ error: 'Pegá el mensaje del conteo' }, { status: 400 })
      return NextResponse.json({ lineas: await analizarConteo(admin, texto) })
    }

    if (body?.accion === 'guardar') {
      const lineas = Array.isArray(body.lineas) ? body.lineas.slice(0, 200) : []
      if (lineas.length === 0) return NextResponse.json({ error: 'No hay nada para guardar' }, { status: 400 })
      const nota = (body.nota ?? '').trim().slice(0, 500) || null

      // Recordar los nombres confirmados (o "no contar") para la próxima vez
      const recordar = lineas
        .filter((l) => l.recordar && l.alias && (l.stock_item_id === null || UUID.test(String(l.stock_item_id))))
        .map((l) => ({ alias: String(l.alias).slice(0, 200), stock_item_id: l.stock_item_id ?? null, created_by: auth.user.id, updated_at: new Date().toISOString() }))
      if (recordar.length > 0) {
        const { error } = await admin.from('stock_count_aliases').upsert(recordar, { onConflict: 'alias' })
        if (error) console.warn('[conteo-texto] alias no guardados:', error.message)
      }

      // Un insumo puede aparecer en dos renglones: se suman
      const porItem = new Map<string, number>()
      for (const l of lineas) {
        if (!l.stock_item_id || !UUID.test(String(l.stock_item_id))) continue
        const q = Number(l.qty)
        if (!Number.isFinite(q) || q < 0) return NextResponse.json({ error: 'Hay una cantidad inválida' }, { status: 400 })
        porItem.set(l.stock_item_id, (porItem.get(l.stock_item_id) ?? 0) + q)
      }

      const resultados: { stock_item_id: string; ok: boolean; error?: string }[] = []
      for (const [id, qty] of porItem) {
        const r = await syncToFudo(admin, id, Math.round(qty * 1000) / 1000, auth.user.id, {
          reason: 'physical_count',
          note: nota ? `Conteo diario: ${nota}` : 'Conteo diario (mensaje de WhatsApp)',
        })
        resultados.push({ stock_item_id: id, ok: r.success, error: r.success ? undefined : r.error })
      }

      const ok = resultados.filter((r) => r.ok).length
      void logAudit(admin, {
        userId: auth.user.id, userName: null, action: 'conteo_diario_texto', module: 'stock',
        entityType: 'stock_count', description: `Conteo diario desde mensaje: ${ok} de ${resultados.length} guardados`,
        metadata: { resultados, nota, recordados: recordar.length },
      })
      return NextResponse.json({ success: ok > 0, guardados: ok, resultados, estado: await estadoConteoHoy(admin) })
    }

    return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
  } catch (err) {
    console.error('[POST /api/stock/conteo-texto]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
