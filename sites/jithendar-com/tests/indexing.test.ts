import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isIndexableHost } from "@/config/site";
import { robotsTxt } from "@/lib/seo/robots";
import { proxy } from "@/proxy";

const request = (url: string) => new NextRequest(url, { headers: { host: new URL(url).host } });

afterEach(() => vi.unstubAllEnvs());

describe("environment indexability", () => {
  it("only indexes production on the canonical host", () => {
    vi.stubEnv("APP_ENV", "production");
    expect(isIndexableHost("jithendar.com")).toBe(true);
    expect(isIndexableHost("jithendar.com:443")).toBe(true);
    expect(isIndexableHost("www.jithendar.com")).toBe(false);
    expect(isIndexableHost("46.224.38.14")).toBe(false);
    vi.stubEnv("APP_ENV", "staging");
    expect(isIndexableHost("jithendar.com")).toBe(false);
  });

  it("adds X-Robots-Tag noindex outside production", () => {
    vi.stubEnv("APP_ENV", "staging");
    expect(proxy(request("https://staging.jithendar.com/")).headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("leaves production responses indexable", () => {
    vi.stubEnv("APP_ENV", "production");
    expect(proxy(request("https://jithendar.com/")).headers.get("x-robots-tag")).toBeNull();
  });

  it("robots.txt stays crawlable outside production (so the noindex header is seen) and lists both sitemaps in production", () => {
    expect(robotsTxt(false)).toBe("User-agent: *\nAllow: /\n");
    expect(robotsTxt(false)).not.toContain("Sitemap");
    const prod = robotsTxt(true);
    expect(prod).toContain("Sitemap: https://jithendar.com/sitemap.xml");
    expect(prod).toContain("Sitemap: https://jithendar.com/news-sitemap.xml");
    expect(prod).not.toMatch(/^Disallow: \/$/m);
    expect(prod).not.toMatch(/Googlebot/);
  });
});

describe("hijacked WordPress URLs", () => {
  it.each([
    "/2026/10/27/acronis-true-image-advanced-crack-license-intel-amd-full-version-mega/",
    "/2026/10/27/acronis-true-image-advanced-crack-license-intel-amd-full-version-mega",
    "/category/cracks/",
    "/wp-sitemap.xml",
  ])("returns 410 Gone for %s", (path) => {
    vi.stubEnv("APP_ENV", "production");
    const res = proxy(request(`https://jithendar.com${path}`));
    expect(res.status).toBe(410);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("does not touch real routes", () => {
    expect(proxy(request("https://jithendar.com/blog")).status).toBe(200);
  });
});

describe("trailing slashes", () => {
  it("redirects to the slashless URL in one 308 hop", () => {
    const res = proxy(request("https://jithendar.com/blog/?page=2"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://jithendar.com/blog?page=2");
  });

  it("leaves the homepage alone", () => {
    expect(proxy(request("https://jithendar.com/")).status).toBe(200);
  });
});
