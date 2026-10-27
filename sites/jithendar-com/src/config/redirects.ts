/**
 * Central permanent-redirect map, consumed by next.config.ts (308).
 * Every source must resolve in one hop: a destination may never be another source.
 */
export type Redirect = { source: string; destination: string };

export const redirects: Redirect[] = [];
