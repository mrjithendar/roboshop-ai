/** Convert between <input type="datetime-local"> values (editorial time, IST) and ISO 8601 with offset. */
const IST_OFFSET = "+05:30";

export function isoToIstInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const shifted = new Date(new Date(iso).getTime() + 5.5 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16);
}

export function istInputToIso(value: string): string | null {
  return value ? `${value}:00${IST_OFFSET}` : null;
}
