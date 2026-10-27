import { describe, expect, it } from "vitest";
import { gonePaths } from "@/config/gone";
import { redirects } from "@/config/redirects";

describe("redirect map", () => {
  it("has unique, site-relative sources", () => {
    const sources = redirects.map((r) => r.source);
    expect(new Set(sources).size).toBe(sources.length);
    for (const source of sources) expect(source.startsWith("/")).toBe(true);
  });

  it("resolves every source in one hop (no destination is itself a source)", () => {
    const sources = new Set(redirects.map((r) => r.source));
    for (const { destination } of redirects) expect(sources.has(destination)).toBe(false);
  });

  it("never redirects a 410 Gone URL", () => {
    for (const { source } of redirects) expect(gonePaths.has(source.replace(/\/+$/, ""))).toBe(false);
  });
});
