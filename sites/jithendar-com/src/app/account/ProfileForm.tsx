"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui/form";
import { updateProfileAction, type AccountResult } from "./actions";

type Values = { name: string; bio: string; website: string; github: string; linkedin: string; x: string };

export function ProfileForm({ initial, limits }: { initial: Values; limits: { name: number; bio: number; url: number } }) {
  const router = useRouter();
  const [bio, setBio] = useState(initial.bio);
  const [result, setResult] = useState<AccountResult | null>(null);
  const [pending, start] = useTransition();
  const errors = result && !result.ok ? (result.fieldErrors ?? {}) : {};

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    start(async () => {
      const r = await updateProfileAction(form);
      setResult(r);
      if (r.ok) router.refresh(); // header avatar/name come from the session
      else if (r.code === "UNAUTHORIZED") router.push("/login?next=/account&expired=1");
    });
  }

  const err = (name: keyof Values) => (errors[name] ? { "aria-invalid": true as const, "aria-describedby": `p-${name}-error` } : {});

  return (
    <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <Field label="Display name" htmlFor="p-name" error={errors.name} hint="Shown next to your comments.">
          <Input id="p-name" name="name" defaultValue={initial.name} required maxLength={limits.name} autoComplete="nickname" {...err("name")} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Short bio" htmlFor="p-bio" optional error={errors.bio} hint={`${bio.length}/${limits.bio} characters`}>
          <Textarea id="p-bio" name="bio" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={limits.bio} {...err("bio")} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Website" htmlFor="p-website" optional error={errors.website}>
          <Input id="p-website" name="website" type="url" inputMode="url" placeholder="https://example.com" defaultValue={initial.website} maxLength={limits.url} autoComplete="url" {...err("website")} />
        </Field>
      </div>
      <Field label="GitHub" htmlFor="p-github" optional error={errors.github}>
        <Input id="p-github" name="github" type="url" inputMode="url" placeholder="https://github.com/you" defaultValue={initial.github} maxLength={limits.url} {...err("github")} />
      </Field>
      <Field label="LinkedIn" htmlFor="p-linkedin" optional error={errors.linkedin}>
        <Input id="p-linkedin" name="linkedin" type="url" inputMode="url" placeholder="https://www.linkedin.com/in/you" defaultValue={initial.linkedin} maxLength={limits.url} {...err("linkedin")} />
      </Field>
      <Field label="X" htmlFor="p-x" optional error={errors.x}>
        <Input id="p-x" name="x" type="url" inputMode="url" placeholder="https://x.com/you" defaultValue={initial.x} maxLength={limits.url} {...err("x")} />
      </Field>
      <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center">
        <Button type="submit" loading={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
        {result && (
          <div className="min-w-0 flex-1">
            <Alert tone={result.ok ? "success" : "error"}>{result.ok ? result.message : result.error}</Alert>
          </div>
        )}
      </div>
    </form>
  );
}
