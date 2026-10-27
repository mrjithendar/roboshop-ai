import path from "node:path";
import type { NextConfig } from "next";
import { redirects } from "./src/config/redirects";

const siteRoot = import.meta.dirname;

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // src/proxy.ts strips trailing slashes itself, after answering 410 for gone URLs in one hop.
  skipTrailingSlashRedirect: true,
  reactStrictMode: true,
  // This app lives inside the roboshop-ai monorepo; keep tracing and Turbopack scoped to it.
  outputFileTracingRoot: siteRoot,
  turbopack: { root: siteRoot },
  // Content is read from disk at request time (sitemaps, ISR), so ship it with the server.
  outputFileTracingIncludes: { "/**/*": [path.join("content", "**", "*")] },
  async redirects() {
    return redirects.map(({ source, destination }) => ({ source, destination, permanent: true }));
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
