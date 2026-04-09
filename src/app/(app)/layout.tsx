import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SWRProvider } from '@/lib/swr/provider'
import { ProfileProvider } from '@/lib/hooks/use-profile'
import { TopBar } from '@/components/layout/TopBar'
import { BottomNav } from '@/components/layout/BottomNav'
import { PageTransition } from '@/components/layout/PageTransition'
import { FloatingChat } from '@/components/chat/FloatingChat'
import { ForcePasswordChange } from '@/components/auth/ForcePasswordChange'
import { AnnouncementPopup } from '@/components/notifications/AnnouncementPopup'
import { KitchenAlarms } from '@/components/kitchen/KitchenAlarms'
import { InstallPrompt } from '@/components/pwa/InstallPrompt'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'

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
    <SWRProvider>
      <ProfileProvider>
        <div className="flex min-h-svh flex-col bg-background">
          <TopBar />
          <main className="flex-1 overflow-y-auto px-4 pb-24 pt-5 sm:px-6">
            <ErrorBoundary>
              <PageTransition>{children}</PageTransition>
            </ErrorBoundary>
          </main>
          <BottomNav />
          <FloatingChat />
          <ForcePasswordChange />
          <AnnouncementPopup />
          <KitchenAlarms />
          <InstallPrompt />
        </div>
      </ProfileProvider>
    </SWRProvider>
  )
}
