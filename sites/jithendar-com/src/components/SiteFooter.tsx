import Link from "next/link";
import { site } from "@/config/site";
import { categories, categoryKeys } from "@/config/taxonomy";

const policies = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/editorial-policy", label: "Editorial policy" },
  { href: "/corrections-policy", label: "Corrections" },
  { href: "/ai-use-policy", label: "AI use" },
  { href: "/privacy-policy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 text-sm sm:grid-cols-3">
        <div>
          <p className="font-semibold">{site.name}</p>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">{site.description}</p>
          <p className="mt-3">
            <a href="/feed.xml" className="underline">
              RSS feed
            </a>
          </p>
        </div>
        <nav aria-label="Topics">
          <p className="font-semibold">Topics</p>
          <ul className="mt-2 space-y-1">
            {categoryKeys.map((c) => (
              <li key={c}>
                <Link href={`/category/${c}`} className="text-zinc-700 hover:underline dark:text-zinc-300">
                  {categories[c]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="About this site">
          <p className="font-semibold">About this site</p>
          <ul className="mt-2 space-y-1">
            {policies.map((p) => (
              <li key={p.href}>
                <Link href={p.href} className="text-zinc-700 hover:underline dark:text-zinc-300">
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
