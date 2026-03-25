import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Force Argentina timezone on serverless functions (Vercel runs in us-east)
  env: {
    TZ: 'America/Argentina/Tucuman',
  },
};

export default nextConfig;
