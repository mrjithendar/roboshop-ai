import path from "node:path";
import type { NextConfig } from "next";
import { redirects } from "./src/config/redirects";

const siteRoot = import.meta.dirname;

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Traefik compresses responses (br/zstd/gzip, text only; see deploy/production/middlewares.yaml).
  compress: false,
  images: {
    // Optimise only our own files: the optimiser cannot be used to resize arbitrary URLs.
    localPatterns: [{ pathname: "/images/**" }, { pathname: "/media/**" }],
    formats: ["image/avif", "image/webp"],
    qualities: [75],
    // Optimised variants are cached in .next/cache/images (a writable emptyDir in the pod).
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  // src/proxy.ts strips trailing slashes itself, after answering 410 for gone URLs in one hop.
  skipTrailingSlashRedirect: true,
  reactStrictMode: true,
  // This app lives inside the roboshop-ai monorepo; keep tracing and Turbopack scoped to it.
  outputFileTracingRoot: siteRoot,
  turbopack: { root: siteRoot },
  // Content is read from disk at request time (sitemaps, ISR), so ship it with the server.
  outputFileTracingIncludes: { "/**/*": [path.join("content", "**", "*")] },
  // Pods run with a read-only root filesystem, and Next 16 writes regenerated ISR pages into
  // .next/server (route-cache) next to the build output. Keep the ISR cache in memory instead:
  // content ships inside the image, so a restarted pod simply regenerates pages on demand.
  experimental: { isrFlushToDisk: false },
  async redirects() {
    return redirects.map(({ source, destination }) => ({ source, destination, permanent: true }));
  },
  async headers() {
    return [
      {
        // Uploaded originals: cache for a day, revalidate in the background for a week.
        source: "/images/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
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
