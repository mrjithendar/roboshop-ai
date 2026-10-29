// Responsive audit (local development tool, not part of CI).
// Visits every route at 320–1920 px and reports page-level horizontal overflow and small touch targets,
// then exercises the admin menu, media picker and Generate image dialog on phone/tablet widths
// (the generate API is intercepted, so no Gemini or R2 access is needed).
//
//   npm i --no-save playwright-core            # uses your installed Google Chrome (CHROME_PATH to override)
//   AUDIT_TOKEN=<ADMIN_BOOTSTRAP_TOKEN> AUDIT_EMAIL=you@example.com AUDIT_PASSWORD='…' \
//     node scripts/responsive-check.mjs http://localhost:3000 ./responsive-out [routeFilter]
//
// The server must run with GEMINI_API_KEY/GEMINI_IMAGE_MODEL and R2_* set (placeholders are fine) so the
// Generate image button is enabled. On a fresh database the script completes /setup with these credentials.
import fs from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = process.argv[3] ?? "./out";
const FILTER = process.argv[4];
const WIDTHS = [320, 375, 390, 768, 1024, 1440, 1920];
const TOKEN = process.env.AUDIT_TOKEN ?? "";
const EMAIL = process.env.AUDIT_EMAIL ?? "audit@example.com";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "";
if (!PASSWORD) throw new Error("Set AUDIT_PASSWORD (and AUDIT_TOKEN on a fresh database).");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

async function ensureLogin() {
  await page.goto(`${BASE}/setup`, { waitUntil: "load" });
  if (await page.locator('input[name="token"]').count()) {
    await page.fill('input[name="token"]', TOKEN);
    await page.fill('input[name="name"]', "Audit Admin");
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([page.waitForLoadState("load"), page.locator('form button[type="submit"]').click()]);
    await page.waitForTimeout(3000);
  }
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  if (await page.locator('input[name="password"]').count()) {
    await page.waitForTimeout(3000);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.waitForTimeout(1500);
    await page.locator('input[name="password"]').press("Enter");
    await page.waitForURL(/\/(account|admin)/, { timeout: 90000 });
  }
}

await ensureLogin();
const adminCheck = await page.goto(`${BASE}/admin`, { waitUntil: "load" });
console.log("admin status", adminCheck?.status(), page.url());

// Discover dynamic routes from the admin and the public listings.
async function allHrefs(url, pattern) {
  await page.goto(`${BASE}${url}`, { waitUntil: "load" });
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
  return [...new Set(hrefs.filter((h) => h && new RegExp(pattern).test(h)))];
}
const postEdits = await allHrefs("/admin/posts", "^/admin/posts/[0-9a-f-]{36}$");
const pageEdit = (await allHrefs("/admin/pages", "^/admin/pages/(?!new$)[a-z0-9-]+$"))[0] ?? "/admin/pages";
// Unpublished posts (all local content is in review): render their public layout through the editor's preview.
const previews = [];
for (const edit of postEdits) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}${edit}`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const [popup] = await Promise.all([page.waitForEvent("popup", { timeout: 60000 }), page.getByRole("button", { name: /Preview/ }).click()]);
  await popup.waitForURL(/\/preview\//, { timeout: 90000 });
  previews.push(new URL(popup.url()).pathname);
  await popup.close();
}
const tag = (await allHrefs(previews[0] ?? "/", "^/tag/[a-z0-9-]+$"))[0] ?? "/blog";
const category = (await allHrefs(previews[0] ?? "/", "^/category/[a-z0-9-]+$"))[0] ?? "/category/kubernetes";
const author = (await allHrefs("/blog", "^/authors/[a-z0-9-]+$"))[0] ?? "/authors/jithendar-dharmapuri";
console.log("discovered", { postEdits, pageEdit, previews, tag, category, author });

const routes = [
  "/", "/blog", "/news", "/projects", ...previews, category, tag, author, "/about", "/contact", "/privacy-policy", "/terms",
  "/search?q=kubernetes", "/does-not-exist", "/login", "/account",
  "/admin", "/admin/posts", "/admin/posts/new", ...postEdits.slice(0, 1), "/admin/pages", "/admin/pages/new", pageEdit, "/admin/media",
  "/admin/categories", "/admin/tags", "/admin/comments", "/admin/messages", "/admin/profile", "/admin/api-keys", "/admin/users",
  "/admin/settings", "/admin/storage", "/admin/backups", "/admin/system", "/admin/database", "/admin/database?table=post", "/admin/audit",
].filter((r) => !FILTER || r.includes(FILTER));

const results = [];
for (const route of routes) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const res = await page.goto(`${BASE}${route}`, { waitUntil: "load" }).catch((e) => ({ status: () => `ERR ${e.message}` }));
    await page.waitForTimeout(150);
    const m = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const sw = document.documentElement.scrollWidth;
      const offenders = [];
      if (sw > vw + 1) {
        for (const el of document.body.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.right <= vw + 1) continue;
          // Ignore elements inside their own horizontal scroll container.
          let p = el.parentElement, clipped = false;
          while (p && p !== document.body) {
            const ox = getComputedStyle(p).overflowX;
            if ((ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") && p.getBoundingClientRect().right <= vw + 1) { clipped = true; break; }
            p = p.parentElement;
          }
          if (!clipped) offenders.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${String(el.className).slice(0, 80)} right=${Math.round(r.right)}`);
          if (offenders.length > 6) break;
        }
      }
      // Touch targets smaller than 24px (WCAG 2.2 AA minimum) among visible interactive elements.
      const small = [...document.querySelectorAll("a, button, input, select, textarea, summary")]
        .filter((el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && s.visibility !== "hidden" && (r.height < 24 || r.width < 24) && !el.closest("p, li.prose, .prose") ; })
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
      return { vw, sw, offenders, small };
    });
    const status = typeof res?.status === "function" ? res.status() : "?";
    results.push({ route, width, status, overflow: m.sw > m.vw + 1, ...m });
    if (m.sw > m.vw + 1 || [320, 768, 1440].includes(width)) {
      await page.screenshot({ path: `${OUT}/${route.replace(/[^a-z0-9]+/gi, "_")}_${width}.png`, fullPage: false });
    }
  }
}
// --- Interactive checks on phones and tablets: admin menu, media picker, Generate image dialog ---------
const interactive = [];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
await page.route("**/api/admin/images/generate", async (route) => {
  await new Promise((r) => setTimeout(r, 400));
  await route.fulfill({ json: { id: "00000000-0000-4000-8000-000000000001", previewUrl: "/api/admin/images/generations/00000000-0000-4000-8000-000000000001", width: 1600, height: 900, model: "local-test-model", expiresAt: new Date().toISOString() } });
});
await page.route("**/api/admin/images/generations/**", (route) => route.fulfill({ body: PNG, contentType: "image/png" }));
const inViewport = () => page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return { open: false };
  const r = d.getBoundingClientRect();
  const buttons = [...d.querySelectorAll("button")].filter((b) => b.offsetParent !== null).map((b) => { const br = b.getBoundingClientRect(); return { text: b.textContent.trim().slice(0, 20), ok: br.left >= -1 && br.right <= innerWidth + 1 && br.bottom <= innerHeight + 1 && br.height >= 24 }; });
  return { open: true, fits: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1, buttons, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, focusInside: d.contains(document.activeElement) };
});
for (const width of [320, 375, 390, 768]) {
  await page.setViewportSize({ width, height: width < 700 ? 740 : 1024 });
  // Admin menu
  await page.goto(`${BASE}/admin/posts`, { waitUntil: "load" });
  await page.getByRole("button", { name: /^Menu/ }).click();
  const menuOk = await page.locator("#admin-nav").isVisible();
  await page.screenshot({ path: `${OUT}/ix_admin_menu_${width}.png` });
  interactive.push({ width, check: "admin menu opens", ok: menuOk });
  // Generate image dialog on the new-post editor
  await page.goto(`${BASE}/admin/posts/new`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await page.fill("#title", "Scaling Kubernetes ingress on a single node");
  await page.getByRole("button", { name: /Generate image/ }).first().click();
  let v = await inViewport();
  interactive.push({ width, check: "generate dialog: compose fits, focus inside", ok: v.open && v.fits && v.focusInside && !v.overflow, v });
  const prompt = await page.inputValue("#gen-prompt");
  interactive.push({ width, check: "prompt prefilled from title", ok: prompt.includes("Scaling Kubernetes ingress") });
  await page.screenshot({ path: `${OUT}/ix_generate_compose_${width}.png` });
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  const busy = await page.getByRole("button", { name: /Generating/ }).isDisabled().catch(() => false);
  interactive.push({ width, check: "generate button disabled while running (no duplicates)", ok: busy });
  await page.getByRole("button", { name: "Use as cover" }).waitFor({ timeout: 15000 });
  v = await inViewport();
  const acceptDisabled = await page.getByRole("button", { name: "Use as cover" }).isDisabled();
  interactive.push({ width, check: "generate dialog: preview fits, actions reachable, accept needs alt text", ok: v.fits && v.buttons.every((b) => b.ok) && acceptDisabled && !v.overflow, v });
  await page.screenshot({ path: `${OUT}/ix_generate_preview_${width}.png` });
  await page.getByRole("button", { name: "Discard" }).click();
  await page.keyboard.press("Escape");
  interactive.push({ width, check: "Escape closes the dialog", ok: !(await inViewport()).open });
  // Media picker
  await page.getByRole("button", { name: /Select or upload a cover image/ }).click();
  await page.waitForTimeout(800);
  v = await inViewport();
  interactive.push({ width, check: "media picker fits", ok: v.open && v.fits && !v.overflow, v });
  await page.screenshot({ path: `${OUT}/ix_media_picker_${width}.png` });
  await page.keyboard.press("Escape");
}
for (const i of interactive) console.log(`${i.ok ? "PASS" : "FAIL"} @${i.width} ${i.check}${i.ok ? "" : " " + JSON.stringify(i.v ?? {})}`);
fs.writeFileSync(`${OUT}/interactive.json`, JSON.stringify(interactive, null, 2));
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
for (const r of results.filter((r) => r.overflow || String(r.status) !== "200")) {
  console.log(`${r.route} @${r.width}: status=${r.status} scroll=${r.sw}/${r.vw}`, r.offenders.slice(0, 4).join(" | "));
}
console.log(`checked ${results.length} route×width combinations; overflow in ${results.filter((r) => r.overflow).length}`);
await browser.close();
