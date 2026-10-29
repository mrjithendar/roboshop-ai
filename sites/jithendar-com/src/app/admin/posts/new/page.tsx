import { getCategories } from "@/lib/categories";
import { imageGenerationStatus } from "@/lib/image-generation";
import { rowToForm } from "@/lib/post-form";
import { requireRole } from "@/lib/session";
import { PostEditor } from "../PostEditor";

export const metadata = { title: "New post" };

export default async function NewPostPage() {
  const user = await requireRole("admin", "author");
  const [categories, imageGeneration] = await Promise.all([getCategories(), imageGenerationStatus()]);
  return (
    <PostEditor
      id={null}
      userId={user.id}
      authorName={user.name}
      categories={categories}
      imageGeneration={imageGeneration}
      initial={rowToForm({ collection: "blog", category: categories[0]?.slug ?? "kubernetes", contentType: "tutorial", status: "draft" })}
    />
  );
}
