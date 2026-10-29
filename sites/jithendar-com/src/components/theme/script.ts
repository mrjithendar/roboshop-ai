/** localStorage key for the reader's explicit theme choice ("light" | "dark"; absent = the site default). */
export const THEME_KEY = "theme";

/**
 * Runs inline in <head> before first paint, so an explicit choice never flashes the other theme.
 * Without a stored choice the site default applies: "system" follows prefers-color-scheme in CSS (also
 * without JavaScript); "light"/"dark" (set in Admin → Appearance) are applied here.
 */
export function themeScript(defaultMode: "system" | "light" | "dark"): string {
  const fallback = defaultMode === "system" ? "" : defaultMode;
  return `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark")t="${fallback}";if(t)document.documentElement.dataset.theme=t;}catch(e){}})();`;
}
