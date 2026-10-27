import { AdminHeader } from "@/components/admin/ui";
import { requireRole } from "@/lib/session";
import { PageEditor } from "../PageEditor";

export const metadata = { title: "New page" };

export default async function NewPage() {
  await requireRole("admin", "author");
  return (
    <>
      <AdminHeader title="New page" />
      <PageEditor originalSlug={null} initial={{ slug: "", title: "", description: "", body: "", updatedAt: null }} />
    </>
  );
}
