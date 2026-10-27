import path from "node:path";

/** Fixed clock for every time-dependent test: 2026-10-27 12:00 UTC (17:30 IST). */
export const NOW = new Date("2026-10-27T12:00:00Z");
export const FIXTURES = path.resolve(import.meta.dirname, "fixtures/content");
export const REAL_CONTENT = path.resolve(import.meta.dirname, "../content");

export function validArticle(overrides: Record<string, unknown> = {}) {
  return {
    title: "A valid article title",
    slug: "a-valid-article",
    description: "A description that is comfortably longer than fifty characters for the schema.",
    author: "test-author",
    category: "kubernetes",
    tags: ["Kubernetes"],
    contentType: "tutorial",
    status: "published",
    publishedAt: "2026-10-20T09:00:00+05:30",
    ...overrides,
  };
}
