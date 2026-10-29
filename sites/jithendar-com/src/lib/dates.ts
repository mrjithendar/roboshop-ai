import { site } from "@/config/site";

export type DateFormat = "d-mmm-yyyy" | "mmm-d-yyyy" | "d-mmmm-yyyy" | "iso";

const LOCALES: Record<DateFormat, [string, Intl.DateTimeFormatOptions]> = {
  "d-mmm-yyyy": ["en-GB", { day: "numeric", month: "short", year: "numeric" }],
  "mmm-d-yyyy": ["en-US", { day: "numeric", month: "short", year: "numeric" }],
  "d-mmmm-yyyy": ["en-GB", { day: "numeric", month: "long", year: "numeric" }],
  iso: ["en-CA", { day: "2-digit", month: "2-digit", year: "numeric" }],
};

let current = { timeZone: site.timeZone as string, format: "d-mmm-yyyy" as DateFormat };
let dateOnly = build(current.timeZone, current.format);
let time = buildTime(current.timeZone);

/** Time with a zone abbreviation readers recognise (IST, EST, GMT…): the locale matters for the label. */
function buildTime(timeZone: string) {
  const locale = timeZone === "Asia/Kolkata" ? "en-IN" : timeZone.startsWith("America/") ? "en-US" : "en-GB";
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" });
}

function build(timeZone: string, format: DateFormat) {
  const [locale, options] = LOCALES[format];
  return new Intl.DateTimeFormat(locale, { ...options, timeZone });
}

/**
 * Apply the published date settings (Admin → Appearance → General). Called whenever the published
 * configuration is loaded; formatters are rebuilt only when something changed.
 */
export function setDateSettings(timeZone: string, format: DateFormat) {
  if (timeZone === current.timeZone && format === current.format) return;
  current = { timeZone, format };
  dateOnly = build(timeZone, format);
  time = buildTime(timeZone);
}

/** Short date in the editorial time zone, for cards and listings. */
export function formatDate(iso: string): string {
  return dateOnly.format(new Date(iso));
}

/** Date and time in the editorial time zone; the ISO value goes in <time dateTime>. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${dateOnly.format(d)}, ${time.format(d)}`;
}

/** RFC 822 date for RSS (always UTC). */
export function rfc822(iso: string): string {
  return new Date(iso).toUTCString();
}
