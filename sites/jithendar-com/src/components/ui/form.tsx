import type { ComponentProps, ReactNode } from "react";
import { AlertIcon, CheckIcon } from "@/components/icons";

/** Text inputs are 16px (no iOS zoom on focus) and 44px tall; invalid fields get a red border via aria-invalid. */
export const inputClass =
  "block w-full min-h-11 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3.5 py-2 text-base text-fg shadow-xs transition-colors placeholder:text-fg-subtle hover:border-slate-400 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/20 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-subtle aria-invalid:border-red-500 aria-invalid:focus:ring-red-500/20 dark:hover:border-white/30";

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  optional = false,
}: {
  label: string;
  hint?: ReactNode;
  /** Validation message; give the control aria-invalid and aria-describedby={`${htmlFor}-error`}. */
  error?: ReactNode;
  children: ReactNode;
  htmlFor: string;
  optional?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-fg">
        {label}
        {optional && <span className="font-normal text-fg-subtle"> (optional)</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-sm text-fg-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} className="flex items-start gap-1.5 text-sm text-red-700 dark:text-red-300">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={`${inputClass} font-[inherit] leading-6 ${props.className ?? ""}`} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={`${inputClass} pr-9 ${props.className ?? ""}`} />;
}

/** Shared button look, also for links styled as buttons (`<Link className={buttonClass()}>`). */
const variants = {
  primary: "bg-accent text-on-accent shadow-xs hover:bg-accent-hover active:bg-accent-hover",
  secondary: "border border-line-strong bg-surface text-fg shadow-xs hover:bg-surface-muted hover:border-slate-400 dark:hover:border-white/30",
  danger: "bg-red-600 text-white shadow-xs hover:bg-red-700 active:bg-red-800",
  ghost: "text-fg-muted hover:bg-surface-sunken hover:text-fg",
};
const sizes = {
  sm: "min-h-9 px-3 text-sm",
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-12 px-5 text-base",
};

export type ButtonVariant = keyof typeof variants;

export function buttonClass(variant: ButtonVariant = "primary", size: keyof typeof sizes = "md") {
  return `inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:opacity-55 ${variants[variant]} ${sizes[size]}`;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: keyof typeof sizes; loading?: boolean }) {
  return (
    <button {...props} disabled={disabled || loading} aria-busy={loading || undefined} className={`${buttonClass(variant, size)} ${className}`}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`animate-spin motion-reduce:animate-none ${className}`} aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "success" | "info"; children: ReactNode }) {
  const tones = {
    error: "border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
    info: "border-line bg-surface-muted text-fg",
  };
  const Icon = tone === "success" ? CheckIcon : AlertIcon;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex gap-2.5 rounded-lg border px-4 py-3 text-sm leading-6 ${tones[tone]}`}>
      <Icon className="mt-1 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
