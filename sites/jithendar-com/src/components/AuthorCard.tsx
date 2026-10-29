import Link from "next/link";
import type { Author } from "@/lib/content";
import { ArrowRight } from "./icons";
import { UserAvatar } from "./UserAvatar";

export { initials } from "@/lib/avatar-url";

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  return <UserAvatar name={name} size={size} />;
}

export function AuthorCard({ author }: { author: Author }) {
  const fm = author.frontmatter;
  return (
    <aside aria-label="About the author" className="flex gap-4 rounded-xl border border-line bg-surface-muted p-5 sm:gap-5 sm:p-6">
      <Avatar name={fm.name} />
      <div className="min-w-0">
        <p className="text-sm text-fg-subtle">Written by</p>
        <p className="mt-0.5 text-base font-semibold text-fg">
          <Link href={author.path} rel="author" className="hover:underline">
            {fm.name}
          </Link>
        </p>
        {fm.jobTitle && <p className="text-sm text-fg-muted">{fm.jobTitle}</p>}
        <Link href={author.path} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent-text hover:underline">
          More from this author <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </aside>
  );
}
