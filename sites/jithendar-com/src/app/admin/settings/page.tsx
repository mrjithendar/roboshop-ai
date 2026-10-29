import { revalidatePath } from "next/cache";
import { Flash, type FlashParams } from "@/components/admin/Flash";
import { AdminHeader, Card } from "@/components/admin/ui";
import { Button, Field, Input, Textarea } from "@/components/ui/form";
import { adminActor } from "@/lib/admin";
import { audit } from "@/lib/audit";
import { flash } from "@/lib/flash";
import { PostError } from "@/lib/posts";
import { requireRole } from "@/lib/session";
import { getSettings, saveSettings, settingsSchema } from "@/lib/settings";

export const metadata = { title: "Settings" };

async function save(form: FormData) {
  "use server";
  const actor = await adminActor();
  await flash("/admin/settings", async () => {
    const f = (k: string) => String(form.get(k) ?? "");
    const parsed = settingsSchema.safeParse({
      siteName: f("siteName"),
      publicationName: f("publicationName"),
      description: f("description"),
      hero: { eyebrow: f("hero.eyebrow"), title: f("hero.title"), highlight: f("hero.highlight"), subtitle: f("hero.subtitle") },
      features: { comments: form.has("features.comments"), registration: form.has("features.registration"), contactForm: form.has("features.contactForm") },
      social: { github: f("social.github"), x: f("social.x"), linkedin: f("social.linkedin") },
      announcement: { enabled: form.has("announcement.enabled"), text: f("announcement.text"), href: f("announcement.href") },
    });
    if (!parsed.success) throw new PostError("Settings are not valid.", 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
    await saveSettings(parsed.data, actor.id);
    await audit(actor, "settings.update", "site");
    revalidatePath("/", "layout");
    return "Settings saved. They are live now.";
  });
}

function Check({ name, label, checked, hint }: { name: string; label: string; checked: boolean; hint: string }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" name={name} defaultChecked={checked} className="mt-1" />
      <span><span className="font-medium text-fg">{label}</span><br /><span className="text-slate-500">{hint}</span></span>
    </label>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: FlashParams }) {
  await requireRole("admin");
  const [s, sp] = await Promise.all([getSettings(), searchParams]);
  return (
    <>
      <AdminHeader title="Settings" description="Site identity, homepage text, features and links. Changes go live immediately." />
      <Flash ok={sp.ok} error={sp.error} />
      <form action={save} className="space-y-6">
        <Card>
          <h2 className="mb-4 font-semibold text-fg">Identity</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Site name" htmlFor="siteName" hint="Used in page titles."><Input id="siteName" name="siteName" defaultValue={s.siteName} required /></Field>
            <Field label="Publication name" htmlFor="publicationName" hint="Used for news sitemaps and structured data."><Input id="publicationName" name="publicationName" defaultValue={s.publicationName} required /></Field>
            <div className="sm:col-span-2"><Field label="Description (50–200 characters)" htmlFor="description"><Textarea id="description" name="description" rows={2} defaultValue={s.description} required /></Field></div>
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold text-fg">Homepage hero</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Eyebrow" htmlFor="hero.eyebrow"><Input id="hero.eyebrow" name="hero.eyebrow" defaultValue={s.hero.eyebrow} /></Field>
            <Field label="Highlighted words (gradient)" htmlFor="hero.highlight"><Input id="hero.highlight" name="hero.highlight" defaultValue={s.hero.highlight} /></Field>
            <div className="sm:col-span-2"><Field label="Headline" htmlFor="hero.title"><Input id="hero.title" name="hero.title" defaultValue={s.hero.title} required /></Field></div>
            <div className="sm:col-span-2"><Field label="Subtitle" htmlFor="hero.subtitle"><Textarea id="hero.subtitle" name="hero.subtitle" rows={3} defaultValue={s.hero.subtitle} required /></Field></div>
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold text-fg">Features</h2>
          <div className="space-y-4">
            <Check name="features.comments" label="Comments" checked={s.features.comments} hint="Signed-in readers can comment; comments are moderated." />
            <Check name="features.registration" label="Reader sign-up" checked={s.features.registration} hint="Allow new reader accounts on /login." />
            <Check name="features.contactForm" label="Contact form" checked={s.features.contactForm} hint="Show the form on /contact; messages appear in Admin → Messages." />
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold text-fg">Social links (https://…, leave empty to hide)</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="GitHub" htmlFor="social.github"><Input id="social.github" name="social.github" type="url" defaultValue={s.social.github} /></Field>
            <Field label="X" htmlFor="social.x"><Input id="social.x" name="social.x" type="url" defaultValue={s.social.x} /></Field>
            <Field label="LinkedIn" htmlFor="social.linkedin"><Input id="social.linkedin" name="social.linkedin" type="url" defaultValue={s.social.linkedin} /></Field>
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold text-fg">Announcement bar</h2>
          <div className="space-y-4">
            <Check name="announcement.enabled" label="Show the announcement bar" checked={s.announcement.enabled} hint="A thin bar above the header on every page." />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Text" htmlFor="announcement.text"><Input id="announcement.text" name="announcement.text" defaultValue={s.announcement.text} maxLength={200} /></Field>
              <Field label="Link (/path or https://…)" htmlFor="announcement.href"><Input id="announcement.href" name="announcement.href" defaultValue={s.announcement.href} /></Field>
            </div>
          </div>
        </Card>
        <Button type="submit">Save settings</Button>
      </form>
    </>
  );
}
