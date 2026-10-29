/** Category identity: a neutral tile with a tinted glyph, so eight topics never turn the page into a rainbow (AA in both themes). */
export const tones: Record<string, string> = {
  violet: "bg-surface-muted text-violet-700 ring-line dark:text-violet-300",
  fuchsia: "bg-surface-muted text-fuchsia-700 ring-line dark:text-fuchsia-300",
  indigo: "bg-surface-muted text-indigo-700 ring-line dark:text-indigo-300",
  amber: "bg-surface-muted text-amber-700 ring-line dark:text-amber-300",
  sky: "bg-surface-muted text-sky-700 ring-line dark:text-sky-300",
  emerald: "bg-surface-muted text-emerald-700 ring-line dark:text-emerald-300",
  teal: "bg-surface-muted text-teal-700 ring-line dark:text-teal-300",
  rose: "bg-surface-muted text-rose-700 ring-line dark:text-rose-300",
  slate: "bg-surface-muted text-fg-muted ring-line",
};

export const toneNames = Object.keys(tones);

export function toneFor(name: string): string {
  return tones[name] ?? tones.slate!;
}
