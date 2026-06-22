/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    // `fallback` rewrites run AFTER static files, page files, AND dynamic
    // routes — critical so NextAuth's /api/auth/[...nextauth] catch-all
    // wins first. Only unmatched /api/* paths are proxied to the Fastify
    // backend, server-to-server.
    //
    // Uses API_PROXY_URL (server-only, NOT NEXT_PUBLIC_*) so the proxy
    // destination is NEVER baked into the browser bundle. The frontend
    // calls relative `/api/*` URLs, which means same-origin requests with
    // cookies — no CORS friction, no cookie domain mismatches when the
    // dashboard moves between domains (gam-web.onrender.com → app.gamtriq.com
    // → AWS later). Render forwards the cookie through the rewrite.
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
