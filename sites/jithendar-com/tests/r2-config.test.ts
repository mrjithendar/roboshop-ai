import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDbForTests } from "@/db";
import { presignGet, presignPut, publicObjectUrl, readR2Config, saveStorageConfig, storageSummary } from "@/lib/storage";
import { freshDb } from "./db-helpers";

vi.mock("server-only", () => ({}));
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const KEY = "jithendar/www/media/videos/2026/10/0f8fad5b-d9cb-469f-a165-70867728950e.mp4";

beforeEach(async () => {
  await freshDb();
  vi.stubEnv("R2_ACCOUNT_ID", ACCOUNT);
  vi.stubEnv("R2_BUCKET", "jithendar-media");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-access-key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret-key-never-shown");
  vi.stubEnv("R2_PUBLIC_BASE_URL", "https://media.example.com/");
});
afterEach(() => {
  vi.unstubAllEnvs();
  setDbForTests(undefined);
});

describe("R2 configuration", () => {
  it("uses the account endpoint for the API and the public URL only for delivery", async () => {
    const c = await readR2Config();
    expect(c).toMatchObject({ source: "env", endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`, bucket: "jithendar-media", publicBaseUrl: "https://media.example.com" });
    expect(await publicObjectUrl(KEY)).toBe(`https://media.example.com/${KEY}`);
  });

  it("never exposes the secret in the admin summary", async () => {
    const s = await storageSummary();
    expect(JSON.stringify(s)).not.toContain("test-secret-key-never-shown");
    expect(s).toMatchObject({ source: "env", accessKeyId: "test-access-key" });
  });

  it("refuses a half-configured environment instead of silently falling back", async () => {
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "");
    await expect(readR2Config()).rejects.toThrow("R2_SECRET_ACCESS_KEY");
  });

  it("does not let the admin form override the Secret", async () => {
    await expect(saveStorageConfig({ id: "a", role: "admin", label: "a" }, {})).rejects.toMatchObject({ status: 409 });
    await expect(saveStorageConfig({ id: "a", role: "author", label: "a" }, {})).rejects.toMatchObject({ status: 403 });
  });
});

describe("presigned URLs", () => {
  it("signs a short-lived PUT bound to the declared type and size", async () => {
    const url = new URL(await presignPut(KEY, "video/mp4", 1234, 600));
    expect(url.host).toBe(`${ACCOUNT}.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe(`/jithendar-media/${KEY}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(expect.arrayContaining(["content-length", "content-type", "host"]));
    expect(url.toString()).not.toContain("test-secret-key-never-shown");
  });

  it("signs private downloads for five minutes without caching", async () => {
    const url = new URL(await presignGet(KEY, 'clip".mp4'));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("response-cache-control")).toBe("private, no-store");
    expect(url.searchParams.get("response-content-disposition")).toBe('inline; filename="clip.mp4"');
  });
});
