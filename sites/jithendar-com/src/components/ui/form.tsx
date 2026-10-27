import type { ComponentProps, ReactNode } from "react";

export const inputClass =
  "block w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-ink shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 disabled:opacity-60 dark:border-white/15 dark:bg-surface-dark-raised dark:text-white";

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink dark:text-white">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={`${inputClass} font-[inherit] ${props.className ?? ""}`} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

const variants = {
  primary: "bg-ink text-white hover:bg-slate-800 dark:bg-white dark:text-ink dark:hover:bg-slate-200",
  secondary:
    "border border-slate-300 bg-white text-ink hover:border-slate-400 dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:border-white/30",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10",
};

export function Button({ variant = "primary", className = "", ...props }: ComponentProps<"button"> & { variant?: keyof typeof variants }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className}`}
    />
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "success" | "info"; children: ReactNode }) {
  const tones = {
    error: "border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
    info: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200",
  };
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </p>
  );
}
