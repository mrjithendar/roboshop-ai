import { describe, expect, it, onTestFinished, vi } from "vitest";
import { articleMetadata, ArticlePage } from "@/lib/pages/article";

vi.mock("server-only", () => ({}));

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const NOT_FOUND = { digest: expect.stringContaining("404") };

// CONTENT_DIR points at the fixtures; the real clock is after every fixture date except future-post.
describe("article routes", () => {
  it.each([
    ["blog", "draft-post"],
    ["blog", "future-post"],
    ["blog", "archived-post"],
    ["news", "review-news"],
    ["news", "published-tutorial"],
    ["blog", "does-not-exist"],
  ] as const)("returns 404 for %s/%s (page and metadata)", async (collection, slug) => {
    await expect(ArticlePage({ collection, ...params(slug) })).rejects.toMatchObject(NOT_FOUND);
    await expect(articleMetadata(collection, params(slug))).rejects.toMatchObject(NOT_FOUND);
  });

  it("renders metadata with a self-referencing absolute canonical", async () => {
    const meta = await articleMetadata("blog", params("published-tutorial"));
    expect(meta.alternates?.canonical).toBe("https://jithendar.com/blog/published-tutorial");
    expect(meta.title).toBe("Published tutorial fixture for tests");
  });
});

describe("article page cover image", () => {
  /** Every element in a rendered tree (async child components are not invoked; they are not the article body). */
  function elements(node: unknown, out: { type: unknown; props: Record<string, unknown> }[] = []) {
    if (Array.isArray(node)) node.forEach((n) => elements(n, out));
    else if (node && typeof node === "object" && "props" in node) {
      const el = node as { type: unknown; props: Record<string, unknown> };
      out.push(el);
      elements(el.props.children, out);
    }
    return out;
  }

  it("is not shown on the article page, but stays on cards and in social metadata and structured data", async () => {
    // Site configuration and related articles read the database: use an empty in-memory one.
    const { freshDb } = await import("./db-helpers");
    const { setDbForTests } = await import("@/db");
    await freshDb();
    onTestFinished(() => setDbForTests(undefined));
    const { getPublishedArticle, getAuthor } = await import("@/lib/content");
    const { ArticleView } = await import("@/lib/pages/article");
    const { ArticleCard } = await import("@/components/ArticleList");
    const { articleLd } = await import("@/lib/seo/jsonld");
    const article = (await getPublishedArticle("blog", "published-tutorial"))!;
    const author = (await getAuthor(article.frontmatter.author))!;
    const cover = article.frontmatter.featuredImage!;
    expect(cover.src).toBe("/images/fixture.png");

    const tree = elements(await ArticleView({ article: { ...article, id: undefined }, author, collection: "blog" }));
    expect(tree.some((el) => el.props.src === cover.src)).toBe(false);
    expect(tree.some((el) => el.type === "figure")).toBe(false);
    // The title header spans the reading column and the right-hand column from lg up; the body stays at reading width.
    const header = tree.find((el) => el.type === "header")!;
    expect(String(header.props.className)).toContain("lg:col-span-2");
    expect(tree.some((el) => el.type === "p" && String(el.props.className).includes("max-w-reading"))).toBe(true);

    const meta = await articleMetadata("blog", params("published-tutorial"));
    expect(meta.openGraph?.images).toEqual([expect.objectContaining({ url: "https://jithendar.com/images/fixture.png", alt: cover.alt })]);
    expect(articleLd(article, author)).toMatchObject({ image: expect.anything() });

    const { renderToStaticMarkup } = await import("react-dom/server");
    const card = renderToStaticMarkup(<ArticleCard article={article} cats={new Map()} />);
    expect(card).toContain("fixture.png");
  });
});
