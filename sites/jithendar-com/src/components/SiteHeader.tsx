import Link from "next/link";
import { site } from "@/config/site";
import { collectionLabels, collections } from "@/config/taxonomy";

export function SiteHeader() {
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="font-semibold tracking-tight">
          {site.name}
        </Link>
        <nav aria-label="Main">
          <ul className="flex gap-5 text-sm">
            {collections.map((c) => (
              <li key={c}>
                <Link href={`/${c}`} className="hover:underline">
                  {collectionLabels[c]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
