import Link from "next/link";
import { getSettings } from "@/lib/settings";

/** Site-wide notice, switched on and edited in Admin → Settings. */
export async function AnnouncementBar() {
  const { announcement } = await getSettings();
  if (!announcement.enabled || !announcement.text) return null;
  const safeHref = announcement.href.startsWith("/") || announcement.href.startsWith("https://") ? announcement.href : "";
  return (
    <div className="bg-ink px-5 py-2 text-center text-sm text-white dark:bg-brand-900">
      {safeHref ? (
        <Link href={safeHref} className="underline decoration-white/40 underline-offset-2 hover:decoration-white">{announcement.text}</Link>
      ) : (
        announcement.text
      )}
    </div>
  );
}
