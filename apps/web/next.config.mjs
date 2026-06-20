/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // `afterFiles` runs AFTER Next.js checks for its own routes, so
    // /api/auth/[...nextauth] still hits its own handler when SSO is enabled.
    // Every other /api/* URL is proxied through to the Fastify backend.
    //
    // This means the web bundle uses same-origin /api/* URLs — no CORS, no
    // hardcoded host. Works for localhost dev, tunnels, and prod deploys.
    return {
      afterFiles: [
        {
          source: '/api/:path*',
          destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
