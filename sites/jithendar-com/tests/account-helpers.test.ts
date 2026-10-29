import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { avatarLimits, avatarObjectKey, avatarSrc, parseAvatarSrc, processAvatar } from "@/lib/avatar";
import { displayableAvatar, initials } from "@/lib/avatar-url";
import { authErrorMessage } from "@/lib/auth-errors";
import { loginHref, safeNext } from "@/lib/safe-next";

vi.mock("server-only", () => ({}));

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#3366cc" } }).png().toBuffer();

describe("safe redirect handling", () => {
  it.each([
    ["/account", "/account"],
    ["/blog/post?x=1#c", "/blog/post?x=1#c"],
    ["//evil.example", "/account"],
    ["/\\evil.example", "/account"],
    ["https://evil.example/", "/account"],
    ["javascript:alert(1)", "/account"],
    ["/%0d%0aSet-Cookie:x", "/%0d%0aSet-Cookie:x"],
    ["/a\nb", "/account"],
    ["/login?next=/admin", "/account"],
    ["/api/auth/sign-out", "/account"],
    ["", "/account"],
    [null, "/account"],
  ])("safeNext(%j) → %j", (input, expected) => {
    expect(safeNext(input as string | null)).toBe(expected);
  });

  it("builds sign-in links that return to the current page", () => {
    expect(loginHref("/blog/x")).toBe("/login?next=%2Fblog%2Fx");
    expect(loginHref("/")).toBe("/login");
    expect(loginHref("//evil.example")).toBe("/login");
  });
});

describe("avatar URLs", () => {
  it("renders only our uploads and Google/GitHub avatar hosts", () => {
    expect(displayableAvatar("/media/avatars/abcdefgh12/0e3f8c5a-1b2c-4d5e-8f90-123456789abc.webp")).toMatch(/^\/media\//);
    expect(displayableAvatar("https://avatars.githubusercontent.com/u/1?v=4")).toBe("https://avatars.githubusercontent.com/u/1?v=4");
    expect(displayableAvatar("https://lh3.googleusercontent.com/a/x")).toBeTruthy();
    expect(displayableAvatar("http://avatars.githubusercontent.com/u/1")).toBeNull();
    expect(displayableAvatar("https://evil.example/a.png")).toBeNull();
    expect(displayableAvatar("javascript:alert(1)")).toBeNull();
    expect(displayableAvatar("/media/../admin")).toBeNull();
    expect(initials("Ada  Lovelace Byron")).toBe("AL");
    expect(initials("")).toBe("?");
  });

  it("keys avatars by user under the media root and parses only well-formed URLs", () => {
    const id = "0e3f8c5a-1b2c-4d5e-8f90-123456789abc";
    expect(avatarObjectKey("user_ABC123", id)).toBe(`jithendar/www/media/images/avatars/user_ABC123/${id}.webp`);
    expect(() => avatarObjectKey("../etc", id)).toThrow();
    expect(parseAvatarSrc(avatarSrc("user_ABC123", id))).toEqual({ userId: "user_ABC123", file: `${id}.webp` });
    expect(parseAvatarSrc("/media/avatars/user_ABC123/evil.svg")).toBeNull();
    expect(parseAvatarSrc("https://avatars.githubusercontent.com/u/1")).toBeNull();
  });
});

describe("avatar validation and processing", () => {
  const limits = { maxBytes: 2 * 1024 * 1024, maxSide: 4096, minSide: 64 };

  it("re-encodes a valid image to a 512 px square WebP", async () => {
    const r = await processAvatar(await png(900, 600), limits);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const meta = await sharp(r.bytes).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 512, height: 512 });
  });

  it("strips EXIF/GPS metadata", async () => {
    const withExif = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#888" } })
      .withExif({ IFD0: { Copyright: "secret-owner" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const r = await processAvatar(withExif, limits);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const meta = await sharp(r.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(r.bytes.includes(Buffer.from("secret-owner"))).toBe(false);
  });

  it("judges files by content, not name: SVG, HTML and text are refused", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="100" height="100"/></svg>');
    expect(await processAvatar(svg, limits)).toMatchObject({ ok: false });
    expect(await processAvatar(Buffer.from("<html><script>alert(1)</script></html>".padEnd(64)), limits)).toMatchObject({ ok: false });
    expect(await processAvatar(Buffer.alloc(0), limits)).toMatchObject({ ok: false, error: "The file is empty." });
  });

  it("enforces size and dimension limits before decoding", async () => {
    expect(await processAvatar(await png(32, 32), limits)).toMatchObject({ ok: false, error: expect.stringContaining("at least 64") });
    expect(await processAvatar(await png(600, 600), { ...limits, maxSide: 500 })).toMatchObject({ ok: false, error: expect.stringContaining("at most 500") });
    expect(await processAvatar(await png(600, 600), { ...limits, maxBytes: 100 })).toMatchObject({ ok: false, error: expect.stringContaining("MB or smaller") });
  });

  it("refuses a truncated image that only looks like a PNG", async () => {
    const real = await png(200, 200);
    expect(await processAvatar(real.subarray(0, 60), limits)).toMatchObject({ ok: false });
  });

  it("reads limits from configuration within safe bounds", () => {
    expect(avatarLimits({})).toEqual({ maxBytes: 2 * 1024 * 1024, maxSide: 4096, minSide: 64 });
    expect(avatarLimits({ AVATAR_MAX_BYTES: "999999999", AVATAR_MAX_DIMENSION: "10" }).maxBytes).toBe(10 * 1024 * 1024);
    expect(avatarLimits({ AVATAR_MAX_DIMENSION: "10" }).maxSide).toBe(256);
  });
});

describe("auth error messages", () => {
  it("maps known callback codes and never echoes unknown ones", () => {
    expect(authErrorMessage("email_not_found")).toMatch(/email/);
    expect(authErrorMessage("account_not_linked")).toMatch(/Account settings/);
    expect(authErrorMessage("REGISTRATION_CLOSED")).toMatch(/closed/);
    expect(authErrorMessage("<script>")).toBe("Sign-in failed. Please try again.");
    expect(authErrorMessage(null)).toBeNull();
  });
});
