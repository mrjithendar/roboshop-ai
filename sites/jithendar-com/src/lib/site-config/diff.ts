/** List the paths (two levels deep, arrays as a whole) where `next` differs from `current`. Isomorphic. */
export function summarizeChanges(current: unknown, next: unknown, prefix = "", depth = 0): string[] {
  if (JSON.stringify(current) === JSON.stringify(next)) return [];
  const isObj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  if (depth >= 2 || !isObj(current) || !isObj(next)) return [prefix || "(everything)"];
  const keys = new Set([...Object.keys(current as object), ...Object.keys(next as object)]);
  return [...keys].flatMap((k) => summarizeChanges((current as Record<string, unknown>)[k], (next as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k, depth + 1));
}
