import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, setDbForTests, type Db } from "@/db";
import { GET as adsTxtRoute } from "@/app/ads.txt/route";
import { consentDefaultsScript } from "@/components/integrations/ThirdParty";
import { adsTxt, integrations, isTrackablePath } from "@/config/integrations";
import { cleanLocation, PageViewDeduper, safeParams } from "@/lib/analytics";
import { getPublishedArticle, invalidateContent } from "@/lib/content";
import { submitIndexNow } from "@/lib/indexnow";
import { backoffMs, enqueue, runDueJobs, PermanentJobError } from "@/lib/jobs";
import { articleMetadata } from "@/lib/pages/article";
import { createPost, publishPost, updatePost, type Actor } from "@/lib/posts";
import { serializeJsonLd } from "@/lib/seo/jsonld";
import { buildSitemap } from "@/lib/seo/sitemap";
import { proxy } from "@/proxy";
import { freshDb } from "./db-helpers";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, permanentRedirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));

const author: Actor = { id: "author", role: "author", label: "a@example.com" };
const PNG_SRC = "/images/roboshop-ai/cart.jpg";

describe("integration configuration", () => {
  it("accepts only well-formed public identifiers and never enables analytics outside production", () => {
    const env = {
      GA4_MEASUREMENT_ID: "G-ABC123XYZ9",
      ADSENSE_CLIENT_ID: "ca-pub-1234567890123456",
      ADSENSE_SLOT_ARTICLE_END: "1234567890",
      GOOGLE_SITE_VERIFICATION: "abcdefghijKLMNOP_123, bad token!",
      BING_SITE_VERIFICATION: "0123456789ABCDEF0123456789ABCDEF",
      INDEXNOW_KEY: "0123456789abcdef0123456789abcdef",
    };
    const prod = integrations(env, true);
    expect(prod.ga4).toBe("G-ABC123XYZ9");
    expect(prod.adsense).toEqual({ client: "ca-pub-1234567890123456", slots: { articleEnd: "1234567890", listing: undefined }, test: false });
    expect(prod.verification).toEqual({ google: ["abcdefghijKLMNOP_123"], bing: ["0123456789ABCDEF0123456789ABCDEF"] });
    expect(prod.indexNowKey).toBe("0123456789abcdef0123456789abcdef");

    const staging = integrations(env, false);
    expect(staging.ga4).toBeNull();
    expect(staging.adsense).toBeNull(); // no ads outside production…
    expect(integrations({ ...env, ADSENSE_TEST_MODE: "true" }, false).adsense?.test).toBe(true); // …except Google test ads when asked

    const bad = integrations({ GA4_MEASUREMENT_ID: "G-<script>", ADSENSE_CLIENT_ID: "pub-123\"><script>", INDEXNOW_KEY: "../../etc" }, true);
    expect([bad.ga4, bad.adsense, bad.indexNowKey]).toEqual([null, null, null]);
  });

  it("serves ads.txt only with the account-provided text, verbatim", async () => {
    expect(adsTxt({})).toBeNull();
    expect(adsTxt({ ADS_TXT: "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0" })).toBe("google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n");
    vi.stubEnv("ADS_TXT", "");
    expect((await adsTxtRoute()).status).toBe(404);
    vi.stubEnv("ADS_TXT", "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0");
    const res = await adsTxtRoute();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n");
    vi.unstubAllEnvs();
  });

  it("denies ad and analytics storage by default in the EEA, UK and Switzerland (and everywhere in strict mode)", () => {
    const regional = consentDefaultsScript("regional");
    const [first, second] = [...regional.matchAll(/gtag\('consent','default',(\{.*?\})\);/g)].map((m) => JSON.parse(m[1]!));
    expect(first).toMatchObject({ ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" });
    expect(first.region).toEqual(expect.arrayContaining(["DE", "FR", "GB", "CH", "NO", "IS", "LI"]));
    expect(second).toMatchObject({ analytics_storage: "granted" });
    expect(second.region).toBeUndefined();
    const strict = consentDefaultsScript("strict");
    expect([...strict.matchAll(/gtag\('consent','default',(\{.*?\})\);/g)].map((m) => JSON.parse(m[1]!).analytics_storage)).toEqual(["denied", "denied"]);
    expect(regional.indexOf("consent','default")).toBeLessThan(regional.indexOf("ads_data_redaction"));
  });

  it("never tracks or shows ads on private, editorial or preview routes", () => {
    for (const p of ["/admin", "/admin/posts/1", "/account", "/login", "/setup", "/preview/abc", "/api/health"]) expect(isTrackablePath(p)).toBe(false);
    for (const p of ["/", "/blog/some-post", "/about", "/administrators-guide"]) expect(isTrackablePath(p)).toBe(true);
  });
});

describe("GA4 page views and events", () => {
  it("sends each location once (Strict Mode double effects, re-renders) and again after navigating", () => {
    const d = new PageViewDeduper();
    expect([d.shouldSend("a"), d.shouldSend("a"), d.shouldSend("b"), d.shouldSend("b"), d.shouldSend("a")]).toEqual([true, false, true, false, true]);
  });

  it("strips query strings (search terms, emails) from page_location except the page number", () => {
    expect(cleanLocation("https://jithendar.com", "/search", "?q=jane%40example.com")).toBe("https://jithendar.com/search");
    expect(cleanLocation("https://jithendar.com", "/blog", "?page=2&utm_source=x&email=a@b.c")).toBe("https://jithendar.com/blog?page=2");
  });

  it("drops event parameters that look like personal data", () => {
    expect(safeParams({ article_slug: "k8s-ingress", email: "jane@example.com", phone: "+91 98765 43210", n: 3, ok: true, long: "x".repeat(200), obj: { a: 1 } })).toEqual({ article_slug: "k8s-ingress", n: 3, ok: true });
  });
});

describe("metadata, sitemap and structured data", () => {
  let db: Db;
  beforeEach(async () => {
    vi.stubEnv("CONTENT_DIR", "");
    delete process.env.CONTENT_DIR;
    vi.stubEnv("SITE_URL", "https://jithendar.com");
    db = await freshDb();
    await db.insert(schema.user).values({ id: "author", name: "Writer", email: "a@example.com", role: "author" });
    await db.insert(schema.authorProfile).values({ userId: "author", slug: "writer", displayName: "Writer" });
    invalidateContent();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setDbForTests(undefined);
  });

  const post = (over: Record<string, unknown> = {}) => ({
    collection: "blog",
    slug: "seo-post",
    title: "A post about search engine compatibility",
    description: "A description that is comfortably longer than fifty characters for the schema.",
    body: "## Hello\n\nBody.",
    category: "kubernetes",
    contentType: "tutorial",
    status: "draft",
    featuredImage: { src: PNG_SRC, alt: "A cart", width: 1200, height: 675 },
    ...over,
  });

  it("uses SEO and social overrides, absolute canonical URLs, and noindex when asked", async () => {
    const p = await createPost(author, post({ seoTitle: "Search engine compatibility for Next.js", seoDescription: "How the site helps search engines crawl, render and understand its published articles.", socialTitle: "Make Next.js crawlable" }));
    await publishPost(author, p.id, {});
    invalidateContent();
    const meta = await articleMetadata("blog", { params: Promise.resolve({ slug: "seo-post" }) });
    expect(meta.title).toBe("Search engine compatibility for Next.js");
    expect(meta.description).toBe("How the site helps search engines crawl, render and understand its published articles.");
    expect(meta.alternates?.canonical).toBe("https://jithendar.com/blog/seo-post");
    expect(meta.openGraph).toMatchObject({ title: "Make Next.js crawlable", url: "https://jithendar.com/blog/seo-post", images: [{ url: `https://jithendar.com${PNG_SRC}` }] });
    expect(meta.robots).toBeUndefined();

    let map = await buildSitemap();
    const entry = map.find((e) => e.url === "https://jithendar.com/blog/seo-post");
    expect(entry?.images).toEqual([`https://jithendar.com${PNG_SRC}`]);

    await updatePost(author, p.id, { noindex: true });
    invalidateContent();
    expect((await articleMetadata("blog", { params: Promise.resolve({ slug: "seo-post" }) })).robots).toEqual({ index: false, follow: true });
    map = await buildSitemap();
    expect(map.some((e) => e.url.endsWith("/blog/seo-post"))).toBe(false);
  });

  it("keeps drafts, scheduled, trashed and canonical-elsewhere posts out of the sitemap", async () => {
    await createPost(author, post({ slug: "draft-post" }));
    const sched = await createPost(author, post({ slug: "scheduled-post" }));
    await publishPost(author, sched.id, { publishedAt: "2099-01-01T09:00:00+05:30" });
    const syndicated = await createPost(author, post({ slug: "syndicated-post", canonicalUrl: "https://dev.to/x/original" }));
    await publishPost(author, syndicated.id, {});
    invalidateContent();
    const urls = (await buildSitemap()).map((e) => e.url);
    expect(urls.some((u) => /draft-post|scheduled-post|syndicated-post/.test(u))).toBe(false);
    expect(await getPublishedArticle("blog", "scheduled-post")).toBeUndefined();
  });

  it("escapes JSON-LD so content can never close the script tag", () => {
    const out = serializeJsonLd({ "@type": "BlogPosting", headline: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).headline).toBe("</script><script>alert(1)</script>");
  });
});

describe("IndexNow", () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setDbForTests(undefined);
  });

  it("serves the key file at the site root", () => {
    vi.stubEnv("INDEXNOW_KEY", "0123456789abcdef0123456789abcdef");
    const res = proxy(new NextRequest("https://jithendar.com/0123456789abcdef0123456789abcdef.txt"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  it("posts the documented JSON body and classifies failures", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const ok = vi.fn<typeof fetch>(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init!.body)) });
      return new Response(null, { status: 202 });
    });
    expect(await submitIndexNow(["https://jithendar.com/blog/x"], { key: "0123456789abcdef", fetchImpl: ok })).toBe(202);
    expect(calls[0]).toEqual({
      url: "https://api.indexnow.org/indexnow",
      body: { host: "jithendar.com", key: "0123456789abcdef", keyLocation: "https://jithendar.com/0123456789abcdef.txt", urlList: ["https://jithendar.com/blog/x"] },
    });
    for (const status of [400, 403, 422]) {
      await expect(submitIndexNow(["u"], { key: "k", fetchImpl: async () => new Response(null, { status }) })).rejects.toBeInstanceOf(PermanentJobError);
    }
    const retryable = await submitIndexNow(["u"], { key: "k", fetchImpl: async () => new Response(null, { status: 429 }) }).catch((e) => e);
    expect(retryable).not.toBeInstanceOf(PermanentJobError);
  });

  it("de-duplicates pending submissions, retries with backoff and stops after permanent failures", async () => {
    expect(await enqueue("indexnow", { url: "a" }, { dedupeKey: "indexnow:a" })).toBe(true);
    expect(await enqueue("indexnow", { url: "a" }, { dedupeKey: "indexnow:a" })).toBe(false);
    const t0 = new Date(Date.now() + 1000);
    let attempts = 0;
    const flaky = async () => {
      attempts++;
      throw new Error("HTTP 503");
    };
    expect(await runDueJobs({ indexnow: flaky }, t0)).toEqual({ done: 0, retried: 1, failed: 0 });
    expect(await runDueJobs({ indexnow: flaky }, t0)).toEqual({ done: 0, retried: 0, failed: 0 }); // not due yet
    expect(await runDueJobs({ indexnow: async () => undefined }, new Date(t0.getTime() + backoffMs(1) + 1))).toEqual({ done: 1, retried: 0, failed: 0 });
    expect(await enqueue("indexnow", { url: "a" }, { dedupeKey: "indexnow:a" })).toBe(true); // done jobs no longer block

    await enqueue("indexnow", { url: "b" }, { dedupeKey: "indexnow:b" });
    const r = await runDueJobs({ indexnow: async () => { throw new PermanentJobError("HTTP 403"); } }, new Date(Date.now() + 10 * 3_600_000));
    expect(r.failed).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(schema.job);
    expect(rows.find((j) => j.dedupeKey === "indexnow:b")).toMatchObject({ status: "failed", lastError: "HTTP 403" });
    expect(attempts).toBe(1);
  });

  it("publishing queues the canonical URL in production, and still succeeds if queueing fails", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("INDEXNOW_KEY", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("SITE_URL", "https://jithendar.com");
    vi.stubEnv("CONTENT_DIR", "");
    delete process.env.CONTENT_DIR;
    await db.insert(schema.user).values({ id: "author", name: "Writer", email: "a@example.com", role: "author" });
    await db.insert(schema.authorProfile).values({ userId: "author", slug: "writer", displayName: "Writer" });
    const p = await createPost(author, {
      collection: "blog", slug: "fresh", title: "A freshly published article title", description: "A description that is comfortably longer than fifty characters for the schema.",
      body: "Body.", category: "kubernetes", contentType: "tutorial", status: "draft",
    });
    expect(await db.select().from(schema.job)).toHaveLength(0); // drafts are not submitted
    await publishPost(author, p.id, {});
    const jobs = await db.select().from(schema.job);
    expect(jobs.map((j) => j.payload)).toEqual([{ url: "https://jithendar.com/blog/fresh" }]);

    // Break the queue: publishing must still work.
    await db.execute((await import("drizzle-orm")).sql`drop table job`);
    await expect(updatePost(author, p.id, { title: "An updated article title that still saves" })).resolves.toMatchObject({ status: "published" });
  });
});
