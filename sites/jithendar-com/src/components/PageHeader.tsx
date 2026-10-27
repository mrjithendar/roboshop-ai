import type { ReactNode } from "react";
import type { Crumb } from "@/lib/seo/jsonld";
import { Breadcrumbs } from "./Breadcrumbs";
import { Container } from "./Container";

/** Title band used by listings, topics, policies and the author profile. */
export function PageHeader({
  title,
  description,
  eyebrow,
  crumbs,
  icon,
  children,
  narrow = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  crumbs?: Crumb[];
  icon?: ReactNode;
  children?: ReactNode;
  narrow?: boolean;
}) {
  return (
    <div className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white dark:border-white/10 dark:from-white/[0.03] dark:to-transparent">
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <Container narrow={narrow} className="relative py-12 sm:py-16">
        {crumbs && <Breadcrumbs crumbs={crumbs} />}
        <div className="mt-6 flex items-start gap-5">
          {icon}
          <div className="min-w-0">
            {eyebrow && <p className="text-sm font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">{eyebrow}</p>}
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl lg:text-5xl dark:text-white">{title}</h1>
            {description && <div className="mt-4 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">{description}</div>}
            {children && <div className="mt-6">{children}</div>}
          </div>
        </div>
      </Container>
    </div>
  );
}
