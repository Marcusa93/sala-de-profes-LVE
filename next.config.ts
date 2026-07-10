import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // TODO: Remove once the remaining ~190 type errors are fixed.
  // database.ts ya se regeneró desde el esquema real (2026-07-10); los errores
  // que quedan son discrepancias reales código↔esquema, no tipos faltantes.
  typescript: {
    ignoreBuildErrors: true,
  },
  // Force Argentina timezone on serverless functions (Vercel runs in us-east)
  env: {
    TZ: 'America/Argentina/Tucuman',
  },
};

export default nextConfig;
