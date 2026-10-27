import { describe, expect, it } from "vitest";
import { articleMetadata, ArticlePage } from "@/lib/pages/article";

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
