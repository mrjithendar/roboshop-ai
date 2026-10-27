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
