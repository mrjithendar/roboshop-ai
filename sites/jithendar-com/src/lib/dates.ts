import { site } from "@/config/site";

const formatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: site.timeZone,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZoneName: "short",
});

/** Human-readable timestamp in the editorial time zone; the ISO value goes in <time dateTime>. */
export function formatDateTime(iso: string): string {
  return formatter.format(new Date(iso));
}

const dateOnly = new Intl.DateTimeFormat("en-IN", { timeZone: site.timeZone, day: "numeric", month: "short", year: "numeric" });

/** Short date in the editorial time zone, for cards and listings. */
export function formatDate(iso: string): string {
  return dateOnly.format(new Date(iso));
}

/** RFC 822 date for RSS (always UTC). */
export function rfc822(iso: string): string {
  return new Date(iso).toUTCString();
}
