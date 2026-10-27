import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tagSlug } from "@/config/taxonomy";
import {
  getPublishedArticle,
  getPublishedContent,
  isTaxonomyIndexable,
  paginate,
  parsePageParam,
  publishedTags,
  readingTimeMinutes,
  relatedArticles,
} from "@/lib/content";
import { loadContent } from "@/lib/content/load";
import { articleFrontmatter } from "@/lib/content/schema";
import { compileMdx } from "@/lib/mdx/compile";
import { buildRss } from "@/lib/seo/feed";
import { buildSearchIndex, searchEntries } from "@/lib/seo/search-index";
import { FIXTURES, NOW, validArticle } from "./helpers";

const q = { now: NOW, root: FIXTURES, preview: false };

afterEach(() => vi.unstubAllEnvs());

describe("pagination", () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  it("slices pages and reports totals", () => {
    expect(paginate(items, 1, 10)).toEqual({ items: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], page: 1, totalPages: 3 });
    expect(paginate(items, 3, 10)?.items).toEqual([20, 21, 22, 23, 24]);
  });
  it("rejects out-of-range pages but always has page 1", () => {
    expect(paginate(items, 4, 10)).toBeUndefined();
    expect(paginate(items, 0, 10)).toBeUndefined();
    expect(paginate([], 1, 10)).toEqual({ items: [], page: 1, totalPages: 1 });
  });
  it("accepts only canonical page numbers >= 2 in URLs", () => {
    expect(parsePageParam("2")).toBe(2);
    for (const bad of ["1", "0", "02", "-1", "2.5", "abc", ""]) expect(parsePageParam(bad)).toBeUndefined();
  });
});

describe("taxonomy indexability", () => {
  it("requires at least 3 items and an intro", () => {
    expect(isTaxonomyIndexable(3, "Intro text")).toBe(true);
    expect(isTaxonomyIndexable(2, "Intro text")).toBe(false);
    expect(isTaxonomyIndexable(10, "")).toBe(false);
    expect(isTaxonomyIndexable(10, undefined)).toBe(false);
  });
  it("lists only tags of published content, with slugs", () => {
    const tags = publishedTags(q).map((t) => t.slug);
    expect(tags).toEqual(expect.arrayContaining(["kubernetes", "release", "gitops", "argocd"]));
    expect(tagSlug("Argo CD")).toBe("argo-cd");
    expect(tagSlug("Next.js")).toBe("nextjs");
  });
});

describe("related articles", () => {
  it("scores by category, related category and tags, deterministically, without drafts", () => {
    const tutorial = getPublishedArticle("blog", "published-tutorial", q)!;
    const first = relatedArticles(tutorial, 3, q).map((a) => a.path);
    expect(first).toEqual(["/news/fresh-news", "/projects/sample-project"]);
    expect(relatedArticles(tutorial, 3, q).map((a) => a.path)).toEqual(first);
    const all = getPublishedContent(q).flatMap((a) => relatedArticles(a, 10, q)).map((a) => a.slug);
    for (const hidden of ["draft-post", "review-news", "future-post", "archived-post"]) expect(all).not.toContain(hidden);
  });
});

describe("reading time", () => {
  it("counts prose words at 220 wpm, ignores code, minimum 1", () => {
    expect(readingTimeMinutes("word ".repeat(660))).toBe(3);
    expect(readingTimeMinutes("short")).toBe(1);
    expect(readingTimeMinutes("intro\n```\n" + "code ".repeat(5000) + "\n```")).toBe(1);
  });
});

describe("RSS", () => {
  it("is valid RSS 2.0 with published items only and RFC 822 dates", () => {
    const xml = buildRss({ title: "T & co", description: "D", path: "/", selfPath: "/feed.xml", articles: getPublishedContent(q) });
    expect(XMLValidator.validate(xml)).toBe(true);
    const items = new XMLParser().parse(xml).rss.channel.item as { link: string; pubDate: string }[];
    const links = items.map((i) => i.link);
    expect(links).toContain("https://jithendar.com/news/fresh-news");
    expect(links).toContain("https://example.com/original-post");
    for (const hidden of ["draft-post", "review-news", "future-post", "archived-post"]) {
      expect(links.some((l) => l.endsWith(hidden))).toBe(false);
    }
    expect(items[0]!.pubDate).toBe("Tue, 27 Oct 2026 11:00:00 GMT");
  });
});

describe("search", () => {
  const index = buildSearchIndex(getPublishedContent(q));
  it("indexes published content only", () => {
    const paths = index.map((e) => e.path);
    expect(paths).toContain("/blog/published-tutorial");
    expect(paths).not.toContain("/blog/draft-post");
    expect(paths).not.toContain("/news/review-news");
  });
  it("requires every term and ranks title hits first", () => {
    expect(searchEntries(index, "fixture tutorial").map((e) => e.path)).toEqual(["/blog/published-tutorial"]);
    expect(searchEntries(index, "kubernetes")[0]?.path).toBe("/news/fresh-news");
    expect(searchEntries(index, "nonexistentterm")).toEqual([]);
    expect(searchEntries(index, "   ")).toEqual([]);
  });
});

describe("content preview", () => {
  it("shows review items locally when CONTENT_PREVIEW=true", () => {
    vi.stubEnv("CONTENT_PREVIEW", "true");
    vi.stubEnv("APP_ENV", "development");
    const preview = getPublishedContent({ now: NOW, root: FIXTURES });
    const review = preview.find((a) => a.slug === "review-news");
    expect(review?.preview).toBe(true);
    expect(preview.some((a) => a.slug === "draft-post")).toBe(false);
  });
  it("can never show review items in production", () => {
    vi.stubEnv("CONTENT_PREVIEW", "true");
    vi.stubEnv("APP_ENV", "production");
    expect(getPublishedContent({ now: NOW, root: FIXTURES }).some((a) => a.slug === "review-news")).toBe(false);
  });
});

describe("schema additions", () => {
  it("reserves slugs that collide with routes", () => {
    for (const slug of ["page", "feed", "category", "tag"]) {
      expect(articleFrontmatter.safeParse(validArticle({ slug })).success).toBe(false);
    }
  });
  it("validates related reference format", () => {
    expect(articleFrontmatter.safeParse(validArticle({ related: ["blog/a-post"] })).success).toBe(true);
    expect(articleFrontmatter.safeParse(validArticle({ related: ["a-post"] })).success).toBe(false);
  });
  it("rejects related references to content that does not exist", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "related-"));
    try {
      fs.mkdirSync(path.join(dir, "authors"));
      fs.mkdirSync(path.join(dir, "blog"));
      fs.writeFileSync(path.join(dir, "authors/a.mdx"), "---\nname: A\nslug: a\n---\n");
      fs.writeFileSync(
        path.join(dir, "blog/one.mdx"),
        "---\ntitle: A valid article title\nslug: one\ndescription: A description that is comfortably longer than fifty characters.\nauthor: a\ncategory: kubernetes\ncontentType: tutorial\nstatus: draft\nrelated: [blog/ghost]\n---\n",
      );
      expect(() => loadContent(dir)).toThrow(/related "blog\/ghost" does not exist/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("MDX pipeline", () => {
  it("demotes h1, assigns heading ids and collects h2/h3 for the TOC", async () => {
    const { headings } = await compileMdx("# Intro\n\n## Set up the cluster\n\n### Install `kubectl`\n\nText");
    expect(headings).toEqual([
      { id: "intro", text: "Intro", level: 2 },
      { id: "set-up-the-cluster", text: "Set up the cluster", level: 2 },
      { id: "install-kubectl", text: "Install kubectl", level: 3 },
    ]);
  });
  it("highlights code at build time with light and dark themes", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { Content } = await compileMdx("```bash\nkubectl get pods\n```");
    const html = renderToStaticMarkup(<Content />);
    expect(html).toContain('class="shiki');
    expect(html).toContain("--shiki-dark");
  });
});
