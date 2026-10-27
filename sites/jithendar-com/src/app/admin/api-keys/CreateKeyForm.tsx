"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui/form";
import { createKeyAction, type CreateKeyState } from "./actions";

export function CreateKeyForm() {
  const [state, action, pending] = useActionState<CreateKeyState, FormData>(createKeyAction, {});
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4">
      {state.key && (
        <div className="space-y-2 rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <p className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">Copy this key now. It will not be shown again.</p>
          <div className="flex gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 font-mono text-sm dark:bg-black/30">{state.key}</code>
            <Button type="button" variant="secondary" onClick={async () => { await navigator.clipboard.writeText(state.key!); setCopied(true); }}>{copied ? "Copied" : "Copy"}</Button>
          </div>
        </div>
      )}
      {state.error && <Alert>{state.error}</Alert>}
      <form action={action} className="grid gap-4 sm:grid-cols-[1fr_auto_160px_auto] sm:items-end">
        <Field label="Name" htmlFor="name" hint="What will use this key?"><Input id="name" name="name" required placeholder="e.g. n8n drafting workflow" /></Field>
        <fieldset className="space-y-1 text-sm">
          <legend className="mb-1 font-medium text-ink dark:text-white">Scopes</legend>
          <label className="flex items-center gap-2"><input type="checkbox" name="scopes" value="posts:read" defaultChecked /> posts:read</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="scopes" value="posts:write" /> posts:write</label>
        </fieldset>
        <Field label="Expires" htmlFor="expiresInDays">
          <Select id="expiresInDays" name="expiresInDays" defaultValue="90">
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
            <option value="0">Never</option>
          </Select>
        </Field>
        <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create key"}</Button>
      </form>
    </div>
  );
}
