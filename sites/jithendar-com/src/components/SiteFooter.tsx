import { site } from "@/config/site";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-zinc-600 dark:text-zinc-400">
        <p>{site.name}</p>
      </div>
    </footer>
  );
}
