import { notFound } from "next/navigation";
import { AdminHeader } from "@/components/admin/ui";
import { actorOf } from "@/lib/admin";
import { getCategories } from "@/lib/categories";
import { imageGenerationStatus } from "@/lib/image-generation";
import { toIsoOffset } from "@/lib/dates-iso";
import { getPostRow, PostError } from "@/lib/posts";
import { requireRole } from "@/lib/session";
import { PostEditor, type PostFormValue } from "../PostEditor";

export const metadata = { title: "Edit post" };

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = actorOf(await requireRole("admin", "author"));
  const { id } = await params;
  const row = await getPostRow(actor, id).catch((e) => {
    if (e instanceof PostError) notFound();
    throw e;
  });
  const [categories, imageGeneration] = await Promise.all([getCategories(), imageGenerationStatus()]);
  const initial: PostFormValue = {
    collection: row.collection as PostFormValue["collection"],
    slug: row.slug,
    title: row.title,
    description: row.description,
    body: row.body,
    category: row.category,
    tags: row.tags,
    contentType: row.contentType,
    status: row.status as PostFormValue["status"],
    publishedAt: row.publishedAt ? toIsoOffset(row.publishedAt) : null,
    updatedAt: row.updatedAt ? toIsoOffset(row.updatedAt) : null,
    canonicalUrl: row.canonicalUrl,
    featuredImage: row.featuredImage,
    sources: row.sources,
    sponsored: row.sponsored,
    sponsor: row.sponsor,
    related: row.related,
  };
  return (
    <>
      <AdminHeader title="Edit post" description={row.title} />
      <PostEditor id={row.id} initial={initial} categories={categories} imageGeneration={imageGeneration} />
    </>
  );
}
