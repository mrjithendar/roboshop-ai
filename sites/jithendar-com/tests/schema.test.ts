import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "@/lib/content/frontmatter";
import { articleFrontmatter, collectionSchema } from "@/lib/content/schema";
import { validArticle } from "./helpers";

function issues(input: unknown) {
  const result = articleFrontmatter.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

describe("article frontmatter schema", () => {
  it("accepts a valid article and normalizes tags", () => {
    const parsed = articleFrontmatter.parse(validArticle({ tags: ["GitOps", "gitops", " ArgoCD "] }));
    expect(parsed.tags).toEqual(["gitops", "argocd"]);
    expect(parsed.publishedAt).toBe("2026-10-20T09:00:00+05:30");
  });

  it.each([
    ["title too short", { title: "Too short" }, "title"],
    ["title too long", { title: "x".repeat(111) }, "title"],
    ["description too short", { description: "Short." }, "description"],
    ["description too long", { description: "x".repeat(161) }, "description"],
    ["non-kebab slug", { slug: "Not_Kebab" }, "slug"],
    ["unknown category", { category: "gardening" }, "category"],
    ["date without offset", { publishedAt: "2026-10-20T09:00:00" }, "publishedAt"],
    ["date only", { publishedAt: "2026-10-20" }, "publishedAt"],
    ["published without publishedAt", { publishedAt: undefined }, "publishedAt"],
    ["updatedAt before publishedAt", { updatedAt: "2026-10-19T09:00:00+05:30" }, "updatedAt"],
    ["news without sources", { contentType: "news" }, "sources"],
    ["curated without sources", { contentType: "curated" }, "sources"],
    ["sponsored without sponsor", { sponsored: true }, "sponsor"],
    ["image without alt", { featuredImage: { src: "/a.png", alt: "", width: 1, height: 1 } }, "featuredImage.alt"],
    ["http canonical", { canonicalUrl: "http://example.com/a" }, "canonicalUrl"],
    ["unknown field", { summary: "typo-prone extra key" }, ""],
  ])("rejects %s", (_name, override, path) => {
    const found = issues(validArticle(override));
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((i) => i.startsWith(`${path}:`))).toBe(true);
  });

  it("allows drafts without a publish date", () => {
    expect(issues(validArticle({ status: "draft", publishedAt: undefined }))).toEqual([]);
  });

  it("enforces which content types each collection accepts", () => {
    expect(collectionSchema("projects").safeParse(validArticle()).success).toBe(false);
    expect(collectionSchema("blog").safeParse(validArticle()).success).toBe(true);
    expect(collectionSchema("news").safeParse(validArticle()).success).toBe(false);
  });
});

describe("frontmatter parsing", () => {
  it("keeps timestamps as strings with their offset", () => {
    const { data, body } = splitFrontmatter('---\npublishedAt: 2026-10-27T10:00:00+05:30\n---\nHello');
    expect(data).toEqual({ publishedAt: "2026-10-27T10:00:00+05:30" });
    expect(body).toBe("Hello");
  });

  it("rejects files without frontmatter", () => {
    expect(() => splitFrontmatter("No frontmatter")).toThrow(/frontmatter/);
  });
});
