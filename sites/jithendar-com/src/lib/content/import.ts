import type { Db } from "@/db";
import { schema } from "@/db";
import { loadContent } from "./load";

/** Parse an ISO string with offset into a Date (the DB stores instants; offsets are re-applied on read). */
const toDate = (iso?: string) => (iso ? new Date(iso) : null);

/** Bodies are rendered as plain Markdown; turn owner placeholders into invisible HTML comments. */
export const toMarkdown = (body: string) => body.replace(/<Todo>([\s\S]*?)<\/Todo>/g, (_, t: string) => `<!-- TODO(owner): ${t.trim()} -->`);

/**
 * One-time import of the MDX publication into Postgres. Existing rows (same collection+slug, or page slug)
 * are left untouched, so it is safe to run more than once.
 */
export async function importFromFiles(db: Db, root: string, authorIdBySlug: Map<string, string>) {
  const store = loadContent(root);
  let posts = 0;
  let pages = 0;
  for (const a of store.articles) {
    const fm = a.frontmatter;
    const authorId = authorIdBySlug.get(fm.author);
    if (!authorId) continue;
    const inserted = await db
      .insert(schema.post)
      .values({
        collection: a.collection,
        slug: a.slug,
        title: fm.title,
        description: fm.description,
        body: toMarkdown(a.body),
        category: fm.category,
        tags: fm.tags,
        contentType: fm.contentType,
        status: fm.status,
        publishedAt: toDate(fm.publishedAt),
        updatedAt: toDate(fm.updatedAt),
        canonicalUrl: fm.canonicalUrl ?? null,
        featuredImage: fm.featuredImage ?? null,
        sources: fm.sources,
        corrections: fm.corrections,
        sponsored: fm.sponsored,
        sponsor: fm.sponsor ?? null,
        related: fm.related,
        authorId,
      })
      .onConflictDoNothing()
      .returning({ id: schema.post.id });
    posts += inserted.length;
  }
  for (const p of store.pages.values()) {
    const inserted = await db
      .insert(schema.page)
      .values({ slug: p.slug, title: p.frontmatter.title, description: p.frontmatter.description, body: toMarkdown(p.body), updatedAt: toDate(p.frontmatter.updatedAt) })
      .onConflictDoNothing()
      .returning({ slug: schema.page.slug });
    pages += inserted.length;
  }
  return { posts, pages, authors: store.authors };
}
