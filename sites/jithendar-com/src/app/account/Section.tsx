import type { ReactNode } from "react";

/** A titled panel on the account pages. */
export function Section({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-xl border border-line bg-surface">
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <h2 id={id} className="text-base font-semibold text-fg">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm leading-6 text-fg-muted">{description}</p>}
      </div>
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}
