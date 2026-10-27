import { site } from "@/config/site";

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: site.timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "longOffset",
});

/** ISO 8601 in the editorial time zone with its offset, e.g. 2026-10-27T18:00:00+05:30. */
export function toIsoOffset(date: Date): string {
  const p = Object.fromEntries(parts.formatToParts(date).map((x) => [x.type, x.value]));
  const offset = (p.timeZoneName ?? "GMT").replace("GMT", "") || "+00:00";
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offset}`;
}
