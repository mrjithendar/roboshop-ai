import type { Heading } from "@/lib/mdx/headings";

export function TableOfContents({ headings }: { headings: Heading[] }) {
  if (headings.length < 2) return null;
  return (
    <nav aria-labelledby="toc-heading" className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <h2 id="toc-heading" className="font-semibold">
        On this page
      </h2>
      <ol className="mt-2 space-y-1">
        {headings.map((h) => (
          <li key={h.id} className={h.level === 3 ? "pl-4" : undefined}>
            <a href={`#${h.id}`} className="text-zinc-700 hover:underline dark:text-zinc-300">
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
