'use client'

import { useEffect, useState, useCallback } from 'react'
import { format, subDays, addDays, isToday } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { BarChart3, ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { isManagerOrAbove } from '@/lib/roles'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { FadeIn, AnimatedSwitch, motion } from '@/components/ui/motion'
import type { DashboardData } from './_components/types'
import { CompareView } from './_components/CompareView'
import { MonthView } from './_components/MonthView'
import { DayView } from './_components/DayView'
import { BalanceView } from './_components/BalanceView'
import { CartaView } from './_components/CartaView'

const REFRESH_INTERVAL = 5 * 60 * 1000

export default function VentasPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [viewMode, setViewMode] = useState<'dia' | 'mes' | 'comparar' | 'balance' | 'carta'>('dia')
  const [compareDate, setCompareDate] = useState<Date>(subDays(new Date(), 1))
  const [compareData, setCompareData] = useState<DashboardData | null>(null)
  const [loadingCompare, setLoadingCompare] = useState(false)

  const isLive = isToday(selectedDate)
  const dateStr = format(selectedDate, 'yyyy-MM-dd')
  const isManager = isManagerOrAbove(profile?.role)
  const modes = isManager ? (['dia', 'comparar', 'mes', 'balance', 'carta'] as const) : (['dia', 'comparar', 'mes'] as const)
  const MODE_LABELS: Record<string, string> = { dia: 'Día', comparar: 'Comparar', mes: 'Mes', balance: 'Balance', carta: 'Carta' }

  const fetchData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setSyncing(true)
    try {
      const url = isLive ? '/api/fudo/auto-sync' : `/api/fudo/auto-sync?date=${dateStr}`
      const res = await fetch(url, { credentials: 'include' })
      const json = await res.json()
      if (json.today) {
        setData(json.today)
        setLastSync(json.lastSync)
      }
    } catch { /* ignore */ }
    setLoading(false)
    setSyncing(false)
  }, [dateStr, isLive])

  const fetchCompare = useCallback(async () => {
    setLoadingCompare(true)
    try {
      const ds = format(compareDate, 'yyyy-MM-dd')
      const res = await fetch(`/api/fudo/auto-sync?date=${ds}`)
      const json = await res.json()
      setCompareData(json.today ?? null)
    } catch { setCompareData(null) }
    setLoadingCompare(false)
  }, [compareDate])

  useEffect(() => {
    if (profileLoading) return
    fetchData()
    if (isLive) {
      const interval = setInterval(() => fetchData(), REFRESH_INTERVAL)
      return () => clearInterval(interval)
    }
  }, [profileLoading, fetchData, isLive])

  useEffect(() => {
    if (viewMode === 'comparar') {
      fetchData()
      fetchCompare()
    }
  }, [viewMode, fetchCompare, fetchData])

  if (profileLoading || loading) return <LoadingState />
  if (!data) return (
    <EmptyState icon={BarChart3} title="Sin datos de ventas" description="Fudo no devolvió ventas. Verificá la conexión." />
  )

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-28">
      <FadeIn>
        {/* View mode toggle */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#3d2c24]">Ventas</h1>
          <div className="flex rounded-full bg-secondary p-0.5 shadow-inner">
            {modes.map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className="relative rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors"
              >
                {viewMode === mode && (
                  <motion.span
                    layoutId="ventas-mode-pill"
                    className="absolute inset-0 rounded-full bg-[#006d5a] shadow-sm"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
                <span className={`relative z-10 transition-colors ${viewMode === mode ? 'text-white' : 'text-muted-foreground'}`}>
                  {MODE_LABELS[mode]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Date navigator — hidden in compare, balance & carta modes */}
        {viewMode !== 'comparar' && viewMode !== 'balance' && viewMode !== 'carta' && (
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                setSelectedDate(prev => viewMode === 'mes' ? new Date(prev.getFullYear(), prev.getMonth() - 1, 1) : subDays(prev, 1))
                setLoading(true)
              }}
              className="icon-btn flex items-center justify-center rounded-xl bg-secondary"
            >
              <ChevronLeft className="size-4" />
            </button>
            <div className="text-center">
              <p className="text-sm font-semibold capitalize text-[#3d2c24]">
                {viewMode === 'dia'
                  ? format(selectedDate, "EEEE d 'de' MMMM", { locale: es })
                  : format(selectedDate, 'MMMM yyyy', { locale: es })
                }
              </p>
              {isLive && viewMode === 'dia' && (
                <p className="text-[10px] font-semibold text-[#006d5a]">
                  En vivo {lastSync && `· ${format(new Date(lastSync), 'HH:mm')}`}
                </p>
              )}
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  setSelectedDate(prev => viewMode === 'mes' ? new Date(prev.getFullYear(), prev.getMonth() + 1, 1) : addDays(prev, 1))
                  setLoading(true)
                }}
                disabled={isLive && viewMode === 'dia'}
                className="icon-btn flex items-center justify-center rounded-xl bg-secondary disabled:opacity-30"
              >
                <ChevronRight className="size-4" />
              </button>
              {!isLive && viewMode === 'dia' && (
                <button
                  onClick={() => { setSelectedDate(new Date()); setLoading(true) }}
                  className="flex items-center gap-1 rounded-full bg-[#006d5a] px-2.5 py-1.5 text-[10px] font-bold text-white"
                >
                  Hoy
                </button>
              )}
              {isLive && (
                <button
                  onClick={() => fetchData(true)}
                  disabled={syncing}
                  className="icon-btn flex items-center justify-center rounded-xl bg-[#e8f5f1] disabled:opacity-50"
                >
                  {syncing ? <Loader2 className="size-3.5 animate-spin text-[#006d5a]" /> : <RefreshCw className="size-3.5 text-[#006d5a]" />}
                </button>
              )}
            </div>
          </div>
        )}
      </FadeIn>

      <AnimatedSwitch id={viewMode}>
        <div className="space-y-4">
          {viewMode === 'comparar' && (
            <CompareView
              data={data}
              compareData={compareData}
              selectedDate={selectedDate}
              compareDate={compareDate}
              setSelectedDate={(d) => { setSelectedDate(d); setLoading(true) }}
              setCompareDate={setCompareDate}
              loadingCompare={loadingCompare}
              onFetch={() => { fetchData(); fetchCompare() }}
            />
          )}

          {viewMode === 'mes' && (
            <MonthView
              selectedDate={selectedDate}
              setSelectedDate={(d) => { setSelectedDate(d); setViewMode('dia'); setLoading(true) }}
            />
          )}

          {viewMode === 'dia' && (
            <DayView data={data} selectedDate={selectedDate} isLive={isLive} />
          )}

          {viewMode === 'balance' && isManager && <BalanceView />}

          {viewMode === 'carta' && isManager && <CartaView />}
        </div>
      </AnimatedSwitch>
    </div>
  )
}
