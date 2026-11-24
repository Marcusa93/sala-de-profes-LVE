import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El deploy de la VPS compila en la carpeta que no está en uso
  // (NEXT_DIST_DIR=.next-a / .next-b) y recién al final la elige: la app sigue
  // andando mientras compila. En Vercel y en local queda .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  turbopack: {
    root: path.resolve(__dirname),
  },
  // 2026-07-15: quedan ~155 errores de tipos legacy (recharts formatters,
  // logAudit params, páginas admin). Bajarlos a 0 y borrar este bloque.
  typescript: {
    ignoreBuildErrors: true,
  },
  // El PDF de la liquidación (@react-pdf) se carga tal cual en el servidor:
  // sus paquetes solo exponen ESM y no se llevan bien con el empaquetado.
  serverExternalPackages: ['@react-pdf/renderer'],
  // La pantalla de permiso del conector no se puede meter en un iframe de otro sitio
  async headers() {
    return [{
      source: '/mcp/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        // same-origin y no no-referrer: con no-referrer el navegador manda Origin "null"
        // al tocar Permitir y el control de origen lo rechazaba
        { key: 'Referrer-Policy', value: 'same-origin' },
      ],
    }]
  },
  // Force Argentina timezone on serverless functions (Vercel runs in us-east)
  env: {
    TZ: 'America/Argentina/Tucuman',
  },
};

export default nextConfig;
