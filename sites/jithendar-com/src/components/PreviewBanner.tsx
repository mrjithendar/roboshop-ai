/** Shown only to an admin viewing the unpublished draft (see lib/site-config getSiteConfig). */
export function PreviewBanner() {
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-amber-100 px-4 py-2 text-center text-sm text-amber-950 dark:bg-amber-500/20 dark:text-amber-100">
      <span>
        <strong className="font-semibold">Draft preview.</strong> Only you can see these unpublished settings.
      </span>
      {/* A plain link (not <Link>): an API route that clears the preview cookie and returns to the editor. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/api/admin/appearance/preview?exit=1" className="font-semibold underline underline-offset-2" target="_top">
        Exit preview
      </a>
    </div>
  );
}
