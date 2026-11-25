import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,
  devIndicators: false,
  async rewrites() {
    const origin = process.env.SIMP2M_API_ORIGIN ?? "http://127.0.0.1:8080";
    return [
      {
        source: "/api/v1/:path*",
        destination: new URL("/api/v1/:path*", origin).toString(),
      },
    ];
  },
};

export default nextConfig;
