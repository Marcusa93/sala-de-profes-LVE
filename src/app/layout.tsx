import type { Metadata, Viewport } from 'next'
import { Barlow, Playfair_Display } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { RegisterSW } from '@/components/pwa/register-sw'
import './globals.css'

const barlow = Barlow({
  variable: '--font-barlow',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
})

const playfairDisplay = Playfair_Display({
  variable: '--font-playfair',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Sala de Profes — La Vieja Escuela',
  description: 'Gestión interna de La Vieja Escuela',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Sala de Profes',
  },
  other: {
    'apple-touch-icon': '/icons/icon-192.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#006d5a',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es">
      <body
        className={`${barlow.variable} ${playfairDisplay.variable} font-sans antialiased`}
      >
        <RegisterSW />
        {children}
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              borderRadius: '0.875rem',
              fontFamily: 'var(--font-barlow), sans-serif',
            },
          }}
        />
      </body>
    </html>
  )
}
