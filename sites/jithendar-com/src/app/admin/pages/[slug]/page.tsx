import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { AdminHeader } from "@/components/admin/ui";
import { getDb, schema } from "@/db";
import { toIsoOffset } from "@/lib/dates-iso";
import { requireRole } from "@/lib/session";
import { PageEditor } from "../PageEditor";

export const metadata = { title: "Edit page" };

export default async function EditPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireRole("admin", "author");
  const { slug } = await params;
  const db = await getDb();
  const [row] = await db.select().from(schema.page).where(eq(schema.page.slug, slug));
  if (!row) notFound();
  return (
    <>
      <AdminHeader title="Edit page" description={row.title} />
      <PageEditor
        originalSlug={row.slug}
        initial={{ slug: row.slug, title: row.title, description: row.description, body: row.body, updatedAt: row.updatedAt ? toIsoOffset(row.updatedAt) : null }}
      />
    </>
  );
}
