import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { toIsoOffset } from "@/lib/dates-iso";
import { log } from "@/lib/log";
import type { Article, Author, ContentStore, Page } from "./load";
import { authorFrontmatter, collectionSchema, pageFrontmatter } from "./schema";
import { collections, type Collection } from "@/config/taxonomy";

const iso = (d: Date | null) => (d ? toIsoOffset(d) : undefined);

/** Load the whole publication from Postgres, re-validating every row with the same schema as files. */
export async function loadContentFromDb(): Promise<ContentStore> {
  const db = await getDb();
  const [postRows, authorRows, pageRows] = await Promise.all([
    db.select().from(schema.post),
    db
      .select({ profile: schema.authorProfile, name: schema.user.name })
      .from(schema.authorProfile)
      .innerJoin(schema.user, eq(schema.user.id, schema.authorProfile.userId)),
    db.select().from(schema.page),
  ]);

  const authors = new Map<string, Author>();
  const authorSlugById = new Map<string, string>();
  for (const { profile } of authorRows) {
    const parsed = authorFrontmatter.safeParse({
      name: profile.displayName,
      slug: profile.slug,
      ...(profile.jobTitle ? { jobTitle: profile.jobTitle } : {}),
      sameAs: profile.sameAs,
    });
    if (!parsed.success) {
      log.error("invalid author profile skipped", { userId: profile.userId });
      continue;
    }
    authorSlugById.set(profile.userId, profile.slug);
    authors.set(profile.slug, { slug: profile.slug, path: `/authors/${profile.slug}`, frontmatter: parsed.data, body: profile.bio, file: `db:author/${profile.userId}` });
  }

  const articles: Article[] = [];
  for (const row of postRows) {
    if (row.deletedAt || !(collections as readonly string[]).includes(row.collection)) continue;
    const collection = row.collection as Collection;
    const parsed = collectionSchema(collection).safeParse({
      title: row.title,
      slug: row.slug,
      description: row.description,
      author: authorSlugById.get(row.authorId) ?? "unknown-author",
      category: row.category,
      tags: row.tags,
      contentType: row.contentType,
      status: row.status,
      publishedAt: iso(row.publishedAt),
      updatedAt: iso(row.updatedAt),
      canonicalUrl: row.canonicalUrl ?? undefined,
      featuredImage: row.featuredImage ?? undefined,
      sources: row.sources,
      corrections: row.corrections,
      sponsored: row.sponsored,
      sponsor: row.sponsor ?? undefined,
      related: row.related,
      seoTitle: row.seoTitle ?? undefined,
      seoDescription: row.seoDescription ?? undefined,
      socialTitle: row.socialTitle ?? undefined,
      socialDescription: row.socialDescription ?? undefined,
      socialImage: row.socialImage ?? undefined,
      noindex: row.noindex,
    });
    if (!parsed.success || !authors.has(parsed.data.author)) {
      log.error("invalid post skipped", { postId: row.id, issues: parsed.success ? ["unknown author"] : parsed.error.issues.map((i) => i.message) });
      continue;
    }
    articles.push({ id: row.id, collection, slug: row.slug, path: `/${collection}/${row.slug}`, frontmatter: parsed.data, body: row.body, file: `db:post/${row.id}` });
  }

  const pages = new Map<string, Page>();
  for (const row of pageRows) {
    if (row.deletedAt) continue;
    const parsed = pageFrontmatter.safeParse({
      title: row.title,
      slug: row.slug,
      description: row.description,
      updatedAt: iso(row.updatedAt),
      seoTitle: row.seoTitle ?? undefined,
      seoDescription: row.seoDescription ?? undefined,
      noindex: row.noindex,
      sortOrder: row.sortOrder,
    });
    if (!parsed.success) continue;
    pages.set(row.slug, { slug: row.slug, path: `/${row.slug}`, frontmatter: parsed.data, body: row.body, file: `db:page/${row.slug}` });
  }

  return { articles, authors, pages };
}
