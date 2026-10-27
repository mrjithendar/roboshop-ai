import Link from "next/link";
import type { Author } from "@/lib/content";

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-9 w-9 text-sm", md: "h-12 w-12 text-base", lg: "h-20 w-20 text-2xl" };
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-accent-500 font-bold text-white ${sizes[size]}`}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function AuthorCard({ author }: { author: Author }) {
  const fm = author.frontmatter;
  return (
    <aside aria-label="About the author" className="flex gap-5 rounded-2xl border border-slate-200 bg-slate-50 p-6 dark:border-white/10 dark:bg-white/[0.03]">
      <Avatar name={fm.name} />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Written by</p>
        <p className="mt-1 font-semibold text-ink dark:text-white">
          <Link href={author.path} rel="author" className="hover:underline">
            {fm.name}
          </Link>
        </p>
        {fm.jobTitle && <p className="text-sm text-slate-600 dark:text-slate-400">{fm.jobTitle}</p>}
        <Link href={author.path} className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
          More from this author
        </Link>
      </div>
    </aside>
  );
}
