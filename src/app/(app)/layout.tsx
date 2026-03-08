import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProfileProvider } from '@/lib/hooks/use-profile'
import { TopBar } from '@/components/layout/TopBar'
import { BottomNav } from '@/components/layout/BottomNav'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <ProfileProvider>
      <div className="flex min-h-svh flex-col bg-background">
        <TopBar />
        <main className="flex-1 overflow-y-auto px-4 pb-20 pt-4">
          {children}
        </main>
        <BottomNav />
      </div>
    </ProfileProvider>
  )
}
