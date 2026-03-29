'use client'

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types/database'

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type UseProfileReturn = {
  profile: Profile | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useProfile(): UseProfileReturn {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const supabase = createClient()

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError) {
        throw userError
      }

      if (!user) {
        setProfile(null)
        return
      }

      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, role, avatar_url, phone, is_active, settings, created_at, updated_at')
        .eq('id', user.id)
        .single()

      if (profileError) {
        throw profileError
      }

      setProfile(data)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al cargar el perfil'
      setError(message)
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  return { profile, loading, error, refresh: fetchProfile }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type ProfileContextValue = UseProfileReturn

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined)

export { ProfileContext }

type ProfileProviderProps = {
  children: ReactNode
}

export function ProfileProvider({ children }: ProfileProviderProps) {
  const profileValue = useProfile()

  return (
    <ProfileContext.Provider value={profileValue}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfileContext(): ProfileContextValue {
  const context = useContext(ProfileContext)

  if (context === undefined) {
    throw new Error(
      'useProfileContext must be used within a ProfileProvider',
    )
  }

  return context
}
