import { and, count, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import Link from "next/link";
import { AdminHeader } from "@/components/admin/ui";
import { Input, Select } from "@/components/ui/form";
import { getDb, schema } from "@/db";
import { formatDateTime } from "@/lib/dates";
import { postCounts } from "@/lib/posts";
import { requireRole } from "@/lib/session";
import { BulkPosts } from "./BulkPosts";

export const metadata = { title: "Posts" };

type Search = { q?: string; status?: string; collection?: string; page?: string };
const PAGE_SIZE = 25;
const STATUSES = [
  ["", "All"],
  ["draft", "Drafts"],
  ["review", "In review"],
  ["scheduled", "Scheduled"],
  ["published", "Published"],
  ["archived", "Archived"],
  ["trash", "Trash"],
] as const;

const like = (q: string) => `%${q.replace(/[%_\\]/g, "\\$&")}%`;

export default async function PostsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireRole("admin", "author");
  const { q = "", status = "", collection = "", page: rawPage } = await searchParams;
  const page = Math.max(1, Math.floor(Number(rawPage) || 1));
  const db = await getDb();
  const where = and(
    user.role === "author" ? eq(schema.post.authorId, user.id) : undefined,
    status === "trash" ? isNotNull(schema.post.deletedAt) : isNull(schema.post.deletedAt),
    status && status !== "trash" ? eq(schema.post.status, status) : undefined,
    collection ? eq(schema.post.collection, collection) : undefined,
    q.trim() ? or(ilike(schema.post.title, like(q.trim())), ilike(schema.post.slug, like(q.trim()))) : undefined,
  );
  const [rows, [total], counts] = await Promise.all([
    db
      .select({ post: schema.post, author: schema.user.name })
      .from(schema.post)
      .leftJoin(schema.user, eq(schema.user.id, schema.post.authorId))
      .where(where)
      .orderBy(desc(sql`coalesce(${schema.post.deletedAt}, ${schema.post.savedAt})`))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(schema.post).where(where),
    postCounts(),
  ]);
  const pages = Math.max(1, Math.ceil((total?.n ?? 0) / PAGE_SIZE));
  const href = (over: Partial<Search>) => {
    const p = new URLSearchParams(Object.entries({ q, status, collection, ...over }).filter(([, v]) => v) as [string, string][]);
    const s = p.toString();
    return s ? `/admin/posts?${s}` : "/admin/posts";
  };
  const allCount = Object.entries(counts).filter(([k]) => k !== "trash").reduce((n, [, c]) => n + c, 0);

  return (
    <>
      <AdminHeader
        title="Posts"
        description="Write, review, schedule and publish articles, news and projects."
        actions={<Link href="/admin/posts/new" className="inline-flex items-center rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-ink">New post</Link>}
      />
      <nav aria-label="Filter by status" className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1 text-sm">
        {STATUSES.map(([value, label]) => (
          <Link key={value} href={href({ status: value, page: undefined })} aria-current={status === value ? "page" : undefined}
            className={`shrink-0 rounded-full px-3 py-1.5 font-medium ${status === value ? "bg-ink text-white dark:bg-white dark:text-ink" : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-white/5"}`}>
            {label} <span className="opacity-60">({value ? (counts[value] ?? 0) : allCount})</span>
          </Link>
        ))}
      </nav>
      <form className="mb-6 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
        <input type="hidden" name="status" value={status} />
        <Input name="q" defaultValue={q} placeholder="Search title or slug" aria-label="Search posts" />
        <Select name="collection" defaultValue={collection} aria-label="Section">
          <option value="">All sections</option>
          <option value="blog">Articles</option>
          <option value="news">News</option>
          <option value="projects">Projects</option>
        </Select>
        <button type="submit" className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold dark:border-white/15">Search</button>
      </form>
      <BulkPosts
        trash={status === "trash"}
        rows={rows.map(({ post, author }) => ({
          id: post.id,
          title: post.title,
          collection: post.collection,
          slug: post.slug,
          status: post.status,
          category: post.category,
          author: author ?? "—",
          saved: formatDateTime((post.deletedAt ?? post.savedAt).toISOString()),
          scheduledFor: post.status === "scheduled" && post.publishedAt ? formatDateTime(post.publishedAt.toISOString()) : null,
          cover: post.featuredImage?.src ?? null,
        }))}
      />
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-4 text-sm">
          {page > 1 ? <Link href={href({ page: String(page - 1) })} className="rounded-lg px-3 py-2 font-medium underline">← Newer</Link> : <span />}
          <span className="text-slate-500">Page {page} of {pages}</span>
          {page < pages ? <Link href={href({ page: String(page + 1) })} className="rounded-lg px-3 py-2 font-medium underline">Older →</Link> : <span />}
        </nav>
      )}
    </>
  );
}
