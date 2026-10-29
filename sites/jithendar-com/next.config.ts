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
    // The transformation pipeline: next/image (sharp, inside the site's pods) resizes and re-encodes our
    // own files only; R2 stores originals and never transforms anything. Requests are bounded:
    // - sources: only /images/** (shipped with the site) and /media/** (uploads) — never arbitrary URLs;
    // - widths: only the sizes below (srcset candidates), one quality, two formats → ≤ 20 variants per image;
    // - originals over maximumResponseBody are refused; redirects are not followed;
    // - variants are cached on disk (LRU, capped below the pod's 256 MiB emptyDir) for 30 days.
    localPatterns: [{ pathname: "/images/**" }, { pathname: "/media/**" }],
    formats: ["image/avif", "image/webp"],
    qualities: [75],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [96, 128, 256, 384],
    maximumResponseBody: 12_000_000,
    maximumRedirects: 0,
    maximumDiskCacheSize: 200_000_000,
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  // src/proxy.ts strips trailing slashes itself, after answering 410 for gone URLs in one hop.
  skipTrailingSlashRedirect: true,
  reactStrictMode: true,
  // This app lives inside the roboshop-ai monorepo; keep tracing and Turbopack scoped to it.
  outputFileTracingRoot: siteRoot,
  turbopack: { root: siteRoot },
  // Content is read from disk at request time (sitemaps, ISR), so ship it with the server.
  // Content is the one-time import source for /setup; migrations run at server start (instrumentation.ts).
  outputFileTracingIncludes: { "/**/*": [path.join("content", "**", "*"), path.join("src", "db", "migrations", "**", "*")] },
  // Pods run with a read-only root filesystem, and Next 16 writes regenerated ISR pages into
  // .next/server (route-cache) next to the build output. Keep the ISR cache in memory instead:
  // content ships inside the image, so a restarted pod simply regenerates pages on demand.
  // Server actions accept image uploads up to 10 MB (plus multipart overhead); larger files
  // (video, audio, PDF) go straight to R2 with presigned URLs and never pass through the app.
  experimental: { isrFlushToDisk: false, serverActions: { bodySizeLimit: "11mb" } },
  // ssh2 (SFTP backups) ships optional native add-ons; PGlite (local dev only) loads its WASM from a
  // file URL that bundling breaks. Load both from node_modules instead of bundling.
  serverExternalPackages: ["ssh2", "ssh2-sftp-client", "cpu-features", "@electric-sql/pglite"],
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
          // HTTPS only (Traefik redirects http → https). No includeSubDomains/preload: other hosts are not ours to commit.
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
      // Pages may not be framed by other sites; editor previews may be framed by the editor itself.
      { source: "/((?!preview/).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] },
      { source: "/preview/:path*", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }, { key: "Cache-Control", value: "private, no-store" }] },
      // Per-user responses are never stored by browsers' shared caches or any proxy.
      { source: "/account/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: "/account", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: "/api/auth/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default nextConfig;
