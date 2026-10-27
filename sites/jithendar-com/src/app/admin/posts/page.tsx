import { and, desc, eq, ilike, or } from "drizzle-orm";
import Link from "next/link";
import { AdminHeader } from "@/components/admin/ui";
import { Input, Select } from "@/components/ui/form";
import { getDb, schema } from "@/db";
import { formatDateTime } from "@/lib/dates";
import { requireRole } from "@/lib/session";
import { BulkPosts } from "./BulkPosts";

export const metadata = { title: "Posts" };

type Search = { q?: string; status?: string; collection?: string };

export default async function PostsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireRole("admin", "author");
  const { q = "", status = "", collection = "" } = await searchParams;
  const db = await getDb();
  const where = and(
    user.role === "author" ? eq(schema.post.authorId, user.id) : undefined,
    status ? eq(schema.post.status, status) : undefined,
    collection ? eq(schema.post.collection, collection) : undefined,
    q ? or(ilike(schema.post.title, `%${q}%`), ilike(schema.post.slug, `%${q}%`)) : undefined,
  );
  const rows = await db
    .select({ post: schema.post, author: schema.user.name })
    .from(schema.post)
    .leftJoin(schema.user, eq(schema.user.id, schema.post.authorId))
    .where(where)
    .orderBy(desc(schema.post.savedAt))
    .limit(200);

  return (
    <>
      <AdminHeader
        title="Posts"
        description="Write, review and publish articles, news and projects."
        actions={<Link href="/admin/posts/new" className="inline-flex items-center rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-ink">New post</Link>}
      />
      <form className="mb-6 grid gap-3 sm:grid-cols-[1fr_180px_180px_auto]">
        <Input name="q" defaultValue={q} placeholder="Search title or slug" aria-label="Search posts" />
        <Select name="status" defaultValue={status} aria-label="Status">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="review">In review</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </Select>
        <Select name="collection" defaultValue={collection} aria-label="Section">
          <option value="">All sections</option>
          <option value="blog">Articles</option>
          <option value="news">News</option>
          <option value="projects">Projects</option>
        </Select>
        <button type="submit" className="rounded-xl border border-slate-300 px-4 text-sm font-semibold dark:border-white/15">Filter</button>
      </form>
      <BulkPosts
        rows={rows.map(({ post, author }) => ({
          id: post.id,
          title: post.title,
          collection: post.collection,
          status: post.status,
          category: post.category,
          author: author ?? "—",
          saved: formatDateTime(post.savedAt.toISOString()),
          cover: post.featuredImage?.src ?? null,
        }))}
      />
    </>
  );
}
