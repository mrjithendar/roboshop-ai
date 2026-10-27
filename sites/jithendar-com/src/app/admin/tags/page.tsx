import { Flash, type FlashParams } from "@/components/admin/Flash";
import { AdminHeader, Table, td, th } from "@/components/admin/ui";
import { Button, Input } from "@/components/ui/form";
import { staffActor } from "@/lib/admin";
import { flash } from "@/lib/flash";
import { requireRole } from "@/lib/session";
import { deleteTag, renameTag, tagUsage } from "@/lib/taxonomy-admin";

export const metadata = { title: "Tags" };

async function rename(form: FormData) {
  "use server";
  const actor = await staffActor();
  await flash("/admin/tags", async () => {
    await renameTag(actor, String(form.get("from")), String(form.get("to")));
    return "Tag renamed (merged if the new name already existed).";
  });
}

async function remove(form: FormData) {
  "use server";
  const actor = await staffActor();
  await flash("/admin/tags", async () => {
    await deleteTag(actor, String(form.get("tag")));
    return "Tag removed from all posts.";
  });
}

export default async function TagsPage({ searchParams }: { searchParams: FlashParams }) {
  await requireRole("admin", "author");
  const tags = await tagUsage();
  const sp = await searchParams;
  return (
    <>
      <AdminHeader title="Tags" description="Rename a tag to fix it everywhere; renaming onto an existing tag merges them." />
      <Flash ok={sp.ok} error={sp.error} />
      <Table head={<tr><th className={th}>Tag</th><th className={th}>Posts</th><th className={th}>Rename / merge</th><th className={th} /></tr>}>
        {tags.length === 0 && <tr><td className={td} colSpan={4}>No tags in use yet.</td></tr>}
        {tags.map((t) => (
          <tr key={t.tag}>
            <td className={`${td} font-medium`}>#{t.tag}</td>
            <td className={td}>{t.n}</td>
            <td className={td}>
              <form action={rename} className="flex gap-2">
                <input type="hidden" name="from" value={t.tag} />
                <Input name="to" defaultValue={t.tag} aria-label={`New name for ${t.tag}`} required className="max-w-xs" />
                <Button type="submit" variant="secondary">Rename</Button>
              </form>
            </td>
            <td className={td}>
              <form action={remove}>
                <input type="hidden" name="tag" value={t.tag} />
                <Button type="submit" variant="ghost">Remove</Button>
              </form>
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}
