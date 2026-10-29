import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb, schema } from "@/db";
import { actorOf } from "@/lib/admin";
import { getCategories } from "@/lib/categories";
import { imageGenerationStatus } from "@/lib/image-generation";
import { rowToForm } from "@/lib/post-form";
import { getPostRow, PostError } from "@/lib/posts";
import { getAutosave } from "@/lib/revisions";
import { requireRole } from "@/lib/session";
import { PostEditor } from "../PostEditor";

export const metadata = { title: "Edit post" };

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("admin", "author");
  const actor = actorOf(user);
  const { id } = await params;
  const row = await getPostRow(actor, id).catch((e) => {
    if (e instanceof PostError) notFound();
    throw e;
  });
  if (row.deletedAt) notFound();
  const db = await getDb();
  const [categories, imageGeneration, autosave, [author]] = await Promise.all([
    getCategories(),
    imageGenerationStatus(),
    getAutosave(actor, "post", id),
    db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, row.authorId)),
  ]);
  return (
    <PostEditor
      id={row.id}
      initial={rowToForm(row)}
      version={row.version}
      autosaved={autosave ? { value: rowToForm(autosave.payload), savedAt: autosave.savedAt.toISOString(), baseVersion: autosave.baseVersion } : null}
      userId={user.id}
      authorName={author?.name ?? "Unknown"}
      categories={categories}
      imageGeneration={imageGeneration}
    />
  );
}
