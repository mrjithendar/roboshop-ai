import type { Heading } from "@/lib/mdx/headings";

export function TableOfContents({ headings, id = "toc-heading" }: { headings: Heading[]; id?: string }) {
  if (headings.length < 2) return null;
  return (
    <nav aria-labelledby={id} className="text-sm">
      <h2 id={id} className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        On this page
      </h2>
      <ol className="mt-4 space-y-2.5 border-l border-slate-200 dark:border-white/10">
        {headings.map((h) => (
          <li key={h.id} className={h.level === 3 ? "pl-7" : "pl-4"}>
            <a
              href={`#${h.id}`}
              className="-ml-px block border-l border-transparent pl-0 leading-snug text-slate-600 transition-colors hover:text-ink dark:text-slate-400 dark:hover:text-white"
            >
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
