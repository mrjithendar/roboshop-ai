import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { schema, setDbForTests } from "@/db";
import { freshDb } from "./db-helpers";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to), notFound: vi.fn() }));
vi.mock("server-only", () => ({}));

const TOKEN = "t".repeat(48);

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

afterEach(() => {
  vi.unstubAllEnvs();
  setDbForTests(undefined);
  redirect.mockReset();
});

describe("setupAction (the 'Create admin and import content' button)", () => {
  it("creates the admin, links the author profile and imports the bundled pages and posts", async () => {
    const db = await freshDb();
    vi.stubEnv("ADMIN_BOOTSTRAP_TOKEN", TOKEN);
    vi.stubEnv("CONTENT_SEED_DIR", path.resolve(import.meta.dirname, "../content"));
    const { setupAction } = await import("@/app/setup/actions");

    const result = await setupAction({}, form({ token: TOKEN, name: "Owner", email: "Owner@Example.com", password: "Rocket#2026" }));

    expect(result).toBeUndefined(); // success ends in redirect("/login?setup=done")
    expect(redirect).toHaveBeenCalledWith("/login?setup=done");
    const [admin] = await db.select().from(schema.user).where(eq(schema.user.email, "owner@example.com"));
    expect(admin?.role).toBe("admin");
    expect((await db.select().from(schema.page)).map((p) => p.slug)).toEqual(expect.arrayContaining(["about", "contact", "privacy-policy"]));
    expect((await db.select().from(schema.post)).length).toBeGreaterThan(0);
    const [profile] = await db.select().from(schema.authorProfile).where(eq(schema.authorProfile.userId, admin!.id));
    expect(profile?.slug).toBe("jithendar-dharmapuri");
  });

  it("rejects a wrong token, a weak password, and a second run once an admin exists", async () => {
    await freshDb();
    vi.stubEnv("ADMIN_BOOTSTRAP_TOKEN", TOKEN);
    vi.stubEnv("CONTENT_SEED_DIR", path.resolve(import.meta.dirname, "../content"));
    const { setupAction } = await import("@/app/setup/actions");
    const ok = { name: "Owner", email: "o@example.com", password: "Rocket#2026" };
    expect(await setupAction({}, form({ ...ok, token: "wrong" }))).toEqual({ error: "Invalid setup token." });
    expect((await setupAction({}, form({ ...ok, token: TOKEN, password: "short" })))?.error).toMatch(/at least 9/);
    await setupAction({}, form({ ...ok, token: TOKEN }));
    expect(await setupAction({}, form({ ...ok, token: TOKEN }))).toEqual({ error: "Setup is already complete." });
  });
});
