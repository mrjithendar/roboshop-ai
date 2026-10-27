/**
 * Rows from db.execute(sql`…`). postgres.js (production) returns the rows array itself; PGlite (tests,
 * local dev) returns { rows }. Always read raw-SQL results through this helper.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
