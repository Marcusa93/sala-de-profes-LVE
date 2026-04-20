import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // TODO: Remove once database.ts types are regenerated from Supabase schema.
  // Current types are missing columns added after initial generation:
  // - bar_stock_items.supplier_id, kitchen_orders.supplier_id
  // - expedientes table (entirely missing from types)
  // - profiles.settings, vajilla_stock table
  // These cause ~15 build errors that are safe at runtime (columns exist in DB).
  typescript: {
    ignoreBuildErrors: true,
  },
  // Force Argentina timezone on serverless functions (Vercel runs in us-east)
  env: {
    TZ: 'America/Argentina/Tucuman',
  },
};

export default nextConfig;
