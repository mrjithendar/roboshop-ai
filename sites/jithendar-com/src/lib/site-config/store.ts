import { randomBytes } from "node:crypto";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "../audit";
import { setDateSettings } from "../dates";
import { broadcastInvalidate, onInvalidate } from "../cache-bus";
import { log } from "../log";
import { resolveImage } from "../media";
import type { Actor } from "../posts";
import { PostError } from "../posts";
import { summarizeChanges } from "./diff";
import { hasForbiddenKeys, mergeWithDefaults, normalizeConfig, SCHEMA_VERSION, validateConfig, type ImageRef, type SiteConfig } from "./schema";

const PUBLISHED = "published";
const DRAFT = "draft";
const ENTITY = "site-config";
const MAX_DOCUMENT = 200_000;
export const EXPORT_FORMAT = "jithendar-site-config";

export type Published = { config: SiteConfig; version: number; updatedAt: Date | null; fallbacks: string[] };
export type Draft = { config: unknown; version: number; baseVersion: number; updatedAt: Date | null; updatedBy: string | null };
export type Issue = { path: string; message: string };

export class ConfigConflictError extends PostError {
  constructor(readonly latest: Draft) {
    super("Someone else changed the draft. Load their version before saving again.", 409);
  }
}

function requireAdmin(actor: Actor) {
  if (actor.role !== "admin") throw new PostError("Only administrators can change the site's appearance and settings.", 403);
}

// --- Published configuration: cached per process, invalidated on every replica after publishing ------------

const TTL_MS = 60_000;
let cached: { value: Published; at: number } | undefined;
onInvalidate("settings", () => {
  cached = undefined;
});

/** Load the published configuration (or migrate the legacy settings row; or defaults on a fresh install). */
async function loadPublished(): Promise<Published> {
  const db = await getDb();
  const [row] = await db.select().from(schema.siteConfig).where(eq(schema.siteConfig.key, PUBLISHED));
  if (row) {
    const { config, fallbacks } = normalizeConfig(row.config, row.schemaVersion);
    if (fallbacks.length) log.warn("published site config fell back to defaults for some sections", { fallbacks });
    return { config, version: row.version, updatedAt: row.updatedAt, fallbacks };
  }
  const [legacy] = await db.select().from(schema.setting).where(eq(schema.setting.key, "site"));
  const { config, fallbacks } = normalizeConfig(legacy?.value ?? {}, 0);
  return { config, version: 0, updatedAt: null, fallbacks };
}

/**
 * The live configuration. Never throws: if the database is unreachable (e.g. during the build) the last good
 * value is served, or the defaults.
 */
export async function getPublishedConfig(): Promise<Published> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const value = await loadPublished();
    cached = { value, at: Date.now() };
    setDateSettings(value.config.general.timezone, value.config.general.dateFormat);
    return value;
  } catch (err) {
    if (cached) return cached.value;
    // Expected while `next build` collects page data (no database); worth a warning at runtime.
    if (process.env.NEXT_PHASE !== "phase-production-build") log.warn("site config unavailable, using defaults", { err });
    return { config: normalizeConfig({}).config, version: 0, updatedAt: null, fallbacks: [] };
  }
}

// --- Draft --------------------------------------------------------------------------------------------------

export async function getDraft(): Promise<Draft> {
  const db = await getDb();
  const [row] = await db.select().from(schema.siteConfig).where(eq(schema.siteConfig.key, DRAFT));
  if (row) return { config: row.config, version: row.version, baseVersion: row.baseVersion, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  const pub = await getPublishedConfig();
  return { config: pub.config, version: 0, baseVersion: pub.version, updatedAt: null, updatedBy: null };
}

/** The draft as a complete config (invalid sections replaced by defaults), for previews. */
export async function getDraftConfig(): Promise<SiteConfig> {
  return normalizeConfig((await getDraft()).config).config;
}

function assertDocument(config: unknown) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new PostError("The configuration must be an object.");
  if (hasForbiddenKeys(config)) throw new PostError("The configuration contains forbidden keys.");
  if (JSON.stringify(config).length > MAX_DOCUMENT) throw new PostError("The configuration is too large.");
}

/**
 * Save the shared draft (autosave). Drafts may be incomplete, so only structural checks apply here;
 * the returned issues are what would block publishing. `expectedVersion` detects concurrent edits.
 */
export async function saveDraft(actor: Actor, config: unknown, expectedVersion: number): Promise<{ version: number; issues: Issue[] }> {
  requireAdmin(actor);
  assertDocument(config);
  const db = await getDb();
  const now = new Date();
  // Read outside the transaction (it must not wait on another connection while holding a row lock).
  const publishedVersion = (await getPublishedConfig()).version;
  const saved = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.siteConfig).where(eq(schema.siteConfig.key, DRAFT)).for("update");
    const current = row?.version ?? 0;
    if (current !== expectedVersion) return null;
    const baseVersion = row?.baseVersion ?? publishedVersion;
    const value = { config: config as Record<string, unknown>, schemaVersion: SCHEMA_VERSION, version: current + 1, baseVersion, updatedAt: now, updatedBy: actor.id };
    await tx.insert(schema.siteConfig).values({ key: DRAFT, ...value }).onConflictDoUpdate({ target: schema.siteConfig.key, set: value });
    return current + 1;
  });
  if (saved === null) throw new ConfigConflictError(await getDraft());
  const check = validateConfig(config);
  return { version: saved, issues: check.ok ? [] : check.issues };
}

/** Throw away the draft: it becomes the published configuration again. */
export async function discardDraft(actor: Actor): Promise<void> {
  requireAdmin(actor);
  const db = await getDb();
  await db.delete(schema.siteConfig).where(eq(schema.siteConfig.key, DRAFT));
  await audit(actor, "site-config.discard-draft", "site");
}

// --- References to media and content ------------------------------------------------------------------------

export function imageRefs(c: SiteConfig): { path: string; ref: ImageRef }[] {
  const out: { path: string; ref: ImageRef }[] = [];
  const add = (path: string, ref: ImageRef | null) => ref && out.push({ path, ref });
  for (const key of ["logoLight", "logoDark", "logoMobile", "favicon", "appleIcon", "socialImage"] as const) add(`branding.${key}`, c.branding[key]);
  for (const [name, b] of [["header.image", c.header.image], ["footer.image", c.footer.image]] as const) {
    add(`${name}.desktop`, b.desktop);
    add(`${name}.mobile`, b.mobile);
  }
  c.homepage.sections.forEach((s, i) => {
    if (s.type === "hero") {
      add(`homepage.sections.${i}.image.desktop`, s.image.desktop);
      add(`homepage.sections.${i}.image.mobile`, s.image.mobile);
    }
  });
  return out;
}

/** Media ids used by the published and draft configurations (Media library "in use" counts). */
export async function configMediaIds(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const [pub, draft] = await Promise.all([getPublishedConfig(), getDraftConfig().catch(() => null)]);
  for (const c of [pub.config, draft]) {
    if (!c) continue;
    for (const { ref } of imageRefs(c)) {
      const m = /^\/media\/([0-9a-f-]{36})\//.exec(ref.src);
      if (m) out.set(m[1]!, (out.get(m[1]!) ?? 0) + 1);
    }
  }
  return out;
}

/** Every referenced image must still exist (and be public); dimensions are taken from the media record. */
async function checkImages(c: SiteConfig): Promise<{ config: SiteConfig; issues: Issue[] }> {
  const issues: Issue[] = [];
  const copy = structuredClone(c);
  for (const { path, ref } of imageRefs(copy)) {
    const found = await resolveImage(ref.src);
    if (!found) issues.push({ path, message: "This image no longer exists in the media library. Choose another." });
    else {
      ref.width = found.width;
      ref.height = found.height;
    }
  }
  return { config: copy, issues };
}

// --- Publish, history, restore ----------------------------------------------------------------------------

export type PublishResult = { version: number };

/**
 * Publish the draft atomically: validate the complete document, check referenced media, then (in one
 * transaction, with both rows locked) write the published row, record the revision and rebase the draft.
 * If anything fails, the previous published configuration stays live.
 */
export async function publishDraft(actor: Actor, expectedDraftVersion: number, note = ""): Promise<PublishResult> {
  requireAdmin(actor);
  const draft = await getDraft();
  if (draft.version !== expectedDraftVersion) throw new ConfigConflictError(draft);
  const checked = validateConfig(draft.config);
  if (!checked.ok) throw new PostError("The draft has problems that must be fixed before publishing.", 400, checked.issues.map((i) => `${i.path}: ${i.message}`));
  const images = await checkImages(checked.config);
  if (images.issues.length) throw new PostError("Some images are missing.", 400, images.issues.map((i) => `${i.path}: ${i.message}`));
  const version = await commitPublished(actor, images.config, { reason: note.trim().slice(0, 200) || "publish", expectedDraftVersion });
  await audit(actor, "site-config.publish", "site", { version });
  return { version };
}

async function commitPublished(actor: Actor, config: SiteConfig, opts: { reason: string; expectedDraftVersion?: number }): Promise<number> {
  const db = await getDb();
  const now = new Date();
  const version = await db.transaction(async (tx) => {
    const [pub] = await tx.select().from(schema.siteConfig).where(eq(schema.siteConfig.key, PUBLISHED)).for("update");
    const [draft] = await tx.select().from(schema.siteConfig).where(eq(schema.siteConfig.key, DRAFT)).for("update");
    if (opts.expectedDraftVersion !== undefined && (draft?.version ?? 0) !== opts.expectedDraftVersion) return null;
    const next = (pub?.version ?? 0) + 1;
    const row = { config: config as unknown as Record<string, unknown>, schemaVersion: SCHEMA_VERSION, version: next, baseVersion: next, updatedAt: now, updatedBy: actor.id };
    await tx.insert(schema.siteConfig).values({ key: PUBLISHED, ...row }).onConflictDoUpdate({ target: schema.siteConfig.key, set: row });
    await tx.insert(schema.revision).values({
      entity: ENTITY,
      entityId: "site",
      version: next,
      reason: opts.reason,
      payload: { schemaVersion: SCHEMA_VERSION, config } as unknown as Record<string, unknown>,
      authorId: actor.id,
    });
    // The draft now matches what is live.
    const draftRow = { ...row, version: (draft?.version ?? 0) + 1 };
    await tx.insert(schema.siteConfig).values({ key: DRAFT, ...draftRow }).onConflictDoUpdate({ target: schema.siteConfig.key, set: draftRow });
    return next;
  });
  if (version === null) throw new ConfigConflictError(await getDraft());
  cached = undefined;
  broadcastInvalidate("settings");
  return version;
}

export type RevisionSummary = { id: string; version: number; reason: string; author: string | null; createdAt: Date };

export async function listRevisions(limit = 50): Promise<RevisionSummary[]> {
  const db = await getDb();
  return db
    .select({ id: schema.revision.id, version: schema.revision.version, reason: schema.revision.reason, author: schema.user.name, createdAt: schema.revision.createdAt })
    .from(schema.revision)
    .leftJoin(schema.user, eq(schema.user.id, schema.revision.authorId))
    .where(and(eq(schema.revision.entity, ENTITY), eq(schema.revision.entityId, "site")))
    .orderBy(desc(schema.revision.version))
    .limit(limit);
}

async function revisionConfig(id: string): Promise<SiteConfig> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new PostError("Unknown revision.", 404);
  const db = await getDb();
  const [row] = await db.select().from(schema.revision).where(and(eq(schema.revision.id, id), eq(schema.revision.entity, ENTITY)));
  if (!row) throw new PostError("Unknown revision.", 404);
  const payload = row.payload as { schemaVersion?: number; config?: unknown };
  return normalizeConfig(payload.config, payload.schemaVersion ?? SCHEMA_VERSION).config;
}

/** Restore an older configuration: into the draft for review, or straight to live as a new revision. */
export async function restoreRevision(actor: Actor, id: string, mode: "draft" | "publish", expectedDraftVersion: number): Promise<{ version: number }> {
  requireAdmin(actor);
  const config = await revisionConfig(id);
  if (mode === "draft") return saveDraft(actor, config, expectedDraftVersion);
  const images = await checkImages(config);
  if (images.issues.length) throw new PostError("Some images in that revision no longer exist. Restore it into the draft and replace them.", 400, images.issues.map((i) => `${i.path}: ${i.message}`));
  const version = await commitPublished(actor, images.config, { reason: `restore of revision ${id.slice(0, 8)}`, expectedDraftVersion });
  await audit(actor, "site-config.restore", "site", { revision: id, version });
  return { version };
}

// --- Export / import (non-secret settings only) -----------------------------------------------------------

/**
 * The configuration contains no credentials by design (integration secrets live in Kubernetes Secrets and
 * environment variables, never in this document), so exporting it cannot leak them.
 */
export async function exportConfig(which: "published" | "draft"): Promise<string> {
  const config = which === "published" ? (await getPublishedConfig()).config : await getDraftConfig();
  return JSON.stringify({ format: EXPORT_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), config }, null, 2);
}

export { summarizeChanges };

export type ImportPreview = { config: SiteConfig; changes: string[]; warnings: string[] };

/**
 * Validate an uploaded export. Nothing is fetched: images must already exist in this site's media library
 * (missing ones are removed and reported). The result goes into the draft, never straight to live.
 */
export async function previewImport(raw: string): Promise<ImportPreview> {
  if (raw.length > 512_000) throw new PostError("The file is too large (512 KB at most).");
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new PostError("The file is not valid JSON.");
  }
  if (hasForbiddenKeys(doc)) throw new PostError("The file contains forbidden keys (__proto__, constructor or prototype).");
  const d = doc as { format?: unknown; schemaVersion?: unknown; config?: unknown };
  if (d.format !== EXPORT_FORMAT) throw new PostError("This is not a Jithendar.com settings export.");
  if (typeof d.schemaVersion !== "number" || !Number.isInteger(d.schemaVersion) || d.schemaVersion < 1) throw new PostError("The export has no valid schema version.");
  if (d.schemaVersion > SCHEMA_VERSION) throw new PostError(`The export uses schema version ${d.schemaVersion}; this site supports up to ${SCHEMA_VERSION}.`);
  // Strict: missing fields take defaults, but anything invalid is refused (never silently replaced).
  const strict = validateConfig(mergeWithDefaults(d.config, d.schemaVersion));
  if (!strict.ok) throw new PostError("The imported settings are not valid.", 400, strict.issues.map((i) => `${i.path}: ${i.message}`));
  const warnings: string[] = [];
  const images = await checkImages(strict.config);
  const repaired = structuredClone(images.config);
  for (const issue of images.issues) {
    warnings.push(`${issue.path}: image not found in this site's media library, removed.`);
    clearImage(repaired, issue.path);
  }
  const draft = await getDraftConfig();
  return { config: repaired, changes: summarizeChanges(draft, repaired), warnings };
}

function clearImage(c: SiteConfig, path: string) {
  const parts = path.split(".");
  let node: Record<string, unknown> = c as unknown as Record<string, unknown>;
  for (const p of parts.slice(0, -1)) node = node[p] as Record<string, unknown>;
  node[parts.at(-1)!] = null;
}

// --- Draft previews ---------------------------------------------------------------------------------------

export const PREVIEW_COOKIE = "site_preview";
const PREVIEW_TTL_MS = 60 * 60 * 1000;

/** A short-lived token that lets this admin see the draft on real pages (stored server-side, bound to the user). */
export async function createConfigPreview(actor: Actor): Promise<{ token: string; maxAge: number }> {
  requireAdmin(actor);
  const db = await getDb();
  await db.delete(schema.preview).where(lt(schema.preview.expiresAt, new Date()));
  const token = randomBytes(24).toString("base64url");
  await db.insert(schema.preview).values({ token, kind: ENTITY, payload: {}, userId: actor.id, expiresAt: new Date(Date.now() + PREVIEW_TTL_MS) });
  return { token, maxAge: PREVIEW_TTL_MS / 1000 };
}

export async function endConfigPreview(token: string | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return;
  const db = await getDb();
  await db.delete(schema.preview).where(and(eq(schema.preview.token, token), eq(schema.preview.kind, ENTITY)));
}

/** True when `token` is a live site-config preview belonging to `userId`. */
export async function isConfigPreviewValid(token: string, userId: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return false;
  const db = await getDb();
  const [row] = await db
    .select({ userId: schema.preview.userId, expiresAt: schema.preview.expiresAt })
    .from(schema.preview)
    .where(and(eq(schema.preview.token, token), eq(schema.preview.kind, ENTITY), sql`${schema.preview.expiresAt} > now()`));
  return !!row && row.userId === userId;
}
