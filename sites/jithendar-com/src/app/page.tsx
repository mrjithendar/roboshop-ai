import type { Metadata } from "next";
import Link from "next/link";
import { ArticleList } from "@/components/ArticleList";
import { JsonLd } from "@/components/JsonLd";
import { site, siteUrl } from "@/config/site";
import { categories, categoryKeys } from "@/config/taxonomy";
import { articlesInCategory, getPublishedContent } from "@/lib/content";
import { organizationLd, websiteLd } from "@/lib/seo/jsonld";

export const revalidate = 300;

export const metadata: Metadata = {
  title: { absolute: site.name },
  alternates: { canonical: siteUrl() },
  openGraph: { type: "website", url: siteUrl(), siteName: site.name, locale: site.locale, title: site.name, description: site.description },
};

function Section({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <section className="mt-14" aria-labelledby={`section-${href.slice(1)}`}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={`section-${href.slice(1)}`} className="text-2xl font-bold tracking-tight">
          {title}
        </h2>
        <Link href={href} className="text-sm underline">
          View all
        </Link>
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export default function HomePage() {
  const news = getPublishedContent({ collection: "news" }).slice(0, 4);
  const blog = getPublishedContent({ collection: "blog" }).slice(0, 6);
  const projects = getPublishedContent({ collection: "projects" }).slice(0, 4);
  const topics = categoryKeys.filter((c) => articlesInCategory(c).length > 0);
  const empty = news.length + blog.length + projects.length === 0;

  return (
    <div className="mx-auto max-w-5xl">
      <JsonLd data={[websiteLd(), organizationLd()]} />
      <section className="max-w-3xl">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{site.name}</h1>
        <p className="mt-4 text-lg text-zinc-700 dark:text-zinc-300">{site.description}</p>
        <p className="mt-4">
          <Link href="/about" className="underline">
            About this publication
          </Link>
        </p>
      </section>

      {empty && <p className="mt-14 text-zinc-600 dark:text-zinc-400">The first articles are being written. Check back soon.</p>}
      {news.length > 0 && (
        <Section title="Latest news" href="/news">
          <ArticleList articles={news} emptyText="" headingLevel={3} />
        </Section>
      )}
      {blog.length > 0 && (
        <Section title="Articles" href="/blog">
          <ArticleList articles={blog} emptyText="" headingLevel={3} />
        </Section>
      )}
      {projects.length > 0 && (
        <Section title="Projects" href="/projects">
          <ArticleList articles={projects} emptyText="" headingLevel={3} />
        </Section>
      )}
      {topics.length > 0 && (
        <section className="mt-14" aria-labelledby="topics">
          <h2 id="topics" className="text-2xl font-bold tracking-tight">
            Topics
          </h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {topics.map((c) => (
              <li key={c}>
                <Link href={`/category/${c}`} className="inline-block rounded-full border border-zinc-300 px-4 py-2 text-sm hover:border-zinc-500 dark:border-zinc-700">
                  {categories[c]}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
