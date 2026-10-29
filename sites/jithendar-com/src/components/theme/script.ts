/** localStorage key for the reader's explicit theme choice ("light" | "dark"; absent = follow the system). */
export const THEME_KEY = "theme";

/**
 * Runs inline in <head> before first paint, so an explicit choice never flashes the other theme.
 * Without a stored choice (or without JavaScript) the CSS follows prefers-color-scheme.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}})();`;
