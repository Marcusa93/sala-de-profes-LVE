'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RotateCcw } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog'
import type { Cambio } from '@/lib/produccion/cambiar-validacion'

// ---------------------------------------------------------------------------
// Cambiar una validación: deshacer una confirmada o volver a abrir una rechazada
// ---------------------------------------------------------------------------
// El motivo es obligatorio, queda en el historial y le llega a quien la cargó.
// Reglas en lib/produccion/cambiar-validacion.
// ---------------------------------------------------------------------------

const MOTIVOS: Record<Cambio, string[]> = {
  deshacer: ['Número mal cargado', 'Estaba duplicada', 'La confirmé por error'],
  reabrir: ['La rechacé por error', 'Ya está corregida'],
}

export function CambiarValidacionDialog({ orden, cambio, onClose, onDone }: {
  orden: { id: number; name: string }
  cambio: Cambio
  onClose: () => void
  onDone: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const motivoOk = motivo.trim().length >= 3
  const deshacer = cambio === 'deshacer'

  async function enviar() {
    if (!motivoOk) return
    setEnviando(true)
    try {
      const res = await fetch(`/api/produccion/orders/${orden.id}/${deshacer ? 'deshacer' : 'reabrir'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo: motivo.trim() }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(json?.error ?? 'No se pudo cambiar la producción')
      toast.success(json.message ?? (deshacer ? 'Validación deshecha' : 'Producción abierta de nuevo'))
      for (const w of (json.warnings ?? []) as string[]) toast.info(w, { duration: 10_000 })
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cambiar la producción')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !enviando) onClose() }}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <RotateCcw className="size-4 text-[#b0762a]" />
            {deshacer ? 'Deshacer la validación' : 'Volver a abrir'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-[13px] font-semibold text-[#3d2c24]">{orden.name}</p>
          {deshacer ? (
            <ul className="list-disc space-y-1 pl-4 text-[12.5px] text-[#7d6c64]">
              <li>Los insumos vuelven al stock y lo producido se descuenta, en la app y en Fudo.</li>
              <li>Vuelve a «para confirmar»: después la corregís con «Falta algo» y la confirmás, o la rechazás.</li>
              <li>Si lo producido ya se usó o se mandó a la 24, queda en negativo hasta el próximo conteo.</li>
              <li>Lo que se contó después de confirmarla no se toca: el conteo ya tiene el número real.</li>
            </ul>
          ) : (
            <ul className="list-disc space-y-1 pl-4 text-[12.5px] text-[#7d6c64]">
              <li>Vuelve a «para confirmar» y se confirma normal. No toca el stock.</li>
              <li>Fijate que no la hayan cargado de nuevo: si ya está otra vez, quedaría duplicada.</li>
            </ul>
          )}
          <div className="flex flex-wrap gap-1.5">
            {MOTIVOS[cambio].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMotivo(m)}
                className="rounded-full bg-white px-3 py-1 text-[11.5px] font-medium text-[#7d6c64] ring-1 ring-[#ebe6df]"
              >
                {m}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="text-[11px] font-semibold text-[#3d2c24]">Motivo (obligatorio)</span>
            <textarea
              autoFocus
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder={deshacer ? '¿Qué estuvo mal?' : '¿Por qué la volvés a abrir?'}
              className="mt-1 w-full resize-none rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-[13px] outline-none focus:border-[#b0762a]"
            />
          </label>
        </div>

        <DialogFooter className="mt-2 gap-2">
          <DialogClose disabled={enviando} className="rounded-xl px-4 py-2 text-sm font-medium text-[#7d6c64]">Volver</DialogClose>
          <button
            onClick={() => void enviar()}
            disabled={enviando || !motivoOk}
            className="flex items-center justify-center gap-2 rounded-xl bg-[#b0762a] px-5 py-2 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-60"
          >
            {enviando ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
            {deshacer ? 'Deshacer' : 'Volver a abrir'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
