import { createHash } from "node:crypto";
import Link from "next/link";
import { getSiteConfig } from "@/lib/site-config";
import { DismissAnnouncement } from "./DismissAnnouncement";

export const ANNOUNCEMENT_KEY = "announcement-dismissed";

/** Stable id of the current announcement, so a dismissal hides only this text (a new one shows again). */
export function announcementId(text: string, href: string): string {
  return createHash("sha256").update(`${text}\n${href}`).digest("hex").slice(0, 12);
}

/** Runs in <head>: hides a dismissed announcement before first paint. The id is hex, safe to inline. */
export function announcementScript(id: string): string {
  return `(function(){try{if(localStorage.getItem("${ANNOUNCEMENT_KEY}")==="${id}")document.documentElement.classList.add("announcement-dismissed")}catch(e){}})();`;
}

const tones = {
  neutral: "bg-fg text-canvas",
  accent: "bg-accent text-on-accent",
  warning: "bg-amber-100 text-amber-950 dark:bg-amber-400 dark:text-amber-950",
};

/** Site-wide notice (Admin → Appearance → Header). */
export async function AnnouncementBar() {
  const { config } = await getSiteConfig();
  const a = config.header.announcement;
  if (!a.enabled || !a.text) return null;
  const id = announcementId(a.text, a.href);
  return (
    <div className={`announcement relative px-12 py-2 text-center text-sm ${tones[a.tone]}`} role="region" aria-label="Announcement">
      {a.href ? (
        a.href.startsWith("/") ? (
          <Link href={a.href} className="underline decoration-current/40 underline-offset-2 hover:decoration-current">
            {a.text}
          </Link>
        ) : (
          <a href={a.href} rel="noopener" className="underline decoration-current/40 underline-offset-2 hover:decoration-current">
            {a.text}
          </a>
        )
      ) : (
        a.text
      )}
      {a.dismissible && <DismissAnnouncement id={id} storageKey={ANNOUNCEMENT_KEY} />}
    </div>
  );
}
