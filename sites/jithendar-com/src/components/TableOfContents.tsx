import type { Heading } from "@/lib/mdx/headings";

export function TableOfContents({ headings, id = "toc-heading" }: { headings: Heading[]; id?: string }) {
  if (headings.length < 2) return null;
  return (
    <nav aria-labelledby={id} className="text-sm">
      <h2 id={id} className="text-sm font-semibold text-fg">
        On this page
      </h2>
      <ol className="mt-3 space-y-1 border-l border-line">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={`-ml-px block border-l border-transparent py-1 leading-snug text-fg-muted transition-colors hover:border-line-strong hover:text-fg ${h.level === 3 ? "pl-7" : "pl-4"}`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
