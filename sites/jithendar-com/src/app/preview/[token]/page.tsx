import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { collections, type Collection } from "@/config/taxonomy";
import { getDb, schema } from "@/db";
import { actorOf } from "@/lib/admin";
import { getCategoryMap } from "@/lib/categories";
import type { Article, Author, Page } from "@/lib/content";
import { collectionSchema, pageFrontmatter, type ArticleFrontmatter } from "@/lib/content/schema";
import { toIsoOffset } from "@/lib/dates-iso";
import { ArticleView } from "@/lib/pages/article";
import { PageView } from "@/lib/pages/page-view";
import { readPreview } from "@/lib/preview";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }> };
type Payload = Record<string, unknown>;

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function Notice({ issues, kind }: { issues: string[]; kind: string }) {
  return (
    <div className="sticky top-16 z-30 border-b border-fuchsia-300 bg-fuchsia-50 px-5 py-3 text-sm text-fuchsia-950 dark:border-fuchsia-500/30 dark:bg-fuchsia-950 dark:text-fuchsia-100">
      <div className="mx-auto max-w-6xl">
        <strong>Preview of unsaved changes.</strong> This {kind} is not published by previewing it. Close this tab to return to the editor.
        {issues.length > 0 && (
          <ul className="mt-2 list-disc pl-5">
            {issues.map((i) => (
              <li key={i}>Will not save yet: {i}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

async function authorFor(userId: string, fallbackName: string): Promise<Author> {
  const db = await getDb();
  const [p] = await db.select().from(schema.authorProfile).where(eq(schema.authorProfile.userId, userId));
  const slug = p?.slug ?? "preview-author";
  return {
    slug,
    path: `/authors/${slug}`,
    frontmatter: { name: p?.displayName ?? fallbackName, slug, sameAs: p?.sameAs ?? [], ...(p?.jobTitle ? { jobTitle: p.jobTitle } : {}) },
    body: p?.bio ?? "",
    file: "preview",
  };
}

export default async function PreviewPage({ params }: Props) {
  const user = await requireRole("admin", "author");
  const preview = await readPreview(actorOf(user), (await params).token);
  if (!preview) notFound();
  const p = preview.payload as Payload;

  if (preview.kind === "page") {
    const fm = {
      title: str(p.title, "Untitled page"),
      slug: str(p.slug, "preview"),
      description: str(p.description),
      updatedAt: str(p.updatedAt) || undefined,
      seoTitle: str(p.seoTitle) || undefined,
      seoDescription: str(p.seoDescription) || undefined,
      noindex: p.noindex === true,
      sortOrder: typeof p.sortOrder === "number" ? p.sortOrder : 100,
    };
    const check = pageFrontmatter.safeParse(fm);
    const page: Page = { slug: fm.slug, path: `/${fm.slug}`, frontmatter: { ...fm }, body: str(p.body), file: "preview" };
    return <PageView page={page} notice={<Notice kind="page" issues={check.success ? [] : check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)} />} />;
  }

  const collection: Collection = (collections as readonly string[]).includes(str(p.collection)) ? (p.collection as Collection) : "blog";
  const author = await authorFor(user.id, user.name);
  const now = toIsoOffset(new Date());
  const candidate = {
    title: str(p.title),
    slug: str(p.slug),
    description: str(p.description),
    author: author.slug,
    category: str(p.category),
    tags: arr<string>(p.tags),
    contentType: str(p.contentType),
    status: str(p.status, "draft"),
    publishedAt: str(p.publishedAt) || undefined,
    updatedAt: str(p.updatedAt) || undefined,
    canonicalUrl: str(p.canonicalUrl) || undefined,
    featuredImage: (p.featuredImage as ArticleFrontmatter["featuredImage"]) ?? undefined,
    sources: arr<{ title: string; url: string; publisher: string }>(p.sources),
    corrections: arr<{ date: string; note: string }>(p.corrections),
    sponsored: p.sponsored === true,
    sponsor: str(p.sponsor) || undefined,
    related: arr<string>(p.related),
    seoTitle: str(p.seoTitle) || undefined,
    seoDescription: str(p.seoDescription) || undefined,
    socialTitle: str(p.socialTitle) || undefined,
    socialDescription: str(p.socialDescription) || undefined,
    socialImage: (p.socialImage as ArticleFrontmatter["socialImage"]) ?? undefined,
    noindex: p.noindex === true,
  };
  const check = collectionSchema(collection).safeParse(candidate);
  const issues = check.success ? [] : check.error.issues.map((i) => `${i.path.join(".") || "post"}: ${i.message}`);
  if (!(await getCategoryMap()).has(candidate.category)) issues.push(`category: "${candidate.category}" does not exist`);

  // Render even when invalid, with safe fallbacks, so the author can see the layout while fixing issues.
  const frontmatter: ArticleFrontmatter = check.success
    ? { ...check.data, publishedAt: check.data.publishedAt ?? now }
    : {
        ...candidate,
        title: candidate.title || "Untitled",
        slug: candidate.slug || "preview",
        category: candidate.category || "kubernetes",
        contentType: (candidate.contentType || "tutorial") as ArticleFrontmatter["contentType"],
        status: "draft",
        tags: candidate.tags.map((t) => t.toLowerCase()),
        publishedAt: candidate.publishedAt ?? now,
      };
  const article: Article = { collection, slug: frontmatter.slug, path: `/${collection}/${frontmatter.slug}`, frontmatter, body: str(p.body), file: "preview", preview: true };
  return <ArticleView article={article} author={author} collection={collection} notice={<Notice kind="post" issues={issues} />} />;
}
