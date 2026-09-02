/** @type {import('next').NextConfig} */
const backendApiUrl = process.env.BACKEND_API_URL || "http://localhost:8000";

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/api/backend/:path*", destination: `${backendApiUrl}/api/v1/:path*` }];
  },
};
module.exports = nextConfig;
