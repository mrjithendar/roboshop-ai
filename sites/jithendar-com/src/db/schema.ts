import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";


const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// --- Better Auth (email + password, admin plugin, database rate limiting) -------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  // admin plugin
  role: text("role").notNull().default("user"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: ts("ban_expires"),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// --- Publication --------------------------------------------------------------------

/** Public author profile for a user with role author or admin. */
export const authorProfile = pgTable("author_profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  jobTitle: text("job_title"),
  bio: text("bio").notNull().default(""),
  sameAs: jsonb("same_as").$type<string[]>().notNull().default([]),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type Source = { title: string; url: string; publisher: string };
export type Correction = { date: string; note: string };
export type FeaturedImage = { src: string; alt: string; width: number; height: number };

export const post = pgTable(
  "post",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collection: text("collection").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    body: text("body").notNull().default(""),
    category: text("category").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    contentType: text("content_type").notNull(),
    status: text("status").notNull().default("draft"),
    publishedAt: ts("published_at"),
    /** Substantive-update time shown to readers (not every save). */
    updatedAt: ts("updated_at"),
    canonicalUrl: text("canonical_url"),
    featuredImage: jsonb("featured_image").$type<FeaturedImage | null>(),
    sources: jsonb("sources").$type<Source[]>().notNull().default([]),
    corrections: jsonb("corrections").$type<Correction[]>().notNull().default([]),
    sponsored: boolean("sponsored").notNull().default(false),
    sponsor: text("sponsor"),
    related: text("related").array().notNull().default(sql`'{}'::text[]`),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    savedAt: ts("saved_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("post_collection_slug_idx").on(t.collection, t.slug),
    index("post_status_published_idx").on(t.status, t.publishedAt),
  ],
);

export const page = pgTable("page", {
  slug: text("slug").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  body: text("body").notNull().default(""),
  updatedAt: ts("updated_at"),
  savedAt: ts("saved_at").notNull().defaultNow(),
});

export const setting = pgTable("setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export const comment = pgTable(
  "comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => post.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    /** pending → approved | rejected | spam */
    status: text("status").notNull().default("pending"),
    createdAt: ts("created_at").notNull().defaultNow(),
    moderatedAt: ts("moderated_at"),
    moderatedBy: text("moderated_by"),
  },
  (t) => [index("comment_post_status_idx").on(t.postId, t.status), index("comment_status_idx").on(t.status, t.createdAt)],
);

export const contactMessage = pgTable(
  "contact_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    /** new → read → archived */
    status: text("status").notNull().default("new"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("contact_status_idx").on(t.status, t.createdAt)],
);

/** Uploaded images. Bytes live in S3 at `storageKey`; this row holds metadata only. */
export const media = pgTable("media", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  /** Folder context, e.g. posts/blog/my-post, pages/about, authors/jane, library. */
  context: text("context").notNull().default("library"),
  sizeBytes: integer("size_bytes").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  alt: text("alt").notNull().default(""),
  uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const apiKey = pgTable(
  "api_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** First characters of the key, shown in the admin so keys can be told apart. */
    prefix: text("prefix").notNull(),
    /** SHA-256 of the full key; the key itself is shown once and never stored. */
    hash: text("hash").notNull().unique(),
    scopes: text("scopes").array().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastUsedAt: ts("last_used_at"),
    expiresAt: ts("expires_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("api_key_user_idx").on(t.userId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id"),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    target: text("target"),
    detail: jsonb("detail"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);


/** Editable categories. Built-in defaults are seeded at setup; slugs are permanent URL parts. */
export const category = pgTable("category", {
  slug: text("slug").primaryKey(),
  label: text("label").notNull(),
  intro: text("intro").notNull(),
  icon: text("icon").notNull().default("layers"),
  tone: text("tone").notNull().default("slate"),
  sort: integer("sort").notNull().default(100),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Permanent redirects recorded when a post or page slug changes (old path → new path). */
export const redirect = pgTable("redirect", {
  fromPath: text("from_path").primaryKey(),
  toPath: text("to_path").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Short-lived previews of unsaved editor content (post or page), visible only to their creator or an admin. */
export const preview = pgTable(
  "preview",
  {
    token: text("token").primaryKey(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("preview_expires_idx").on(t.expiresAt)],
);

/** History of backup runs (manual or scheduled). */
export const backupRun = pgTable(
  "backup_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    filename: text("filename"),
    sizeBytes: integer("size_bytes"),
    results: jsonb("results").$type<{ destination: string; ok: boolean; detail: string }[]>().notNull().default([]),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    triggeredBy: text("triggered_by"),
  },
  (t) => [index("backup_run_started_idx").on(t.startedAt)],
);
