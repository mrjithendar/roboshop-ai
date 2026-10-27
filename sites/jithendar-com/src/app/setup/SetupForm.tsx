"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui/form";
import { setupAction, type SetupState } from "./actions";

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(setupAction, {});
  return (
    <form action={action} className="space-y-5">
      <Field label="Setup token" htmlFor="token" hint="The ADMIN_BOOTSTRAP_TOKEN value from the Kubernetes Secret.">
        <Input id="token" name="token" type="password" autoComplete="off" required />
      </Field>
      <Field label="Your name" htmlFor="name">
        <Input id="name" name="name" autoComplete="name" required />
      </Field>
      <Field label="Admin email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password" hint="At least 12 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
      </Field>
      {state.error && <Alert>{state.error}</Alert>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Setting up…" : "Create admin and import content"}
      </Button>
    </form>
  );
}
