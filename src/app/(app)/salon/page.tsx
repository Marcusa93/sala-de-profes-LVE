'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  Clock, AlertTriangle, CheckCircle, Bell, BellOff,
  RefreshCw, Loader2, Users, Coffee, UtensilsCrossed,
} from 'lucide-react'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { FadeIn } from '@/components/ui/motion'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TableData = {
  saleId: string
  tableNumber: number | null
  saleType: string
  state: string
  total: number
  people: number | null
  createdAt: string
  minutes: number
  semaphore: 'green' | 'yellow' | 'red' | 'critical'
}

type Counts = {
  total: number
  green: number
  yellow: number
  red: number
  critical: number
}

const SEMAPHORE = {
  green: { label: 'Normal', color: '#006d5a', bg: '#e8f5f1', border: '#006d5a', icon: '🟢' },
  yellow: { label: 'Atención', color: '#d4943a', bg: '#fdf6ec', border: '#d4943a', icon: '🟡' },
  red: { label: 'Demora', color: '#ea504c', bg: '#fef2f2', border: '#ea504c', icon: '🔴' },
  critical: { label: 'Urgente', color: '#b91c1c', bg: '#fef2f2', border: '#b91c1c', icon: '🚨' },
}

const REFRESH_INTERVAL = 30_000 // 30 seconds

// ---------------------------------------------------------------------------
// Alarm Sound
// ---------------------------------------------------------------------------

function playTableAlarm() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const playTone = (start: number, freq: number, dur: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = freq
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.2, start)
      gain.gain.exponentialRampToValueAtTime(0.01, start + dur)
      osc.start(start)
      osc.stop(start + dur)
    }
    // Two-tone alert: ding-dong
    playTone(ctx.currentTime, 660, 0.2)
    playTone(ctx.currentTime + 0.25, 880, 0.3)
  } catch { /* silent */ }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SalonPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [tables, setTables] = useState<TableData[]>([])
  const [counts, setCounts] = useState<Counts>({ total: 0, green: 0, yellow: 0, red: 0, critical: 0 })
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [alarmsEnabled, setAlarmsEnabled] = useState(true)
  const prevRedCountRef = useRef(0)

  const canView = ['runner', 'encargado', 'socio'].includes(profile?.role ?? '')

  const fetchData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setSyncing(true)
    try {
      const res = await fetch('/api/salon')
      const data = await res.json()
      if (data.tables) {
        setTables(data.tables)
        setCounts(data.counts)
        setLastUpdate(data.timestamp)

        // Play alarm if new red/critical tables appeared
        if (alarmsEnabled) {
          const redTables = (data.tables as TableData[]).filter(
            t => (t.semaphore === 'red' || t.semaphore === 'critical') && !dismissed.has(t.saleId)
          )
          if (redTables.length > prevRedCountRef.current) {
            playTableAlarm()
          }
          prevRedCountRef.current = redTables.length
        }
      }
    } catch { /* silent */ }
    setLoading(false)
    setSyncing(false)
  }, [alarmsEnabled, dismissed])

  // Poll every 30 seconds
  useEffect(() => {
    if (!canView || profileLoading) return
    fetchData()
    const interval = setInterval(() => fetchData(), REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [canView, profileLoading, fetchData])

  const handleDismiss = (saleId: string) => {
    setDismissed(prev => new Set(prev).add(saleId))
  }

  if (profileLoading || loading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="size-6 animate-spin text-[#a39e97]" /></div>
  }

  if (!canView) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <UtensilsCrossed className="size-10 text-[#ebe6df]" />
        <p className="mt-4 text-sm font-medium text-[#a39e97]">Vista no disponible para tu rol</p>
      </div>
    )
  }

  const formatPrice = (n: number) => n > 0 ? `$${(n / 1000).toFixed(0)}k` : '$0'

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-28">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">Salón</h1>
            <p className="section-label mt-0.5">
              {counts.total} mesa{counts.total !== 1 ? 's' : ''} activa{counts.total !== 1 ? 's' : ''}
              {lastUpdate && ` · ${format(new Date(lastUpdate), 'HH:mm')}`}
            </p>
          </div>
          <div className="flex gap-1.5">
            {/* Toggle alarms */}
            <button
              onClick={() => setAlarmsEnabled(!alarmsEnabled)}
              className={`flex size-10 items-center justify-center rounded-xl transition-colors ${
                alarmsEnabled ? 'bg-[#fef2f2] text-[#ea504c]' : 'bg-[#f3efe9] text-[#a39e97]'
              }`}
              title={alarmsEnabled ? 'Alarmas activadas' : 'Alarmas silenciadas'}
            >
              {alarmsEnabled ? <Bell className="size-4" /> : <BellOff className="size-4" />}
            </button>
            {/* Refresh */}
            <button
              onClick={() => fetchData(true)}
              disabled={syncing}
              className="flex size-10 items-center justify-center rounded-xl bg-[#e8f5f1] text-[#006d5a] disabled:opacity-50"
            >
              {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            </button>
          </div>
        </div>
      </FadeIn>

      {/* Semaphore summary */}
      <FadeIn delay={0.05}>
        <div className="flex gap-2">
          {(['critical', 'red', 'yellow', 'green'] as const).map(level => {
            const s = SEMAPHORE[level]
            const count = counts[level]
            return (
              <div
                key={level}
                className="flex flex-1 flex-col items-center justify-center rounded-xl py-2.5"
                style={{ backgroundColor: count > 0 ? s.bg : '#f8f5f0' }}
              >
                <span className="text-sm">{s.icon}</span>
                <span
                  className="mt-0.5 text-lg font-bold tabular-nums"
                  style={{ color: count > 0 ? s.color : '#a39e97' }}
                >
                  {count}
                </span>
                <span className="text-[8px] font-semibold uppercase tracking-wider" style={{ color: count > 0 ? s.color : '#a39e97' }}>
                  {s.label}
                </span>
              </div>
            )
          })}
        </div>
      </FadeIn>

      {/* Table cards */}
      {tables.length === 0 ? (
        <FadeIn delay={0.1}>
          <div className="flex flex-col items-center py-12 text-center">
            <Coffee className="size-10 text-[#ebe6df]" />
            <p className="mt-4 text-sm font-medium text-[#a39e97]">Sin mesas abiertas</p>
            <p className="mt-1 text-xs text-[#a39e97]/70">Las mesas activas de Fudo aparecerán acá</p>
          </div>
        </FadeIn>
      ) : (
        <div className="space-y-2">
          {tables.map(table => {
            const s = SEMAPHORE[table.semaphore]
            const isDismissed = dismissed.has(table.saleId)
            const isAlert = (table.semaphore === 'red' || table.semaphore === 'critical') && !isDismissed
            const isTakeaway = table.saleType === 'TAKEAWAY'

            return (
              <FadeIn key={table.saleId}>
                <div
                  className={`rounded-xl border overflow-hidden transition-all ${
                    isAlert ? 'ring-2 shadow-md' : ''
                  } ${isDismissed ? 'opacity-60' : ''}`}
                  style={{
                    borderLeftWidth: 4,
                    borderLeftColor: s.border,
                    ...(isAlert ? { ringColor: s.color + '40' } : {}),
                  }}
                >
                  <div className="flex items-center gap-3 bg-card px-4 py-3">
                    {/* Table number */}
                    <div
                      className="flex size-12 shrink-0 flex-col items-center justify-center rounded-xl text-white"
                      style={{ backgroundColor: s.color }}
                    >
                      {isTakeaway ? (
                        <>
                          <Coffee className="size-4" />
                          <span className="text-[7px] font-bold mt-0.5">TAKE</span>
                        </>
                      ) : (
                        <>
                          <span className="text-lg font-bold tabular-nums leading-none">
                            {table.tableNumber ?? '?'}
                          </span>
                          <span className="text-[7px] font-semibold mt-0.5">MESA</span>
                        </>
                      )}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-[#3d2c24]">
                          {table.minutes} min
                        </span>
                        <span
                          className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                          style={{ color: s.color, backgroundColor: s.bg }}
                        >
                          {s.label}
                        </span>
                        {table.state === 'PAYMENT-PROCESS' && (
                          <span className="rounded-full bg-[#eef4fc] px-2 py-0.5 text-[9px] font-bold text-[#4a90d9]">
                            Por cobrar
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#a39e97]">
                        <span>{formatPrice(table.total)}</span>
                        {table.people && <span>· {table.people} pers.</span>}
                        <span>· {format(new Date(table.createdAt), 'HH:mm')}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    {isAlert && (
                      <button
                        onClick={() => handleDismiss(table.saleId)}
                        className="flex shrink-0 items-center gap-1 rounded-lg bg-[#006d5a] px-2.5 py-1.5 text-[10px] font-bold text-white active:scale-95"
                      >
                        <CheckCircle className="size-3" />
                        Avisé
                      </button>
                    )}
                    {isDismissed && (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-[#006d5a]">
                        <CheckCircle className="size-3" />
                        Avisado
                      </span>
                    )}
                  </div>

                  {/* Critical warning bar */}
                  {table.semaphore === 'critical' && !isDismissed && (
                    <div className="flex items-center gap-2 bg-[#b91c1c] px-4 py-1.5 text-[10px] font-bold text-white animate-pulse">
                      <AlertTriangle className="size-3" />
                      Demora crítica — intervención necesaria
                    </div>
                  )}
                </div>
              </FadeIn>
            )
          })}
        </div>
      )}
    </div>
  )
}
