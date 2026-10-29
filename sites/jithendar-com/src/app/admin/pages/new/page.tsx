import { requireRole } from "@/lib/session";
import { bundledPages, pageRowToForm } from "@/lib/site-pages";
import { PageEditor } from "../PageEditor";

export const metadata = { title: "New page" };

/** ?from=<slug> starts from a bundled draft (content/pages/<slug>.mdx). Nothing is saved until the author saves. */
export default async function NewPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  await requireRole("admin", "author");
  const { from } = await searchParams;
  const draft = from ? (await bundledPages()).get(from) : undefined;
  return <PageEditor originalSlug={null} initial={draft ?? pageRowToForm({})} />;
}
