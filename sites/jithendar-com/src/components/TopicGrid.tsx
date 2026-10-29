import Link from "next/link";
import { getCategories } from "@/lib/categories";
import { articlesInCategory } from "@/lib/content";
import { toneFor } from "./categoryStyle";
import { ArrowRight, CategoryIcon } from "./icons";

/** Topic navigation: compact rows on phones, cards with the intro from sm up. */
export async function TopicGrid() {
  const cats = await getCategories();
  const counts = await Promise.all(cats.map(async (c) => (await articlesInCategory(c.slug)).length));
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
      {cats.map((c, i) => {
        const count = counts[i] ?? 0;
        return (
          <li key={c.slug}>
            <Link
              href={`/category/${c.slug}`}
              className="group flex h-full items-center gap-4 rounded-xl border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-muted sm:flex-col sm:items-start sm:gap-0 sm:p-5"
            >
              <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${toneFor(c.tone)}`}>
                <CategoryIcon name={c.icon} className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1 sm:mt-4 sm:flex sm:w-full sm:flex-col">
                <span className="block font-semibold leading-snug text-fg">{c.label}</span>
                <span className="mt-2 hidden flex-1 text-sm leading-6 text-fg-muted sm:line-clamp-3">{c.intro}</span>
                <span className="mt-1 block text-sm text-fg-subtle sm:mt-4">
                  {count > 0 ? `${count} article${count === 1 ? "" : "s"}` : "Coverage starting soon"}
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-fg-subtle transition-colors group-hover:text-accent-text sm:hidden" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
