import { describe, expect, it } from "vitest";
import { getAuthor, getPublishedArticle } from "@/lib/content";
import { canonicalFor } from "@/lib/seo/canonical";
import { articleLd, breadcrumbLd, personLd, profilePageLd, serializeJsonLd, websiteLd } from "@/lib/seo/jsonld";
import { FIXTURES, NOW } from "./helpers";

const author = getAuthor("test-author", FIXTURES)!;
const get = (collection: "blog" | "news" | "projects", slug: string) =>
  getPublishedArticle(collection, slug, { now: NOW, root: FIXTURES })!;

describe("JSON-LD", () => {
  it("escapes < so content cannot close the script tag", () => {
    const out = serializeJsonLd({ "@type": "Thing", name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });

  it("uses NewsArticle for news with required fields matching the content", () => {
    const article = get("news", "fresh-news");
    const ld = JSON.parse(serializeJsonLd(articleLd(article, author)));
    expect(ld).toMatchObject({
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: article.frontmatter.title,
      datePublished: "2026-10-27T16:30:00+05:30",
      author: { "@type": "Person", name: "Test Author", url: "https://jithendar.com/authors/test-author" },
      url: "https://jithendar.com/news/fresh-news",
    });
  });

  it("uses BlogPosting for tutorials, with dateModified and image", () => {
    const ld = articleLd(get("blog", "published-tutorial"), author);
    expect(ld["@type"]).toBe("BlogPosting");
    expect(ld.dateModified).toBe("2026-10-22T10:00:00+05:30");
    expect(ld.image).toMatchObject({ url: "https://jithendar.com/images/fixture.png", width: 1200, height: 630 });
  });

  it("uses CreativeWork (not an article type) for projects", () => {
    const ld = articleLd(get("projects", "sample-project"), author);
    expect(ld["@type"]).toBe("CreativeWork");
    expect(ld.name).toBe("Sample project fixture entry");
    expect(ld.headline).toBeUndefined();
  });

  it("respects an external canonical URL", () => {
    const article = get("blog", "syndicated-post");
    expect(canonicalFor(article)).toBe("https://example.com/original-post");
    expect(articleLd(article, author).url).toBe("https://example.com/original-post");
  });

  it("builds Person, ProfilePage, WebSite and BreadcrumbList", () => {
    expect(personLd(author)).toMatchObject({ "@type": "Person", name: "Test Author", jobTitle: "Platform Engineer" });
    expect(profilePageLd(author)).toMatchObject({ "@type": "ProfilePage", mainEntity: { "@type": "Person" } });
    expect(websiteLd()).toMatchObject({ "@type": "WebSite", url: "https://jithendar.com", inLanguage: "en" });
    expect(breadcrumbLd([{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }]).itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: "https://jithendar.com" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://jithendar.com/blog" },
    ]);
  });
});
