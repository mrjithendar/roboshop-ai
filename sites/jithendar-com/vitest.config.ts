import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    env: {
      CONTENT_DIR: path.resolve(import.meta.dirname, "tests/fixtures/content"),
      SITE_URL: "https://jithendar.com",
    },
  },
});
