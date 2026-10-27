import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getPublishedArticle, getPublishedContent } from "@/lib/content";
import { loadContent } from "@/lib/content/load";
import { FIXTURES, NOW, REAL_CONTENT } from "./helpers";

const slugs = (now = NOW) => getPublishedContent({ now, root: FIXTURES }).map((a) => `${a.collection}/${a.slug}`);

describe("getPublishedContent", () => {
  it("returns only published, non-future items, newest first", () => {
    expect(slugs()).toEqual([
      "news/fresh-news",
      "blog/syndicated-post",
      "news/stale-news",
      "blog/published-tutorial",
      "projects/sample-project",
    ]);
  });

  it.each(["blog/draft-post", "news/review-news", "blog/future-post", "blog/archived-post"])("excludes %s", (item) => {
    expect(slugs()).not.toContain(item);
    const [collection, slug] = item.split("/") as ["blog" | "news", string];
    expect(getPublishedArticle(collection, slug, { now: NOW, root: FIXTURES })).toBeUndefined();
  });

  it("releases a scheduled item once its publish time passes", () => {
    expect(slugs(new Date("2026-11-01T03:30:00Z"))).toContain("blog/future-post");
  });

  it("filters by collection", () => {
    const news = getPublishedContent({ collection: "news", now: NOW, root: FIXTURES });
    expect(news.every((a) => a.collection === "news")).toBe(true);
  });
});

describe("loadContent validation", () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function write(rel: string, text: string) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  const fm = (slug: string, author = "a") =>
    `---\ntitle: A valid article title\nslug: ${slug}\ndescription: A description that is comfortably longer than fifty characters.\nauthor: ${author}\ncategory: kubernetes\ncontentType: tutorial\nstatus: draft\n---\nBody\n`;

  it("reports every problem at once: bad file name, unknown author, invalid fields", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "content-"));
    write("authors/a.mdx", "---\nname: A\nslug: a\n---\n");
    write("blog/mismatch.mdx", fm("other-slug"));
    write("blog/ghost.mdx", fm("ghost", "nobody"));
    write("blog/bad.mdx", "---\ntitle: short\n---\n");
    let message = "";
    try {
      loadContent(dir);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/blog\/mismatch\.mdx: slug must match the file name/);
    expect(message).toMatch(/blog\/ghost\.mdx: author "nobody" not found/);
    expect(message).toMatch(/blog\/bad\.mdx: title:/);
  });
});

describe("repository content", () => {
  it("validates against the schema", () => {
    expect(() => loadContent(REAL_CONTENT)).not.toThrow();
  });
});
