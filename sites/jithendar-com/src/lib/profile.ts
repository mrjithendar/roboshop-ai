import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { SocialLinks } from "@/db/schema";
import { avatarObjectKey, avatarSrc, parseAvatarSrc, processAvatar } from "./avatar";
import { log } from "./log";
import { PostError } from "./posts";
import { deleteObject, putObject, IMMUTABLE, storageReady } from "./storage";

export const PROFILE_LIMITS = { name: 80, bio: 280, url: 200 } as const;

/** Hosts accepted for each social link; the stored value is always a normalised https URL. */
const SOCIAL_HOSTS: Record<keyof SocialLinks, string[]> = {
  github: ["github.com"],
  linkedin: ["linkedin.com", "www.linkedin.com"],
  x: ["x.com", "twitter.com"],
};

/** Control and bidi-override characters are never accepted in names or bios (they can disguise text). */
const UNSAFE_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/;

function httpsUrl(value: string, hosts?: string[]): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && !hosts)) return null;
  if (url.username || url.password) return null;
  if (hosts && !hosts.includes(url.hostname.toLowerCase())) return null;
  url.hash = "";
  return url.toString();
}

const optionalUrl = (label: string, hosts?: string[]) =>
  z
    .string()
    .trim()
    .max(PROFILE_LIMITS.url, `${label} must be at most ${PROFILE_LIMITS.url} characters.`)
    .transform((v, ctx) => {
      if (!v) return undefined;
      const url = httpsUrl(v, hosts);
      if (!url) {
        ctx.addIssue({ code: "custom", message: hosts ? `${label} must be an https://${hosts[0]}/… link.` : `${label} must be an http(s) link.` });
        return z.NEVER;
      }
      return url;
    });

/**
 * Exactly the fields a person may edit about themselves. Anything else in the input (role, email,
 * emailVerified, banned, image, id…) is dropped by `strip`, never written.
 */
export const profileInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Enter a display name.")
      .max(PROFILE_LIMITS.name, `Display name must be at most ${PROFILE_LIMITS.name} characters.`)
      .refine((v) => !UNSAFE_CHARS.test(v), "Display name contains characters that are not allowed."),
    bio: z
      .string()
      .trim()
      .max(PROFILE_LIMITS.bio, `Bio must be at most ${PROFILE_LIMITS.bio} characters.`)
      .refine((v) => !UNSAFE_CHARS.test(v.replace(/[\n\t]/g, "")), "Bio contains characters that are not allowed."),
    website: optionalUrl("Website"),
    github: optionalUrl("GitHub", SOCIAL_HOSTS.github),
    linkedin: optionalUrl("LinkedIn", SOCIAL_HOSTS.linkedin),
    x: optionalUrl("X", SOCIAL_HOSTS.x),
  })
  .strip();

export type ProfileInput = z.input<typeof profileInput>;

export type AccountProfile = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  bio: string;
  website: string | null;
  socialLinks: SocialLinks;
  role: string;
  createdAt: Date;
  updatedAt: Date;
};

export async function getAccountProfile(userId: string): Promise<AccountProfile | null> {
  const db = await getDb();
  const [u] = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      emailVerified: schema.user.emailVerified,
      image: schema.user.image,
      bio: schema.user.bio,
      website: schema.user.website,
      socialLinks: schema.user.socialLinks,
      role: schema.user.role,
      createdAt: schema.user.createdAt,
      updatedAt: schema.user.updatedAt,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return u ?? null;
}

/** Update the signed-in user's own profile. `userId` always comes from the session, never from the form. */
export async function updateAccountProfile(userId: string, raw: unknown): Promise<AccountProfile> {
  const parsed = profileInput.safeParse(raw);
  if (!parsed.success) throw new PostError("Check the highlighted fields.", 400, parsed.error.issues.map((i) => i.message));
  const { name, bio, website, github, linkedin, x } = parsed.data;
  const socialLinks: SocialLinks = { ...(github ? { github } : {}), ...(linkedin ? { linkedin } : {}), ...(x ? { x } : {}) };
  const db = await getDb();
  await db.update(schema.user).set({ name, bio, website: website ?? null, socialLinks, updatedAt: new Date() }).where(eq(schema.user.id, userId));
  const profile = await getAccountProfile(userId);
  if (!profile) throw new PostError("Account not found.", 404);
  return profile;
}

/** Delete one of our uploaded avatars, if `src` is one and belongs to this user. Failures are logged, never fatal. */
async function deleteOwnAvatar(userId: string, src: string | null) {
  const own = parseAvatarSrc(src);
  if (!own || own.userId !== userId) return;
  try {
    await deleteObject(avatarObjectKey(userId, own.file.replace(/\.webp$/, "")));
  } catch (err) {
    log.warn("avatar cleanup failed", { userId, err });
  }
}

/** Process and store a new avatar, point the profile at it, then delete the replaced upload. */
export async function setAvatar(userId: string, bytes: Buffer): Promise<string> {
  if (!(await storageReady())) throw new PostError("Avatar uploads are not available yet: media storage is not configured.", 503);
  const processed = await processAvatar(bytes);
  if (!processed.ok) throw new PostError(processed.error);
  const fileId = crypto.randomUUID();
  await putObject(avatarObjectKey(userId, fileId), processed.bytes, { contentType: processed.contentType, cacheControl: IMMUTABLE });
  const db = await getDb();
  const [before] = await db.select({ image: schema.user.image }).from(schema.user).where(eq(schema.user.id, userId));
  const src = avatarSrc(userId, fileId);
  await db.update(schema.user).set({ image: src, updatedAt: new Date() }).where(eq(schema.user.id, userId));
  await deleteOwnAvatar(userId, before?.image ?? null);
  return src;
}

/** Remove the avatar (initials are shown instead). A provider avatar URL is simply cleared. */
export async function removeAvatar(userId: string): Promise<void> {
  const db = await getDb();
  const [before] = await db.select({ image: schema.user.image }).from(schema.user).where(eq(schema.user.id, userId));
  await db.update(schema.user).set({ image: null, updatedAt: new Date() }).where(eq(schema.user.id, userId));
  await deleteOwnAvatar(userId, before?.image ?? null);
}

export type ConnectedAccount = { id: string; providerId: string; createdAt: Date };

/** Sign-in methods linked to this user. Provider tokens and ids are never returned. */
export async function connectedAccounts(userId: string): Promise<ConnectedAccount[]> {
  const db = await getDb();
  return db
    .select({ id: schema.account.id, providerId: schema.account.providerId, createdAt: schema.account.createdAt })
    .from(schema.account)
    .where(eq(schema.account.userId, userId))
    .orderBy(schema.account.createdAt);
}

/** True when the avatar file is this user's current one (replaced or removed avatars stop being served). */
export async function isCurrentAvatar(userId: string, file: string): Promise<boolean> {
  const db = await getDb();
  const [u] = await db.select({ image: schema.user.image }).from(schema.user).where(eq(schema.user.id, userId));
  return u?.image === `/media/avatars/${userId}/${file}`;
}
