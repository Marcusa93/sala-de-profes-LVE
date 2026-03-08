import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  // If the user is not authenticated and tries to access a protected route
  // under the (app) group, redirect to /login
  const isProtectedRoute =
    pathname === '/' ||
    pathname.startsWith('/mi-turno') ||
    pathname.startsWith('/mis-horarios') ||
    pathname.startsWith('/equipo') ||
    pathname.startsWith('/notificaciones') ||
    pathname.startsWith('/proveedores') ||
    pathname.startsWith('/stock') ||
    pathname.startsWith('/alertas') ||
    pathname.startsWith('/configuracion') ||
    pathname.startsWith('/encargado')

  if (!user && isProtectedRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // If the user is authenticated and tries to access /login, redirect to /
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
