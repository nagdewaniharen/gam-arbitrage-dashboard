import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Prisma's query-engine .node binary isn't traced by Next's bundler by
  // default. Keep Prisma external and explicitly include the generated client
  // (engine binaries) in the server output trace so Amplify's Lambda runtime
  // can locate the RHEL engine.
  serverExternalPackages: ['@prisma/client', '@gam/db'],
  outputFileTracingIncludes: {
    '/**': [
      '../../packages/db/src/generated/client/**/*.node',
    ],
  },
  env: {
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    AUTH_SECRET: process.env.AUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    AUTH_URL: process.env.AUTH_URL,
    AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST,
    ALLOWED_GOOGLE_DOMAIN: process.env.ALLOWED_GOOGLE_DOMAIN,
    BOOTSTRAP_ADMIN_EMAIL: process.env.BOOTSTRAP_ADMIN_EMAIL,
    DATABASE_URL: process.env.DATABASE_URL,
  },
  async rewrites() {
    const apiBase = process.env.API_PROXY_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    return {
      fallback: [
        {
          source: '/api/:path*',
          destination: `${apiBase}/api/:path*`,
        },
      ],
    };
  },
};
export default nextConfig;
