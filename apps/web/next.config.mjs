/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Inline server-side env into the build so Amplify's SSR runtime can read them.
  // Amplify console env vars don't reach the SSR Lambda at runtime, and a
  // build-time .env.production isn't picked up either — so we bake them here.
  // None are NEXT_PUBLIC_*, so they stay in the server bundle, not the browser.
  env: {
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    AUTH_SECRET: process.env.AUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
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
