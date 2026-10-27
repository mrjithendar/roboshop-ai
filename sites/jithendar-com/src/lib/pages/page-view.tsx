import Link from "next/link";
import type { ReactNode } from "react";
import { Container } from "@/components/Container";
import { JsonLd } from "@/components/JsonLd";
import { mdxComponents } from "@/components/Mdx";
import { PageHeader } from "@/components/PageHeader";
import { getPages, type Page } from "@/lib/content";
import { formatDate } from "@/lib/dates";
import { compileMdx } from "@/lib/mdx/compile";
import { breadcrumbLd } from "@/lib/seo/jsonld";

const ORDER = ["about", "contact", "editorial-policy", "corrections-policy", "ai-use-policy", "privacy-policy", "terms"];

/** Static page layout, shared by the public page and the editor preview. */
export async function PageView({ page, notice, after }: { page: Page; notice?: ReactNode; after?: ReactNode }) {
  const fm = page.frontmatter;
  const { Content } = await compileMdx(page.body);
  const crumbs = [
    { name: "Home", path: "/" },
    { name: fm.title, path: page.path },
  ];
  const siblings = (await getPages()).sort((a, b) => ORDER.indexOf(a.slug) - ORDER.indexOf(b.slug));

  return (
    <>
      <JsonLd data={breadcrumbLd(crumbs)} />
      {notice}
      <PageHeader
        title={fm.title}
        description={fm.description}
        eyebrow="Publication info"
        crumbs={crumbs}
      >
        {fm.updatedAt && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Last updated <time dateTime={fm.updatedAt}>{formatDate(fm.updatedAt)}</time>
          </p>
        )}
      </PageHeader>
      <Container className="py-14">
        <div className="grid gap-12 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Publication info" className="lg:sticky lg:top-24 lg:self-start">
            <ul className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
              {siblings.map((p) => {
                const current = p.slug === page.slug;
                return (
                  <li key={p.slug} className="shrink-0">
                    <Link
                      href={p.path}
                      aria-current={current ? "page" : undefined}
                      className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        current
                          ? "bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200"
                          : "text-slate-600 hover:bg-slate-50 hover:text-ink dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"
                      }`}
                    >
                      {p.frontmatter.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="min-w-0 max-w-3xl">
            <div className="prose prose-slate prose-lg max-w-none dark:prose-invert prose-headings:font-semibold prose-p:leading-8">
              <Content components={mdxComponents} />
            </div>
            {after}
          </div>
        </div>
      </Container>
    </>
  );
}
