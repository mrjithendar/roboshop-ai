import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Flash, type FlashParams } from "@/components/admin/Flash";
import { AdminHeader, Card } from "@/components/admin/ui";
import { Button, Field, Input, Textarea } from "@/components/ui/form";
import { getDb, schema } from "@/db";
import { staffActor } from "@/lib/admin";
import { audit } from "@/lib/audit";
import { invalidateContent } from "@/lib/content";
import { flash } from "@/lib/flash";
import { PostError } from "@/lib/posts";
import { requireRole } from "@/lib/session";

export const metadata = { title: "Author profile" };

const profileInput = z.object({
  displayName: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "URL slug must be kebab-case").max(60),
  jobTitle: z.string().trim().max(120),
  bio: z.string().max(20_000),
  sameAs: z.array(z.url({ protocol: /^https$/ })).max(10),
});

async function save(form: FormData) {
  "use server";
  const actor = await staffActor();
  await flash("/admin/profile", async () => {
    const parsed = profileInput.safeParse({
      displayName: form.get("displayName"),
      slug: form.get("slug"),
      jobTitle: form.get("jobTitle") ?? "",
      bio: form.get("bio") ?? "",
      sameAs: String(form.get("sameAs") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    });
    if (!parsed.success) throw new PostError("The profile is not valid.", 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
    const v = parsed.data;
    const db = await getDb();
    const values = { displayName: v.displayName, slug: v.slug, jobTitle: v.jobTitle || null, bio: v.bio, sameAs: v.sameAs, updatedAt: new Date() };
    try {
      await db.insert(schema.authorProfile).values({ userId: actor.id, ...values }).onConflictDoUpdate({ target: schema.authorProfile.userId, set: values });
    } catch {
      throw new PostError(`The URL slug "${v.slug}" is taken by another author.`, 409);
    }
    await audit(actor, "profile.update", actor.id);
    invalidateContent();
    revalidatePath("/", "layout");
    return "Profile saved.";
  });
}

export default async function ProfilePage({ searchParams }: { searchParams: FlashParams }) {
  const user = await requireRole("admin", "author");
  const db = await getDb();
  const [p] = await db.select().from(schema.authorProfile).where(eq(schema.authorProfile.userId, user.id));
  const sp = await searchParams;
  return (
    <>
      <AdminHeader title="Author profile" description={p ? `Public at /authors/${p.slug}` : "Create the public profile shown on your posts."} />
      <Flash ok={sp.ok} error={sp.error} />
      <Card>
        <form action={save} className="grid gap-5 sm:grid-cols-2">
          <Field label="Display name" htmlFor="displayName"><Input id="displayName" name="displayName" defaultValue={p?.displayName ?? user.name} required /></Field>
          <Field label="Profile URL slug" htmlFor="slug" hint="jithendar.com/authors/…"><Input id="slug" name="slug" defaultValue={p?.slug ?? ""} required className="font-mono text-sm" /></Field>
          <div className="sm:col-span-2"><Field label="Job title" htmlFor="jobTitle"><Input id="jobTitle" name="jobTitle" defaultValue={p?.jobTitle ?? ""} /></Field></div>
          <div className="sm:col-span-2"><Field label="Bio (Markdown)" htmlFor="bio"><Textarea id="bio" name="bio" rows={8} defaultValue={p?.bio ?? ""} /></Field></div>
          <div className="sm:col-span-2"><Field label="Profile links" htmlFor="sameAs" hint="One https:// URL per line (GitHub, LinkedIn, X…)."><Textarea id="sameAs" name="sameAs" rows={3} defaultValue={(p?.sameAs ?? []).join("\n")} className="font-mono text-sm" /></Field></div>
          <div><Button type="submit">Save profile</Button></div>
        </form>
      </Card>
    </>
  );
}
