import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, type Db } from "@/db";
import { freshDb } from "./db-helpers";

vi.mock("server-only", () => ({}));
// Server actions and requireRole read the request through next/headers; tests set the cookie per call.
let requestCookie = "";
vi.mock("next/headers", () => ({
  headers: async () => new Headers(requestCookie ? { cookie: requestCookie } : {}),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, has: () => false }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const ORIGIN = "https://jithendar.com";

// --- Mocked identity providers (no real Google/GitHub credentials in tests) ------------------------------
type GitHubUser = { id: number; login: string; name: string | null; email: string | null; avatar_url: string };
let githubUser: GitHubUser;
let githubEmails: { email: string; primary: boolean; verified: boolean }[];
const realFetch = globalThis.fetch;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith("https://github.com/login/oauth/access_token")) return json({ access_token: "gho_test", token_type: "bearer", scope: "user:email" });
  if (url === "https://api.github.com/user") return json(githubUser);
  if (url === "https://api.github.com/user/emails") return json(githubEmails);
  if (url.startsWith("https://challenges.cloudflare.com/")) return json({ success: true });
  if (url.startsWith("https://api.pwnedpasswords.com/")) return new Response("", { status: 200 });
  return realFetch(input, init);
});

// --- Helpers --------------------------------------------------------------------------------------------
type Auth = Awaited<ReturnType<typeof import("@/lib/auth").getAuth>>;
let auth: Auth;
let db: Db;

function cookieHeader(res: Response, previous = ""): string {
  const jar = new Map(previous.split("; ").filter(Boolean).map((c) => c.split("=") as [string, string]).map(([k, ...v]) => [k, v.join("=")]));
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const i = pair!.indexOf("=");
    jar.set(pair!.slice(0, i), pair!.slice(i + 1));
  }
  return [...jar].filter(([, v]) => v !== "").map(([k, v]) => `${k}=${v}`).join("; ");
}

async function post(path: string, body: unknown, cookie = "") {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

/** Start a GitHub sign-in (or link) and return the provider URL and the state cookie. */
async function startGitHub(path = "/sign-in/social", body: Record<string, unknown> = {}, cookie = "") {
  const res = await post(path, { provider: "github", callbackURL: "/account", errorCallbackURL: "/login?next=%2Faccount", ...body }, cookie);
  const data = (await res.json()) as { url?: string; code?: string; message?: string };
  return { res, data, url: data.url ? new URL(data.url) : null, cookie: cookieHeader(res, cookie) };
}

async function callback(state: string, cookie: string, params: Record<string, string> = { code: "test-code" }) {
  const qs = new URLSearchParams({ ...params, state });
  return auth.handler(new Request(`${ORIGIN}/api/auth/callback/github?${qs}`, { headers: { cookie } }));
}

async function signInWithGitHub() {
  const start = await startGitHub();
  const res = await callback(start.url!.searchParams.get("state")!, start.cookie);
  return { res, cookie: cookieHeader(res, start.cookie) };
}

function errorOf(res: Response): string | null {
  const location = res.headers.get("location");
  return location ? new URL(location, ORIGIN).searchParams.get("error") : null;
}

beforeAll(async () => {
  vi.stubGlobal("fetch", fakeFetch);
  process.env.GITHUB_CLIENT_ID = "test-github-id";
  process.env.GITHUB_CLIENT_SECRET = "test-github-secret";
  process.env.TURNSTILE_SECRET_KEY = "test-turnstile";
  process.env.BETTER_AUTH_SECRET = "test-secret-0123456789abcdef0123456789abcdef";
});

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_SECRET;
});

beforeEach(async () => {
  db = await freshDb();
  // Each test starts from default settings (registration open); drop the per-process settings cache.
  const { broadcastInvalidate } = await import("@/lib/cache-bus");
  broadcastInvalidate("settings");
  (globalThis as { __auth?: unknown }).__auth = undefined;
  const { getAuth } = await import("@/lib/auth");
  auth = await getAuth();
  githubUser = { id: 4242, login: "octo", name: "Octo Cat", email: null, avatar_url: "https://avatars.githubusercontent.com/u/4242" };
  githubEmails = [{ email: "octo@example.com", primary: true, verified: true }];
  requestCookie = "";
});

// --- Tests ---------------------------------------------------------------------------------------------

describe("provider configuration", () => {
  it("enables a provider only when both its ID and secret are set, with minimal scopes", async () => {
    const { enabledProviders, socialProviderConfig, callbackUrl } = await import("@/lib/auth-providers");
    expect(enabledProviders({ GITHUB_CLIENT_ID: "a" })).toEqual([]);
    expect(enabledProviders({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" })).toEqual(["google"]);
    const cfg = socialProviderConfig({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", GITHUB_CLIENT_ID: "c", GITHUB_CLIENT_SECRET: "d" });
    expect(cfg.github).toMatchObject({ disableDefaultScope: true, scope: ["user:email"] });
    expect(cfg.google).toMatchObject({ prompt: "select_account" });
    expect(callbackUrl("https://jithendar.com/", "github")).toBe("https://jithendar.com/api/auth/callback/github");
  });

  it("sends GitHub only user:email, with state and a PKCE challenge, to the exact callback URL", async () => {
    const { url } = await startGitHub();
    expect(url!.origin + url!.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url!.searchParams.get("scope")).toBe("user:email");
    expect(url!.searchParams.get("state")).toBeTruthy();
    expect(url!.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url!.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback/github`);
  });

  it("refuses providers that are not configured", async () => {
    const res = await post("/sign-in/social", { provider: "google", callbackURL: "/account" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses an off-site callback URL (no open redirect)", async () => {
    const { res } = await startGitHub("/sign-in/social", { callbackURL: "https://evil.example/steal" });
    expect(res.status).toBe(403);
  });
});

describe("social sign-in and callback errors", () => {
  it("creates a new user with the lowest role and a verified email, then redirects to the destination", async () => {
    const { res, cookie } = await signInWithGitHub();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/account");
    expect(cookie).toMatch(/session_token=/);
    const [u] = await db.select().from(schema.user).where(eq(schema.user.email, "octo@example.com"));
    expect(u).toMatchObject({ role: "user", emailVerified: true, name: "Octo Cat" });
    const [acc] = await db.select().from(schema.account).where(eq(schema.account.userId, u!.id));
    expect(acc!.providerId).toBe("github");
    // Provider tokens are encrypted at rest.
    expect(acc!.accessToken).not.toBe("gho_test");
  });

  it("handles denied consent by returning to the error page with a readable code", async () => {
    const start = await startGitHub();
    const res = await callback(start.url!.searchParams.get("state")!, start.cookie, { error: "access_denied", error_description: "The user denied" });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!, ORIGIN).pathname).toBe("/login");
    expect(errorOf(res)).toBe("access_denied");
    const { authErrorMessage } = await import("@/lib/auth-errors");
    expect(authErrorMessage("access_denied")).toMatch(/cancelled/);
    expect(await db.select().from(schema.user)).toHaveLength(0);
  });

  it("rejects a provider account without an email address", async () => {
    githubEmails = [];
    const start = await startGitHub();
    const res = await callback(start.url!.searchParams.get("state")!, start.cookie);
    expect(errorOf(res)).toBe("email_not_found");
    expect(await db.select().from(schema.user)).toHaveLength(0);
  });

  it("rejects a callback whose state does not match this browser", async () => {
    const start = await startGitHub();
    const res = await callback(start.url!.searchParams.get("state")!, ""); // no state cookie
    expect(res.status).toBe(302);
    expect(errorOf(res)).toBeTruthy();
    expect(await db.select().from(schema.user)).toHaveLength(0);
  });

  it("does not create accounts when registration is closed", async () => {
    const { saveSettings } = await import("@/lib/settings");
    const { getSettings } = await import("@/lib/settings");
    const current = await getSettings();
    await saveSettings({ ...current, features: { ...current.features, registration: false } }, "test-admin");
    const { res } = await signInWithGitHub();
    expect(errorOf(res)).toBe("REGISTRATION_CLOSED");
    expect(await db.select().from(schema.user)).toHaveLength(0);
  });

  it("never links to an existing account just because the email matches", async () => {
    await db.insert(schema.user).values({ id: "existing-user-1", name: "Owner", email: "octo@example.com", emailVerified: true, role: "admin" });
    const { res } = await signInWithGitHub();
    expect(errorOf(res)).toBe("account_not_linked");
    expect(await db.select().from(schema.account)).toHaveLength(0);
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, "existing-user-1"));
    expect(u!.role).toBe("admin");
  });
});

describe("explicit account linking and unlinking", () => {
  async function passwordUser() {
    const signUp = await auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, "x-captcha-response": "ok" },
        body: JSON.stringify({ name: "Reader", email: "reader@example.com", password: "Correct-Horse-9-Battery" }),
      }),
    );
    if (signUp.status !== 200) throw new Error(`sign-up failed: ${signUp.status} ${await signUp.text()}`);
    return cookieHeader(signUp);
  }

  it("gives email sign-ups the reader role and refuses a requested role", async () => {
    const asked = await auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, "x-captcha-response": "ok" },
        body: JSON.stringify({ name: "Sneaky", email: "sneaky@example.com", password: "Correct-Horse-9-Battery", role: "admin" }),
      }),
    );
    expect(asked.status).toBe(400);
    expect(((await asked.json()) as { code: string }).code).toBe("FIELD_NOT_ALLOWED");
    await passwordUser();
    const [u] = await db.select().from(schema.user).where(eq(schema.user.email, "reader@example.com"));
    expect(u!.role).toBe("user");
  });

  it("links GitHub only through the signed-in flow, even with a different email", async () => {
    const cookie = await passwordUser();
    const start = await startGitHub("/link-social", { callbackURL: "/account/settings?linked=github", errorCallbackURL: "/account/settings" }, cookie);
    expect(start.url).not.toBeNull();
    const res = await callback(start.url!.searchParams.get("state")!, start.cookie);
    expect(res.headers.get("location")).toBe("/account/settings?linked=github");
    const [u] = await db.select().from(schema.user).where(eq(schema.user.email, "reader@example.com"));
    const accounts = await db.select().from(schema.account).where(eq(schema.account.userId, u!.id));
    expect(accounts.map((a) => a.providerId).sort()).toEqual(["credential", "github"]);
    // Linking did not copy the provider's profile over the local one.
    expect(u!.name).toBe("Reader");
  });

  it("requires a recent sign-in to link an account", async () => {
    const cookie = await passwordUser();
    await db.update(schema.session).set({ createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) });
    const start = await startGitHub("/link-social", { callbackURL: "/account/settings" }, cookie);
    expect(start.res.status).toBe(403);
    expect(start.data.code).toBe("SESSION_NOT_FRESH");
  });

  it("can unlink a second method but never the last one", async () => {
    const cookie = await passwordUser();
    const start = await startGitHub("/link-social", { callbackURL: "/account/settings" }, cookie);
    await callback(start.url!.searchParams.get("state")!, start.cookie);
    const { unlinkAccountAction } = await import("@/app/account/actions");
    requestCookie = cookie;
    const accounts = await db.select().from(schema.account);
    const github = accounts.find((a) => a.providerId === "github")!;
    const credential = accounts.find((a) => a.providerId === "credential")!;
    expect(await unlinkAccountAction(github.id)).toMatchObject({ ok: true });
    const last = await unlinkAccountAction(credential.id);
    expect(last).toMatchObject({ ok: false });
    expect(await db.select().from(schema.account)).toHaveLength(1);
  });

  it("cannot unlink someone else's account", async () => {
    const { cookie: githubCookie } = await signInWithGitHub();
    const other = (await db.select().from(schema.account))[0]!;
    const cookie = await passwordUser();
    const { unlinkAccountAction } = await import("@/app/account/actions");
    requestCookie = cookie;
    expect(await unlinkAccountAction(other.id)).toMatchObject({ ok: false });
    expect(await db.select().from(schema.account).where(eq(schema.account.id, other.id))).toHaveLength(1);
    expect(githubCookie).toBeTruthy();
  });
});

describe("profiles and roles", () => {
  it("blocks the generic update-user endpoint (no self-service role or image changes)", async () => {
    const { cookie } = await signInWithGitHub();
    const res = await post("/update-user", { name: "Hacker", role: "admin", image: "https://evil.example/x.png" }, cookie);
    expect(res.status).toBe(403);
    const [u] = await db.select().from(schema.user);
    expect(u).toMatchObject({ role: "user", name: "Octo Cat" });
  });

  it("updates only the signed-in user's allowlisted fields", async () => {
    await db.insert(schema.user).values({ id: "someone-else-1", name: "Other", email: "other@example.com", role: "user" });
    const { cookie } = await signInWithGitHub();
    requestCookie = cookie;
    const { updateProfileAction } = await import("@/app/account/actions");
    const form = new FormData();
    for (const [k, v] of Object.entries({ name: "  New Name ", bio: "Hi", website: "https://example.com", github: "https://github.com/octo", role: "admin", id: "someone-else-1", email: "x@example.com", emailVerified: "false" })) form.set(k, v);
    expect(await updateProfileAction(form)).toMatchObject({ ok: true });
    const [me] = await db.select().from(schema.user).where(eq(schema.user.email, "octo@example.com"));
    expect(me).toMatchObject({ name: "New Name", bio: "Hi", website: "https://example.com/", role: "user", emailVerified: true, socialLinks: { github: "https://github.com/octo" } });
    const [other] = await db.select().from(schema.user).where(eq(schema.user.id, "someone-else-1"));
    expect(other).toMatchObject({ name: "Other", bio: "" });
  });

  it("rejects unsafe URLs and over-long fields with per-field errors", async () => {
    const { cookie } = await signInWithGitHub();
    requestCookie = cookie;
    const { updateProfileAction } = await import("@/app/account/actions");
    const form = new FormData();
    form.set("name", "x".repeat(81));
    form.set("website", "javascript:alert(1)");
    form.set("github", "https://evil.example/octo");
    form.set("x", "http://x.com/octo");
    const r = await updateProfileAction(form);
    expect(r.ok).toBe(false);
    expect(r.ok ? {} : r.fieldErrors).toEqual(expect.objectContaining({ name: expect.any(String), website: expect.any(String), github: expect.any(String), x: expect.any(String) }));
  });

  it("refuses profile changes without a session", async () => {
    requestCookie = "";
    const { updateProfileAction } = await import("@/app/account/actions");
    const form = new FormData();
    form.set("name", "Nobody");
    expect(await updateProfileAction(form)).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });
});

describe("sessions and admin access", () => {
  it("signs out and expires sessions", async () => {
    const { cookie } = await signInWithGitHub();
    const session = () => auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(await session()).not.toBeNull();
    await db.update(schema.session).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await session()).toBeNull();

    const again = await signInWithGitHub();
    const out = await post("/sign-out", {}, again.cookie);
    expect(out.status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ cookie: again.cookie }) })).toBeNull();
  });

  it("keeps readers out of admin pages and actions", async () => {
    const { requireRole } = await import("@/lib/session");
    const { editorActor, SESSION_EXPIRED_MESSAGE } = await import("@/lib/admin");
    requestCookie = "";
    await expect(requireRole("admin", "author")).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(editorActor()).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
    const { cookie } = await signInWithGitHub();
    requestCookie = cookie;
    await expect(requireRole("admin", "author")).rejects.toMatchObject({ digest: expect.stringContaining("/account?denied=1") });
    await expect(editorActor()).rejects.toMatchObject({ status: 403 });
  });
});
