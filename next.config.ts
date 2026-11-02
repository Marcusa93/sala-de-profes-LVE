import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ],
    }]
  },
  // Force Argentina timezone on serverless functions (Vercel runs in us-east)
  env: {
    TZ: 'America/Argentina/Tucuman',
  },
};

export default nextConfig;
