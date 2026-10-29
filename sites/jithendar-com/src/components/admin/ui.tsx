import type { ReactNode } from "react";

export function AdminHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-fg [overflow-wrap:anywhere]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[0.9375rem] leading-6 text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-surface p-5 sm:p-6 ${className}`}>{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card>
      <p className="text-sm text-fg-subtle">{label}</p>
      <p className="mt-1.5 text-3xl font-semibold tracking-tight text-fg tabular-nums">{value}</p>
      {hint && <p className="mt-2 text-sm text-fg-subtle">{hint}</p>}
    </Card>
  );
}

const statusTones: Record<string, string> = {
  published: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300",
  review: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300",
  draft: "bg-surface-sunken text-fg-muted ring-slate-600/20",
  archived: "bg-slate-100 text-fg-subtle ring-slate-600/10 dark:bg-white/5",
  pending: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300",
  rejected: "bg-surface-sunken text-fg-muted ring-slate-600/20",
  spam: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300",
  new: "bg-brand-50 text-accent-text ring-brand-600/20 dark:bg-brand-500/10",
  read: "bg-surface-sunken text-fg-muted ring-slate-600/20",
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300",
  degraded: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300",
  down: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300",
  scheduled: "bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300",
  trash: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300",
  "not configured": "bg-surface-sunken text-fg-muted ring-slate-600/20",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset ${statusTones[status] ?? statusTones.draft}`}>
      {status}
    </span>
  );
}

export const th = "whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold text-fg-subtle";
export const td = "px-4 py-3 align-top text-sm text-fg-muted";

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface" tabIndex={0} role="region" aria-label="Table (scrolls sideways)">
      <table className="min-w-full divide-y divide-line">
        <thead className="bg-surface-muted">{head}</thead>
        <tbody className="divide-y divide-line [&>tr]:transition-colors [&>tr:hover]:bg-surface-muted">{children}</tbody>
      </table>
    </div>
  );
}
