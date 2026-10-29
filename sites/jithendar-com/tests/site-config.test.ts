import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema, type Db } from "@/db";
import { checkCustomCss, themeCss } from "@/lib/site-config/css";
import { contrast, overlayContrast } from "@/lib/site-config/color";
import { defaultConfig, hasForbiddenKeys, normalizeConfig, safeHref, SCHEMA_VERSION, THEME_PRESETS, validateConfig, type SiteConfig } from "@/lib/site-config/schema";
import { freshDb } from "./db-helpers";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: (name: string) => (name === "site_preview" && cookieValue ? { name, value: cookieValue } : undefined) }),
}));
let sessionUser: { id: string; role: string; name: string; email: string } | null = null;
vi.mock("@/lib/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/session")>()),
  getSessionUser: async () => (sessionUser ? { ...sessionUser, emailVerified: true, image: null, sessionCreatedAt: new Date() } : null),
}));

const admin = { id: "admin-1", role: "admin" as const, label: "admin@example.com" };
const author = { id: "author-1", role: "author" as const, label: "author@example.com" };
let db: Db;

async function store() {
  return import("@/lib/site-config/store");
}

beforeEach(async () => {
  db = await freshDb();
  await db.insert(schema.user).values([
    { id: admin.id, name: "Admin", email: admin.label, role: "admin" },
    { id: author.id, name: "Author", email: author.label, role: "author" },
  ]);
  const { broadcastInvalidate } = await import("@/lib/cache-bus");
  broadcastInvalidate("settings");
  (await import("@/lib/site-config/maintenance")).resetMaintenanceCache();
  cookieValue = undefined;
  sessionUser = null;
});

function edit(mutate: (c: SiteConfig) => void): SiteConfig {
  const c = defaultConfig();
  mutate(c);
  return c;
}

describe("schema and validation", () => {
  it("accepts the defaults and every theme preset", () => {
    expect(validateConfig(defaultConfig())).toMatchObject({ ok: true });
    for (const [name, preset] of Object.entries(THEME_PRESETS)) {
      const r = validateConfig(edit((c) => (c.theme = { ...c.theme, ...structuredClone(preset.theme) })));
      expect(r.ok, name).toBe(true);
    }
  });

  it("refuses unreadable colours and image overlays", () => {
    const low = validateConfig(edit((c) => (c.theme.light.text = "#dddddd")));
    expect(low.ok).toBe(false);
    expect(low.ok ? [] : low.issues.map((i) => i.path)).toContain("theme.light.text");
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 0);
    expect(overlayContrast("#ffffff", "#000000", 20)).toBeLessThan(4.5);
    const banner = validateConfig(
      edit((c) => {
        c.header.background = "image";
        c.header.image.desktop = { src: "/images/x.png", width: 10, height: 10, alt: "", decorative: true, focalX: 50, focalY: 50, fit: "cover" };
        c.header.image.overlayOpacity = 10;
      }),
    );
    expect(banner.ok ? [] : banner.issues.map((i) => i.path)).toContain("header.image.overlayOpacity");
  });

  it("keeps essential navigation usable", () => {
    const empty = validateConfig(edit((c) => (c.navigation.menus[0]!.items = [])));
    expect(empty.ok ? "" : empty.issues[0]!.message).toMatch(/at least one item/);
    const missing = validateConfig(edit((c) => (c.navigation.headerMenu = "nope")));
    expect(missing.ok).toBe(false);
    const nested = validateConfig(
      edit((c) => {
        const leaf = { id: "leaf", label: "Leaf", href: "/blog", newTab: false, children: [] };
        c.navigation.menus[0]!.items[0]!.children = [{ ...leaf, children: [leaf] } as never];
      }),
    );
    expect(nested.ok).toBe(false); // only one level of nesting
  });

  it.each([
    ["javascript:alert(1)", null],
    ["JaVaScRiPt:alert(1)", null],
    ["data:text/html,<b>x</b>", null],
    ["//evil.example", null],
    ["/\\evil.example", null],
    ["http://example.com", null],
    ["/admin/users", null],
    ["/api/v1/posts", null],
    ['/blog" onmouseover="x', null],
    ["/blog", "/blog"],
    ["https://example.com/a?b=1", "https://example.com/a?b=1"],
    ["mailto:hi@example.com", "mailto:hi@example.com"],
  ])("safeHref(%j) → %j", (input, expected) => {
    expect(safeHref(input)).toBe(expected);
  });

  it("rejects unsafe text and image sources", () => {
    expect(validateConfig(edit((c) => (c.general.siteName = "Evil‮moc.elgoog"))).ok).toBe(false);
    expect(validateConfig(edit((c) => (c.branding.logoLight = { src: "https://evil.example/x.png", width: 1, height: 1, alt: "x", decorative: false, focalX: 50, focalY: 50, fit: "cover" }))).ok).toBe(false);
    expect(validateConfig(edit((c) => (c.branding.logoLight = { src: "/images/logo.png", width: 1, height: 1, alt: "", decorative: false, focalX: 50, focalY: 50, fit: "cover" }))).ok).toBe(false); // needs alt or decorative
  });
});

describe("migration, defaults and fallbacks", () => {
  it("migrates the legacy settings row (schema v0)", () => {
    const { config } = normalizeConfig(
      { siteName: "Old Name", hero: { title: "A legacy headline here", subtitle: "Legacy subtitle with enough characters" }, announcement: { enabled: true, text: "Hello", href: "/about" }, features: { comments: false, registration: true, contactForm: true } },
      0,
    );
    expect(config.general.siteName).toBe("Old Name");
    expect(config.general.features.comments).toBe(false);
    expect(config.header.announcement).toMatchObject({ enabled: true, text: "Hello", href: "/about" });
    const hero = config.homepage.sections.find((s) => s.type === "hero");
    expect(hero).toMatchObject({ heading: "A legacy headline here" });
  });

  it("fills missing fields from defaults and replaces only an invalid section", () => {
    const { config, fallbacks } = normalizeConfig({ general: { siteName: "Partial" }, theme: { light: { text: "not a colour" } } });
    expect(config.general.siteName).toBe("Partial");
    expect(config.general.description).toBe(defaultConfig().general.description);
    expect(fallbacks).toEqual(["theme"]);
    expect(config.theme).toEqual(defaultConfig().theme);
  });

  it("refuses prototype pollution in stored or imported documents", () => {
    const evil = JSON.parse('{"general":{"__proto__":{"polluted":true}}}');
    expect(hasForbiddenKeys(evil)).toBe(true);
    expect(normalizeConfig(evil).fallbacks).toEqual(["(document)"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("generated CSS", () => {
  it("contains only declarations built from validated values", () => {
    const css = themeCss(edit((c) => (c.theme.light.accent = "#9a3412")));
    expect(css).toContain("--accent:#9a3412");
    expect(css).not.toMatch(/<|url\(|@import|expression/);
  });

  it("restricts custom CSS", () => {
    expect(checkCustomCss(".prose h2 { letter-spacing: -0.01em; }")).toEqual([]);
    expect(checkCustomCss("body{background:url(https://evil.example/t.gif)}").length).toBeGreaterThan(0);
    expect(checkCustomCss("@import 'x.css';").length).toBeGreaterThan(0);
    expect(checkCustomCss("</style><script>alert(1)</script>").length).toBeGreaterThan(0);
    expect(checkCustomCss("a{width:expression(alert(1))}").length).toBeGreaterThan(0);
    expect(checkCustomCss("a{color:\\72 ed}").length).toBeGreaterThan(0);
    expect(checkCustomCss(".x{position:fixed;inset:0}").length).toBeGreaterThan(0);
    expect(checkCustomCss(".x{").length).toBeGreaterThan(0);
    expect(validateConfig(edit((c) => (c.advanced.customCss = { enabled: true, css: "body{background:url(x)}" }))).ok).toBe(false);
  });
});

describe("draft, publish, conflicts and history", () => {
  it("only administrators can change settings", async () => {
    const { saveDraft, publishDraft, discardDraft } = await store();
    await expect(saveDraft(author, defaultConfig(), 0)).rejects.toMatchObject({ status: 403 });
    await expect(publishDraft(author, 0)).rejects.toMatchObject({ status: 403 });
    await expect(discardDraft(author)).rejects.toMatchObject({ status: 403 });
  });

  it("keeps the draft private until published, then applies it atomically and refreshes caches", async () => {
    const { saveDraft, getPublishedConfig, publishDraft, listRevisions } = await store();
    const before = await getPublishedConfig(); // warm the cache
    const draft = edit((c) => (c.general.siteName = "Draft Name"));
    const { version } = await saveDraft(admin, draft, 0);
    expect((await getPublishedConfig()).config.general.siteName).toBe(before.config.general.siteName);
    const { getSettings } = await import("@/lib/settings");
    expect((await getSettings()).siteName).toBe("Jithendar.com");

    const published = await publishDraft(admin, version, "rename");
    expect(published.version).toBe(1);
    // Same process: cache invalidated immediately (other replicas via the Redis cache bus).
    expect((await getPublishedConfig()).config.general.siteName).toBe("Draft Name");
    expect((await getSettings()).siteName).toBe("Draft Name");
    const revs = await listRevisions();
    expect(revs[0]).toMatchObject({ version: 1, reason: "rename", author: "Admin" });
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "site-config.publish"));
    expect(audit).toHaveLength(1);
  });

  it("detects conflicting edits to the draft and refuses stale publishes", async () => {
    const { saveDraft, publishDraft, ConfigConflictError } = await store();
    const first = await saveDraft(admin, edit((c) => (c.general.tagline = "One")), 0);
    await expect(saveDraft(admin, edit((c) => (c.general.tagline = "Two")), 0)).rejects.toBeInstanceOf(ConfigConflictError);
    await saveDraft(admin, edit((c) => (c.general.tagline = "Three")), first.version);
    await expect(publishDraft(admin, first.version)).rejects.toBeInstanceOf(ConfigConflictError);
  });

  it("never publishes an invalid draft; the live configuration stays as it was", async () => {
    const { saveDraft, publishDraft, getPublishedConfig } = await store();
    const ok = await saveDraft(admin, edit((c) => (c.general.siteName = "Good")), 0);
    await publishDraft(admin, ok.version);
    const bad = edit((c) => (c.theme.light.text = "#ffffff"));
    const saved = await saveDraft(admin, bad, ok.version + 1);
    expect(saved.issues.length).toBeGreaterThan(0); // drafts may be incomplete; issues are reported
    await expect(publishDraft(admin, saved.version)).rejects.toMatchObject({ status: 400 });
    expect((await getPublishedConfig()).config.theme.light.text).toBe(defaultConfig().theme.light.text);
    expect((await getPublishedConfig()).version).toBe(1);
  });

  it("refuses to publish references to images that do not exist", async () => {
    const { saveDraft, publishDraft } = await store();
    const missing = "/media/00000000-0000-4000-8000-000000000000/logo.png";
    const { version } = await saveDraft(admin, edit((c) => (c.branding.logoLight = { src: missing, width: 10, height: 10, alt: "Logo", decorative: false, focalX: 50, focalY: 50, fit: "cover" })), 0);
    await expect(publishDraft(admin, version)).rejects.toMatchObject({ issues: [expect.stringContaining("branding.logoLight")] });
  });

  it("restores an older version as a new revision (rollback) or into the draft", async () => {
    const { saveDraft, publishDraft, listRevisions, restoreRevision, getPublishedConfig, getDraft } = await store();
    const a = await saveDraft(admin, edit((c) => (c.general.siteName = "Version A")), 0);
    await publishDraft(admin, a.version);
    const b = await saveDraft(admin, edit((c) => (c.general.siteName = "Version B")), a.version + 1);
    await publishDraft(admin, b.version);
    const revs = await listRevisions();
    const v1 = revs.find((r) => r.version === 1)!;
    const restored = await restoreRevision(admin, v1.id, "publish", (await getDraft()).version);
    expect(restored.version).toBe(3);
    expect((await getPublishedConfig()).config.general.siteName).toBe("Version A");
    expect((await listRevisions()).map((r) => r.version)).toEqual([3, 2, 1]);

    const v2 = (await listRevisions()).find((r) => r.version === 2)!;
    await restoreRevision(admin, v2.id, "draft", (await getDraft()).version);
    expect(((await getDraft()).config as SiteConfig).general.siteName).toBe("Version B");
    expect((await getPublishedConfig()).config.general.siteName).toBe("Version A");
  });
});

describe("export and import", () => {
  it("exports settings without any secret", async () => {
    process.env.GEMINI_API_KEY = "secret-gemini-key-123";
    process.env.BETTER_AUTH_SECRET = "secret-auth-value-456";
    process.env.R2_SECRET_ACCESS_KEY = "secret-r2-value-789";
    process.env.GITHUB_CLIENT_SECRET = "secret-github-value-000";
    const { exportConfig } = await store();
    const json = await exportConfig("published");
    for (const v of ["secret-gemini-key-123", "secret-auth-value-456", "secret-r2-value-789", "secret-github-value-000"]) expect(json).not.toContain(v);
    expect(json).not.toMatch(/apiKey|secretAccessKey|clientSecret|password|token/i);
    const parsed = JSON.parse(json);
    expect(parsed).toMatchObject({ format: "jithendar-site-config", schemaVersion: SCHEMA_VERSION });
  });

  it("validates imports, summarises changes and drops missing media", async () => {
    const { previewImport, EXPORT_FORMAT } = await store();
    const doc = (config: unknown, extra: object = {}) => JSON.stringify({ format: EXPORT_FORMAT, schemaVersion: SCHEMA_VERSION, config, ...extra });
    await expect(previewImport("not json")).rejects.toMatchObject({ message: expect.stringMatching(/JSON/) });
    await expect(previewImport(JSON.stringify({ format: "other", schemaVersion: 1, config: {} }))).rejects.toThrow(/not a Jithendar/);
    await expect(previewImport(doc({}, { schemaVersion: SCHEMA_VERSION + 1 }))).rejects.toThrow(/schema version/);
    await expect(previewImport('{"format":"jithendar-site-config","schemaVersion":1,"config":{"__proto__":{"x":1}}}')).rejects.toThrow(/forbidden/);
    await expect(previewImport(doc(edit((c) => (c.header.cta = { show: true, label: "Go", href: "javascript:alert(1)" }))))).rejects.toThrow(/not valid/);

    const imported = edit((c) => {
      c.general.tagline = "Imported tagline";
      c.branding.socialImage = { src: "/media/00000000-0000-4000-8000-000000000000/s.png", width: 1200, height: 630, alt: "Card", decorative: false, focalX: 50, focalY: 50, fit: "cover" };
    });
    const r = await previewImport(doc(imported));
    expect(r.changes).toContain("general.tagline");
    expect(r.config.branding.socialImage).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/not found/);
  });
});

describe("draft preview", () => {
  it("shows the draft only to an admin holding a valid preview token", async () => {
    const { saveDraft, createConfigPreview } = await store();
    await saveDraft(admin, edit((c) => (c.general.siteName = "Previewed")), 0);
    const { getSiteConfig } = await import("@/lib/site-config");
    const { token } = await createConfigPreview(admin);

    // getSiteConfig is memoised per request with React cache; outside React each call is fresh.
    cookieValue = token;
    sessionUser = { id: admin.id, role: "admin", name: "Admin", email: admin.label };
    expect(await getSiteConfig()).toMatchObject({ preview: true, config: { general: { siteName: "Previewed" } } });

    sessionUser = { id: author.id, role: "author", name: "Author", email: author.label };
    expect(await getSiteConfig()).toMatchObject({ preview: false, config: { general: { siteName: "Jithendar.com" } } });

    sessionUser = null;
    expect((await getSiteConfig()).preview).toBe(false);

    sessionUser = { id: admin.id, role: "admin", name: "Admin", email: admin.label };
    cookieValue = "forged-token-forged-token-forged";
    expect((await getSiteConfig()).preview).toBe(false);
    await expect(createConfigPreview(author)).rejects.toMatchObject({ status: 403 });
  });
});

describe("maintenance mode", () => {
  it("answers 503 with Retry-After for public pages and keeps admin and sign-in reachable", async () => {
    const { saveDraft, publishDraft } = await store();
    const { proxy } = await import("@/proxy");
    expect((await proxy(new NextRequest("https://jithendar.com/blog"))).status).toBe(200);

    const { version } = await saveDraft(admin, edit((c) => (c.general.maintenance = { enabled: true, message: "Back <soon>", retryAfterMinutes: 15 })), 0);
    await publishDraft(admin, version);
    (await import("@/lib/site-config/maintenance")).resetMaintenanceCache();

    const res = await proxy(new NextRequest("https://jithendar.com/blog"));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("900");
    expect(res.headers.get("x-robots-tag")).toBeNull(); // indexing settings untouched
    const html = await res.text();
    expect(html).toContain("Back &lt;soon&gt;");
    for (const path of ["/admin", "/login", "/api/health", "/account/settings", "/robots.txt"]) {
      expect((await proxy(new NextRequest(`https://jithendar.com${path}`))).status, path).not.toBe(503);
    }
  });
});

describe("safe rendering of configured content", () => {
  it("escapes configured text and only links to validated destinations", async () => {
    const { saveDraft, publishDraft } = await store();
    const config = edit((c) => {
      c.header.announcement = { enabled: true, text: '<img src=x onerror="alert(1)">', href: "/about", dismissible: true, tone: "accent" };
      c.footer.copyright = "© {year} {site} <b>bold</b>";
    });
    const { version } = await saveDraft(admin, config, 0);
    await publishDraft(admin, version);
    const { AnnouncementBar } = await import("@/components/AnnouncementBar");
    const html = renderToStaticMarkup(await AnnouncementBar());
    expect(html).toContain("&lt;img src=x");
    expect(html).not.toContain("<img");
    expect(html).toContain('href="/about"');
    const { SiteFooter } = await import("@/components/SiteFooter");
    const footer = renderToStaticMarkup(await SiteFooter());
    expect(footer).toContain(`© ${new Date().getFullYear()} Jithendar.com &lt;b&gt;bold&lt;/b&gt;`);
    expect(footer).toContain('href="/privacy-policy"'); // legal links always present
  });
});
