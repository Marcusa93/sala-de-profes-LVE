'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { Plus, Search, FolderOpen, X } from 'lucide-react'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { ExpedienteCard } from '@/components/expedientes/ExpedienteCard'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { EXPEDIENTE_TYPES } from '@/lib/constants/expedientes'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/motion'
import type { ExpedienteWithPeople } from '@/types/expedientes'

const STATUS_TABS = [
  { key: 'activos', label: 'Activos' },
  { key: 'todos', label: 'Todos' },
  { key: 'cerrados', label: 'Cerrados' },
] as const

export default function ExpedientesPage() {
  const { profile } = useProfileContext()
  const [expedientes, setExpedientes] = useState<ExpedienteWithPeople[]>([])
  const [loading, setLoading] = useState(true)
  const [statusTab, setStatusTab] = useState<string>('activos')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Debounce search — 350ms
  useEffect(() => {
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(debounceRef.current)
  }, [search])

  const fetchExpedientes = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusTab) params.set('status', statusTab)
      if (typeFilter) params.set('type', typeFilter)
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())

      const res = await fetch(`/api/expedientes?${params}`)
      const json = await res.json()
      setExpedientes(json.data ?? [])
    } catch {
      setExpedientes([])
    } finally {
      setLoading(false)
    }
  }, [statusTab, typeFilter, debouncedSearch])

  useEffect(() => { fetchExpedientes() }, [fetchExpedientes])

  const isSocioOrEncargado = profile?.role === 'socio' || profile?.role === 'encargado'
  const hasActiveFilters = typeFilter || debouncedSearch

  const clearFilters = () => {
    setSearch('')
    setDebouncedSearch('')
    setTypeFilter('')
  }

  return (
    <FadeIn className="px-5 pb-28 pt-6">
      {/* Header */}
      <div className="mb-1">
        <h1 className="font-display text-2xl font-bold text-foreground">
          {isSocioOrEncargado ? 'Expedientes' : 'Mis Propuestas'}
        </h1>
        <p className="mt-0.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {isSocioOrEncargado ? 'Gestión interna de proyectos y tareas' : 'Ideas, propuestas y seguimiento'}
        </p>
      </div>

      {/* Status tabs */}
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusTab(tab.key)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
              statusTab === tab.key
                ? 'bg-[#006d5a] text-white'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search + type filter */}
      <div className="mt-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <label className="sr-only" htmlFor="exp-search">Buscar expediente</label>
          <input
            id="exp-search"
            type="text"
            placeholder="Buscar por título o código..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-xl border border-border bg-background pl-9 pr-8 text-sm placeholder:text-muted-foreground focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 hover:bg-muted"
              aria-label="Limpiar búsqueda"
            >
              <X className="size-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
        <label className="sr-only" htmlFor="exp-type-filter">Filtrar por tipo</label>
        <select
          id="exp-type-filter"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-9 rounded-xl border border-border bg-background px-2 text-xs font-medium text-foreground focus:border-[#006d5a] focus:outline-none"
        >
          <option value="">Todos los tipos</option>
          {Object.entries(EXPEDIENTE_TYPES).map(([key, config]) => (
            <option key={key} value={key}>
              {config.icon} {config.label}
            </option>
          ))}
        </select>
      </div>

      {/* Results count + clear */}
      {!loading && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {expedientes.length} expediente{expedientes.length !== 1 ? 's' : ''}
            {expedientes.length >= 100 && <span className="text-[#d4943a]"> (máximo alcanzado)</span>}
          </span>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="text-[#006d5a] font-semibold hover:underline">
              Limpiar filtros
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <LoadingState />
      ) : expedientes.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="Sin expedientes"
          description={
            hasActiveFilters
              ? 'No se encontraron resultados. Probá limpiando los filtros.'
              : 'Creá tu primer expediente con el botón +'
          }
        />
      ) : (
        <StaggerList className="mt-2 space-y-3">
          {expedientes.map((exp) => (
            <StaggerItem key={exp.id}>
              <ExpedienteCard expediente={exp} />
            </StaggerItem>
          ))}
        </StaggerList>
      )}

      {/* FAB */}
      <Link
        href="/expedientes/nuevo"
        aria-label="Crear nuevo expediente"
        className="fixed bottom-24 right-5 z-30 flex size-14 items-center justify-center rounded-2xl bg-[#006d5a] text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
      >
        <Plus className="size-6" />
      </Link>
    </FadeIn>
  )
}
