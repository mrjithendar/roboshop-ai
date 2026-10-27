import Link from "next/link";
import { getCategories } from "@/lib/categories";
import { articlesInCategory } from "@/lib/content";
import { toneFor } from "./categoryStyle";
import { ArrowRight, CategoryIcon } from "./icons";

export async function TopicGrid() {
  const cats = await getCategories();
  const counts = await Promise.all(cats.map(async (c) => (await articlesInCategory(c.slug)).length));
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cats.map((c, i) => {
        const count = counts[i] ?? 0;
        return (
          <li key={c.slug}>
            <Link
              href={`/category/${c.slug}`}
              className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md dark:border-white/10 dark:bg-surface-dark-raised dark:hover:border-white/20"
            >
              <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 ring-inset ${toneFor(c.tone)}`}>
                <CategoryIcon name={c.icon} className="h-5 w-5" />
              </span>
              <span className="mt-4 font-semibold tracking-tight text-ink dark:text-white">{c.label}</span>
              <span className="mt-2 line-clamp-3 flex-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{c.intro}</span>
              <span className="mt-4 flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                {count > 0 ? `${count} article${count === 1 ? "" : "s"}` : "Coverage starting soon"}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600 dark:group-hover:text-brand-300" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
