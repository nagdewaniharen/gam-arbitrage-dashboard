/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Use `fallback` — runs AFTER static files, page files, AND dynamic routes.
    // Critical for NextAuth: /api/auth/[...nextauth] is a dynamic route, so
    // `afterFiles` (which runs before dynamic routes) would hijack it before
    // NextAuth gets to handle it. `fallback` lets NextAuth match first; only
    // unmatched /api/* paths are proxied to the Fastify backend.
    return {
      fallback: [
        {
          source: '/api/:path*',
          destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
