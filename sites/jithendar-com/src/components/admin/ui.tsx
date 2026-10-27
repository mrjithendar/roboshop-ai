import type { ReactNode } from "react";

export function AdminHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink dark:text-white">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-surface-dark-raised ${className}`}>{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card>
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-ink dark:text-white">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </Card>
  );
}

const statusTones: Record<string, string> = {
  published: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300",
  review: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300",
  draft: "bg-slate-100 text-slate-700 ring-slate-600/20 dark:bg-white/10 dark:text-slate-300",
  archived: "bg-slate-100 text-slate-500 ring-slate-600/10 dark:bg-white/5 dark:text-slate-400",
  pending: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300",
  rejected: "bg-slate-100 text-slate-600 ring-slate-600/20 dark:bg-white/10 dark:text-slate-300",
  spam: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300",
  new: "bg-brand-50 text-brand-700 ring-brand-600/20 dark:bg-brand-500/10 dark:text-brand-300",
  read: "bg-slate-100 text-slate-700 ring-slate-600/20 dark:bg-white/10 dark:text-slate-300",
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300",
  degraded: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300",
  down: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300",
  "not configured": "bg-slate-100 text-slate-600 ring-slate-600/20 dark:bg-white/10 dark:text-slate-300",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset ${statusTones[status] ?? statusTones.draft}`}>
      {status}
    </span>
  );
}

export const th = "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400";
export const td = "px-4 py-3 text-sm text-slate-700 dark:text-slate-300";

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-surface-dark-raised">
      <table className="min-w-full divide-y divide-slate-200 dark:divide-white/10">
        <thead className="bg-slate-50 dark:bg-white/[0.03]">{head}</thead>
        <tbody className="divide-y divide-slate-100 dark:divide-white/5">{children}</tbody>
      </table>
    </div>
  );
}
