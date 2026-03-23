import type { AppRole } from '@/types/database'

/**
 * Roles with full management access (socio = superadmin, encargado = manager).
 * Use this everywhere instead of checking `role === 'encargado'` individually.
 */
const MANAGER_ROLES: ReadonlySet<string> = new Set(['socio', 'encargado'])

/** Can this role manage the business? (socio + encargado) */
export function isManagerOrAbove(role: string | AppRole | null | undefined): boolean {
  return !!role && MANAGER_ROLES.has(role)
}

/** Is this the highest role? (socio only) */
export function isSocio(role: string | AppRole | null | undefined): boolean {
  return role === 'socio'
}

/** Can this role access kitchen operations? */
export function isKitchenRole(role: string | AppRole | null | undefined): boolean {
  return !!role && (MANAGER_ROLES.has(role) || role === 'chef' || role === 'cocina')
}

/** Can this role create kitchen orders? */
export function canCreateKitchenOrders(role: string | AppRole | null | undefined): boolean {
  return !!role && (MANAGER_ROLES.has(role) || role === 'chef' || role === 'cocina')
}
