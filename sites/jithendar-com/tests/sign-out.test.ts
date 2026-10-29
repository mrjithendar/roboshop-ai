import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signOut = vi.fn();
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: () => signOut() } }));

function memoryStorage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    removeItem: (k: string) => void data.delete(k),
    keys: () => [...data.keys()].sort(),
  };
}

let replace: ReturnType<typeof vi.fn>;
let local: ReturnType<typeof memoryStorage>;
let sessionClear: ReturnType<typeof vi.fn>;

beforeEach(() => {
  replace = vi.fn();
  sessionClear = vi.fn();
  local = memoryStorage({ "editor:u1:post:new": "{draft}", "editor:u1:post:42": "{draft}", theme: "dark", "announcement-dismissed": "a1" });
  vi.stubGlobal("window", { location: { replace, pathname: "/admin/posts", search: "?status=draft" } });
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", { clear: sessionClear });
  signOut.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("signOutAndLeave", () => {
  it("signs out, clears private browser data and replaces the page with the sign-in page", async () => {
    signOut.mockResolvedValue({ data: { success: true }, error: null });
    const { signOutAndLeave } = await import("@/lib/sign-out");
    expect(await signOutAndLeave()).toBeNull();
    expect(signOut).toHaveBeenCalledTimes(1);
    // Admin pages are not offered as the next destination; replace() keeps them out of Back history.
    expect(replace).toHaveBeenCalledWith("/login?signedOut=1");
    expect(local.keys()).toEqual(["announcement-dismissed", "theme"]);
    expect(sessionClear).toHaveBeenCalled();
  });

  it("treats an already expired session as signed out", async () => {
    signOut.mockResolvedValue({ data: null, error: { status: 401, message: "Unauthorized" } });
    const { signOutAndLeave } = await import("@/lib/sign-out");
    expect(await signOutAndLeave("/blog/some-post")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/login?signedOut=1&next=%2Fblog%2Fsome-post");
  });

  it("stays on the page with an error when the server cannot be reached (still signed in)", async () => {
    signOut.mockRejectedValue(new TypeError("Failed to fetch"));
    const { signOutAndLeave } = await import("@/lib/sign-out");
    expect(await signOutAndLeave()).toMatch(/could not sign out/i);
    expect(replace).not.toHaveBeenCalled();
    expect(local.keys()).toContain("editor:u1:post:new");
  });
});

describe("sign-out destinations", () => {
  it("never redirects off-site or back into private pages or the sign-in page", async () => {
    const { signedOutHref } = await import("@/lib/sign-out");
    expect(signedOutHref("/news/item?ref=x#comments")).toBe("/login?signedOut=1&next=%2Fnews%2Fitem%3Fref%3Dx%23comments");
    for (const from of ["//evil.example", "https://evil.example/", "/\\evil", "/login?next=/admin", "/admin", "/admin/users", "/account/settings", "/", null]) {
      expect(signedOutHref(from)).toBe("/login?signedOut=1");
    }
  });

  it("sends an expired session on a private page to sign in and back", async () => {
    vi.stubGlobal("window", undefined);
    const { expiredHref } = await import("@/components/SessionGuard");
    expect(expiredHref("/admin/posts?status=draft")).toBe("/login?expired=1&next=%2Fadmin%2Fposts%3Fstatus%3Ddraft");
    expect(expiredHref("//evil.example")).toBe("/login?expired=1");
  });
});

describe("caching of private pages", () => {
  it("marks admin, admin APIs, comment APIs, account and sign-in responses private, no-store", async () => {
    const { default: config } = await import("../next.config");
    const rules = await config.headers!();
    const noStore = (source: string) => rules.find((r) => r.source === source)?.headers.some((h) => h.key === "Cache-Control" && h.value.includes("no-store"));
    for (const source of ["/admin", "/admin/:path*", "/api/admin/:path*", "/api/comments/:path*", "/account", "/account/:path*", "/api/auth/:path*", "/login"]) {
      expect(noStore(source), source).toBe(true);
    }
  });
});

describe("sign-out and the session guard", () => {
  it("flags a deliberate sign-out while it runs, so the guard does not redirect to 'session expired'", async () => {
    let seen: boolean | null = null;
    const { signOutAndLeave, isSigningOut } = await import("@/lib/sign-out");
    signOut.mockImplementation(async () => {
      seen = isSigningOut();
      return { data: { success: true }, error: null };
    });
    await signOutAndLeave("/admin");
    expect(seen).toBe(true);
    signOut.mockRejectedValue(new Error("offline"));
    await signOutAndLeave("/admin");
    expect(isSigningOut()).toBe(false);
  });
});
