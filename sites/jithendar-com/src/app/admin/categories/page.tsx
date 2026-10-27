import { revalidatePath } from "next/cache";
import { toneFor, toneNames } from "@/components/categoryStyle";
import { Flash, type FlashParams } from "@/components/admin/Flash";
import { AdminHeader, Card } from "@/components/admin/ui";
import { CategoryIcon, iconNames } from "@/components/icons";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/form";
import { staffActor } from "@/lib/admin";
import { getCategories } from "@/lib/categories";
import { articlesInCategory } from "@/lib/content";
import { flash } from "@/lib/flash";
import { requireRole } from "@/lib/session";
import { deleteCategory, saveCategory, seedCategories } from "@/lib/taxonomy-admin";

export const metadata = { title: "Categories" };

async function save(form: FormData) {
  "use server";
  const actor = await staffActor();
  const original = String(form.get("original") ?? "") || null;
  await flash("/admin/categories", async () => {
    await saveCategory(actor, original, Object.fromEntries(form));
    revalidatePath("/", "layout");
    return original ? "Category updated." : "Category created.";
  });
}

async function remove(form: FormData) {
  "use server";
  const actor = await staffActor();
  await flash("/admin/categories", async () => {
    await deleteCategory(actor, String(form.get("slug")));
    return "Category deleted.";
  });
}

function CategoryFields({ c }: { c?: { slug: string; label: string; intro: string; icon: string; tone: string; sort: number } }) {
  const id = c?.slug ?? "new";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" htmlFor={`label-${id}`}><Input id={`label-${id}`} name="label" defaultValue={c?.label} required /></Field>
      <Field label="URL slug" htmlFor={`slug-${id}`} hint="Renaming moves its posts and redirects the old topic URL."><Input id={`slug-${id}`} name="slug" defaultValue={c?.slug} required className="font-mono text-sm" /></Field>
      <div className="sm:col-span-2">
        <Field label="Intro (shown on the topic page; 40–300 characters)" htmlFor={`intro-${id}`}><Textarea id={`intro-${id}`} name="intro" rows={2} defaultValue={c?.intro} required /></Field>
      </div>
      <Field label="Icon" htmlFor={`icon-${id}`}>
        <Select id={`icon-${id}`} name="icon" defaultValue={c?.icon ?? "layers"}>{iconNames.map((n) => <option key={n}>{n}</option>)}</Select>
      </Field>
      <Field label="Colour" htmlFor={`tone-${id}`}>
        <Select id={`tone-${id}`} name="tone" defaultValue={c?.tone ?? "slate"}>{toneNames.map((n) => <option key={n}>{n}</option>)}</Select>
      </Field>
      <Field label="Order" htmlFor={`sort-${id}`}><Input id={`sort-${id}`} name="sort" type="number" defaultValue={c?.sort ?? 100} /></Field>
    </div>
  );
}

export default async function CategoriesPage({ searchParams }: { searchParams: FlashParams }) {
  await requireRole("admin", "author");
  await seedCategories();
  const cats = await getCategories();
  const counts = await Promise.all(cats.map(async (c) => (await articlesInCategory(c.slug)).length));
  const sp = await searchParams;
  return (
    <>
      <AdminHeader title="Categories" description="Topics that organise posts. Each has its own page and RSS feed." />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="space-y-4">
        {cats.map((c, i) => (
          <Card key={c.slug}>
            <details>
              <summary className="flex cursor-pointer items-center gap-3">
                <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-inset ${toneFor(c.tone)}`}><CategoryIcon name={c.icon} className="h-5 w-5" /></span>
                <span className="font-semibold text-ink dark:text-white">{c.label}</span>
                <span className="text-sm text-slate-500">/{c.slug} · {counts[i]} published</span>
              </summary>
              <form action={save} className="mt-5 space-y-4">
                <input type="hidden" name="original" value={c.slug} />
                <CategoryFields c={c} />
                <Button type="submit">Save</Button>
              </form>
              <form action={remove} className="mt-3">
                <input type="hidden" name="slug" value={c.slug} />
                <Button type="submit" variant="ghost">Delete (only when no posts use it)</Button>
              </form>
            </details>
          </Card>
        ))}
        <Card>
          <h2 className="mb-4 font-semibold text-ink dark:text-white">New category</h2>
          <form action={save} className="space-y-4">
            <CategoryFields />
            <Button type="submit">Create category</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
