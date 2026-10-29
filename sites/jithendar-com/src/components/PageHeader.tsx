import type { ReactNode } from "react";
import type { Crumb } from "@/lib/seo/jsonld";
import { Breadcrumbs } from "./Breadcrumbs";
import { Container } from "./Container";

/** Title band used by listings, topics, policies, search and the author profile. */
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
    <div className="border-b border-line bg-surface-muted">
      <Container narrow={narrow} className="py-10 sm:py-14">
        {crumbs && <Breadcrumbs crumbs={crumbs} />}
        <div className={`flex items-start gap-5 ${crumbs ? "mt-6" : ""}`}>
          {icon}
          <div className="min-w-0 max-w-3xl">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h1 className={`text-title font-bold text-fg [overflow-wrap:anywhere] ${eyebrow ? "mt-2" : ""}`}>{title}</h1>
            {description && <div className="mt-4 text-lg leading-8 text-fg-muted">{description}</div>}
            {children && <div className="mt-6">{children}</div>}
          </div>
        </div>
      </Container>
    </div>
  );
}
