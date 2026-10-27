import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";

afterEach(() => vi.unstubAllEnvs());

describe("/api/health", () => {
  it("returns ok without caching", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok", version: "dev" });
  });

  it("reports the build commit", async () => {
    vi.stubEnv("GIT_SHA", "abc123");
    expect((await GET().json()).version).toBe("abc123");
  });
});
