import { Flash, type FlashParams } from "@/components/admin/Flash";
import { AdminHeader, StatusPill, Table, td, th } from "@/components/admin/ui";
import { Button, Select } from "@/components/ui/form";
import { adminActor } from "@/lib/admin";
import { formatDate } from "@/lib/dates";
import { flash } from "@/lib/flash";
import { requireRole } from "@/lib/session";
import { deleteUser, listUsers, setBanned, setRole } from "@/lib/users";

export const metadata = { title: "Users" };

async function role(form: FormData) {
  "use server";
  const actor = await adminActor();
  await flash("/admin/users", async () => {
    await setRole(actor, String(form.get("id")), String(form.get("role")));
    return "Role updated.";
  });
}

async function ban(form: FormData) {
  "use server";
  const actor = await adminActor();
  await flash("/admin/users", async () => {
    const banned = form.get("banned") === "true";
    await setBanned(actor, String(form.get("id")), banned);
    return banned ? "User banned and signed out." : "User unbanned.";
  });
}

async function remove(form: FormData) {
  "use server";
  const actor = await adminActor();
  await flash("/admin/users", async () => {
    await deleteUser(actor, String(form.get("id")));
    return "User deleted.";
  });
}

export default async function UsersPage({ searchParams }: { searchParams: FlashParams }) {
  const me = await requireRole("admin");
  const [rows, sp] = await Promise.all([listUsers(), searchParams]);
  return (
    <>
      <AdminHeader title="Users" description="Readers, authors and admins. Authors can write and publish their own posts." />
      <Flash ok={sp.ok} error={sp.error} />
      <Table head={<tr><th className={th}>User</th><th className={th}>Role</th><th className={th}>Status</th><th className={th}>Joined</th><th className={th}>Actions</th></tr>}>
        {rows.map(({ user: u, profile }) => (
          <tr key={u.id}>
            <td className={td}>
              <p className="font-medium text-fg">{u.name}{u.id === me.id && " (you)"}</p>
              <p className="text-xs text-slate-500">{u.email}{profile && ` · /authors/${profile}`}</p>
            </td>
            <td className={td}>
              <form action={role} className="flex items-center gap-2">
                <input type="hidden" name="id" value={u.id} />
                <Select name="role" defaultValue={u.role} aria-label={`Role for ${u.name}`} disabled={u.id === me.id} className="w-28 py-1.5">
                  <option value="user">Reader</option>
                  <option value="author">Author</option>
                  <option value="admin">Admin</option>
                </Select>
                {u.id !== me.id && <Button type="submit" variant="secondary" className="px-3 py-1.5">Save</Button>}
              </form>
            </td>
            <td className={td}><StatusPill status={u.banned ? "spam" : u.emailVerified ? "approved" : "pending"} /> <span className="text-xs text-slate-500">{u.banned ? "banned" : u.emailVerified ? "verified" : "unverified"}</span></td>
            <td className={`${td} whitespace-nowrap`}>{formatDate(u.createdAt.toISOString())}</td>
            <td className={td}>
              {u.id !== me.id && (
                <div className="flex gap-2">
                  <form action={ban}>
                    <input type="hidden" name="id" value={u.id} />
                    <input type="hidden" name="banned" value={u.banned ? "false" : "true"} />
                    <Button type="submit" variant="secondary" className="px-3 py-1.5">{u.banned ? "Unban" : "Ban"}</Button>
                  </form>
                  <form action={remove}>
                    <input type="hidden" name="id" value={u.id} />
                    <Button type="submit" variant="ghost" className="px-3 py-1.5">Delete</Button>
                  </form>
                </div>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}
