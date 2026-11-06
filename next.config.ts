import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep the native SQLite driver's binding lookup in Node, outside the bundle.
  serverExternalPackages: ['@prisma/adapter-better-sqlite3', 'better-sqlite3'],
};

export default nextConfig;
