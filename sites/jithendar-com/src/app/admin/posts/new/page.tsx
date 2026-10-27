import { AdminHeader } from "@/components/admin/ui";
import { getCategories } from "@/lib/categories";
import { requireRole } from "@/lib/session";
import { PostEditor } from "../PostEditor";

export const metadata = { title: "New post" };

export default async function NewPostPage() {
  await requireRole("admin", "author");
  const categories = await getCategories();
  return (
    <>
      <AdminHeader title="New post" />
      <PostEditor
        id={null}
        categories={categories}
        initial={{
          collection: "blog",
          slug: "",
          title: "",
          description: "",
          body: "",
          category: categories[0]?.slug ?? "kubernetes",
          tags: [],
          contentType: "tutorial",
          status: "draft",
          publishedAt: null,
          updatedAt: null,
          canonicalUrl: null,
          featuredImage: null,
          sources: [],
          sponsored: false,
          sponsor: null,
          related: [],
        }}
      />
    </>
  );
}
