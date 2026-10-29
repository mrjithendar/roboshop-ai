import { Flash, type FlashParams } from "@/components/admin/Flash";
import { AdminHeader, Card, StatusPill, Table, td, th } from "@/components/admin/ui";
import { Button } from "@/components/ui/form";
import { actorOf, staffActor } from "@/lib/admin";
import { listApiKeys, revokeApiKey } from "@/lib/api-keys";
import { formatDateTime } from "@/lib/dates";
import { flash } from "@/lib/flash";
import { requireRole } from "@/lib/session";
import { CreateKeyForm } from "./CreateKeyForm";

export const metadata = { title: "API keys" };

async function revoke(form: FormData) {
  "use server";
  const actor = await staffActor();
  await flash("/admin/api-keys", async () => {
    await revokeApiKey(actor, String(form.get("id")));
    return "Key revoked. It stops working immediately.";
  });
}

export default async function ApiKeysPage({ searchParams }: { searchParams: FlashParams }) {
  const me = actorOf(await requireRole("admin", "author"));
  const [keys, sp] = await Promise.all([listApiKeys(me), searchParams]);
  return (
    <>
      <AdminHeader title="API keys" description="Manage posts from scripts and automations. A key acts with its owner's permissions." />
      <Flash ok={sp.ok} error={sp.error} />
      <Card className="mb-6"><CreateKeyForm /></Card>
      <Table head={<tr><th className={th}>Name</th><th className={th}>Key</th><th className={th}>Scopes</th><th className={th}>Status</th><th className={th}>Last used</th><th className={th} /></tr>}>
        {keys.length === 0 && <tr><td className={td} colSpan={6}>No keys yet.</td></tr>}
        {keys.map(({ key: k, owner, state }) => (
          <tr key={k.id}>
            <td className={td}><p className="font-medium text-fg">{k.name}</p><p className="text-xs text-slate-500">{owner}</p></td>
            <td className={`${td} font-mono text-xs`}>{k.prefix}…</td>
            <td className={`${td} text-xs`}>{k.scopes.join(", ")}</td>
            <td className={td}><StatusPill status={state === "active" ? "approved" : state === "expired" ? "archived" : "rejected"} /> <span className="text-xs text-slate-500">{k.revokedAt ? "revoked" : k.expiresAt ? `expires ${formatDateTime(k.expiresAt.toISOString())}` : "no expiry"}</span></td>
            <td className={`${td} whitespace-nowrap text-xs`}>{k.lastUsedAt ? formatDateTime(k.lastUsedAt.toISOString()) : "never"}</td>
            <td className={td}>{!k.revokedAt && <form action={revoke}><input type="hidden" name="id" value={k.id} /><Button type="submit" variant="ghost">Revoke</Button></form>}</td>
          </tr>
        ))}
      </Table>
      <Card className="mt-8">
        <h2 className="font-semibold text-fg">Using the API</h2>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">{`# List posts
curl -H "Authorization: Bearer $KEY" https://jithendar.com/api/v1/posts?status=published

# Create a draft
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  https://jithendar.com/api/v1/posts -d '{
  "collection": "blog", "slug": "my-post", "title": "A post created through the API",
  "description": "A description between fifty and one hundred and sixty characters long.",
  "category": "kubernetes", "contentType": "tutorial", "status": "draft",
  "body": "## Hello\\n\\nMarkdown body."
}'

# Publish it (partial update)
curl -X PATCH -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  https://jithendar.com/api/v1/posts/<id> -d '{"status":"published","publishedAt":"2026-10-27T18:00:00+05:30"}'

# Delete
curl -X DELETE -H "Authorization: Bearer $KEY" https://jithendar.com/api/v1/posts/<id>`}</pre>
        <p className="mt-3 text-sm text-fg-muted">Limits: 120 requests per minute per key. Errors return JSON: <code>{"{ error: { message, issues } }"}</code>.</p>
      </Card>
    </>
  );
}
