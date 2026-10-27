import { XMLParser, XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { getPublishedContent } from "@/lib/content";
import { buildNewsSitemap, newsSitemapEntries } from "@/lib/seo/news-sitemap";
import { FIXTURES, NOW } from "./helpers";

const entries = async (now = NOW) => newsSitemapEntries(await getPublishedContent({ now, root: FIXTURES }), now);

describe("news sitemap", () => {
  it("includes a 1-hour-old news article and excludes a 49-hour-old one", async () => {
    const slugs = (await entries()).map((a) => a.slug);
    expect(slugs).toContain("fresh-news");
    expect(slugs).not.toContain("stale-news");
  });

  it("excludes non-news types, drafts/review, future and externally canonical items", async () => {
    const slugs = (await entries()).map((a) => a.slug);
    expect(slugs).not.toContain("published-tutorial");
    expect(slugs).not.toContain("review-news");
    expect(slugs).not.toContain("future-post");
    expect(slugs).not.toContain("syndicated-post");
  });

  it("produces valid, escaped XML with the original publication date and offset", async () => {
    const xml = buildNewsSitemap((await entries()));
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).toContain("Kubernetes &amp; AI: release &lt;notes&gt; for operators");
    const doc = new XMLParser().parse(xml);
    const url = doc.urlset.url;
    expect(url.loc).toBe("https://jithendar.com/news/fresh-news");
    expect(url["news:news"]["news:publication_date"]).toBe("2026-10-27T16:30:00+05:30");
    expect(url["news:news"]["news:publication"]).toEqual({ "news:name": "Jithendar.com", "news:language": "en" });
  });

  it("is still valid XML when empty", async () => {
    const xml = buildNewsSitemap([]);
    expect(XMLValidator.validate(xml)).toBe(true);
  });
});
