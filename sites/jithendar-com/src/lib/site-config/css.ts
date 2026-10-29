/**
 * Turn a validated SiteConfig into CSS custom properties. Every value interpolated here is a validated hex
 * colour, a value from a closed enumeration or a bounded number, so the output cannot contain anything but
 * declarations. Custom CSS is separate and validated by `checkCustomCss`.
 */
import { readableOn } from "./color";
import type { Palette, SiteConfig } from "./schema";

const FONT_VARS: Record<SiteConfig["theme"]["fonts"]["body"], string> = {
  inter: "var(--font-inter)",
  "ibm-plex-sans": "var(--font-ibm-plex-sans)",
  "source-sans": "var(--font-source-sans)",
  "source-serif": "var(--font-source-serif)",
};
const SERIF = new Set(["source-serif"]);
const CODE_VARS: Record<SiteConfig["theme"]["fonts"]["code"], string> = {
  "jetbrains-mono": "var(--font-jetbrains)",
  "ibm-plex-mono": "var(--font-ibm-plex-mono)",
};

const fontStack = (key: SiteConfig["theme"]["fonts"]["body"]) =>
  `${FONT_VARS[key]}, ${SERIF.has(key) ? 'ui-serif, Georgia, "Times New Roman", serif' : 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'}`;

function paletteVars(p: Palette): string {
  const onAccent = readableOn(p.accent);
  return [
    `--canvas:${p.canvas}`,
    `--surface:${p.surface}`,
    `--surface-muted:color-mix(in srgb,${p.surface} 96%,${p.text})`,
    `--surface-sunken:color-mix(in srgb,${p.canvas} 92%,${p.text})`,
    `--fg:${p.text}`,
    `--fg-muted:${p.muted}`,
    `--fg-subtle:${p.subtle}`,
    `--line:${p.border}`,
    `--line-strong:color-mix(in srgb,${p.border} 75%,${p.text})`,
    `--accent:${p.accent}`,
    `--accent-hover:color-mix(in srgb,${p.accent} 84%,${onAccent === "#ffffff" ? "#000" : "#fff"})`,
    `--accent-text:${p.link}`,
    `--accent-soft:color-mix(in srgb,${p.accent} 12%,transparent)`,
    `--on-accent:${onAccent}`,
    // Keep the brand scale (used by a few utilities, selection, form accents) in the same hue.
    `--color-brand-50:color-mix(in srgb,${p.accent} 8%,#fff)`,
    `--color-brand-200:color-mix(in srgb,${p.accent} 30%,#fff)`,
    `--color-brand-300:color-mix(in srgb,${p.accent} 55%,#fff)`,
    `--color-brand-400:color-mix(in srgb,${p.accent} 80%,#fff)`,
    `--color-brand-500:${p.accent}`,
    `--color-brand-600:${p.accent}`,
    `--color-brand-700:color-mix(in srgb,${p.accent} 85%,#000)`,
  ].join(";");
}

const RADII = {
  none: { md: "0", lg: "0", xl: "0" },
  small: { md: "0.25rem", lg: "0.375rem", xl: "0.5rem" },
  medium: { md: "0.375rem", lg: "0.5rem", xl: "0.75rem" },
  large: { md: "0.5rem", lg: "0.75rem", xl: "1rem" },
};
const SECTION_SPACING = {
  compact: "clamp(2.25rem,1.75rem + 2vw,3.5rem)",
  comfortable: "clamp(3rem,2.25rem + 3vw,5rem)",
  spacious: "clamp(3.5rem,2.5rem + 4vw,6.5rem)",
};
const HEADER_HEIGHT = { compact: "3.5rem", regular: "4rem", tall: "4.75rem" };
const ARTICLE_WIDTH = { narrow: -4, default: 0, wide: 6 };
const IMAGE_RADIUS = { none: "0", small: "0.5rem", medium: "0.75rem" };

/** The CSS for the configured theme, header metrics and media presentation. */
export function themeCss(c: SiteConfig): string {
  const t = c.theme;
  const r = RADII[t.radius];
  const control = t.buttonShape === "pill" ? "999px" : t.buttonShape === "square" ? "0" : r.lg;
  const reading = t.readingWidth + ARTICLE_WIDTH[c.blog.article.width];
  const root = [
    `--font-sans:${fontStack(t.fonts.body)}`,
    `--font-heading:${fontStack(t.fonts.heading)}`,
    `--font-mono:${CODE_VARS[t.fonts.code]}, ui-monospace, SFMono-Regular, Menlo, monospace`,
    `--font-weight-bold:${t.headingWeight}`,
    `--article-line-height:${t.bodyLineHeight}`,
    `--article-size:${c.blog.article.bodySize / 16}rem`,
    `--container-page:${t.contentWidth}rem`,
    `--container-reading:${reading}rem`,
    `--spacing-section:${SECTION_SPACING[t.density]}`,
    `--spacing-header:${HEADER_HEIGHT[c.header.height]}`,
    `--radius-md:${r.md}`,
    `--radius-lg:${r.lg}`,
    `--radius-xl:${r.xl}`,
    `--radius-2xl:${r.xl}`,
    `--radius-3xl:${r.xl}`,
    `--radius-control:${control}`,
    `--prose-image-radius:${IMAGE_RADIUS[c.media.imageRadius]}`,
    `--caption-align:${c.media.captionAlign}`,
    `--gallery-columns:${c.media.galleryColumns}`,
    paletteVars(t.light),
  ].join(";");
  const dark = paletteVars(t.dark);
  return [
    `:root{${root}}`,
    `html{font-size:${t.textScale}%}`,
    `:root[data-theme="dark"]{${dark}}`,
    `@media (prefers-color-scheme:dark){:root:not([data-theme]){${dark}}}`,
  ].join("\n");
}

// --- Restricted custom CSS ---------------------------------------------------------------------------------

export const CUSTOM_CSS_MAX = 10_000;

/**
 * Custom CSS is an explicitly restricted advanced feature: styling rules only. Refused: anything that can
 * load resources or run code (@import, url(), image-set(), expression(), behaviour bindings, javascript:),
 * the < character, escapes (which could disguise all of the above), @font-face/@namespace/@charset, and
 * fixed/sticky overlays that could cover the page. Unbalanced braces are refused too.
 */
export function checkCustomCss(css: string): string[] {
  const problems: string[] = [];
  if (css.length > CUSTOM_CSS_MAX) problems.push(`Custom CSS is limited to ${CUSTOM_CSS_MAX.toLocaleString("en")} characters.`);
  const lower = css.toLowerCase();
  const rules: [RegExp, string][] = [
    [/</, "The < character is not allowed (it could close the style element)."],
    [/\\/, "Escape sequences (\\) are not allowed."],
    [/@import|@font-face|@namespace|@charset/, "@import, @font-face, @namespace and @charset are not allowed."],
    [/url\s*\(|image-set\s*\(|image\s*\(/, "url(), image() and image-set() are not allowed: choose images in Branding instead."],
    [/expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding/, "Scripting constructs are not allowed."],
    [/position\s*:\s*(fixed|sticky)/, "position: fixed and sticky are not allowed (they can cover the page)."],
  ];
  for (const [re, message] of rules) if (re.test(lower)) problems.push(message);
  let depth = 0;
  for (const ch of css) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth < 0) break;
  }
  if (depth !== 0) problems.push("Braces { } are not balanced.");
  if (/\/\*(?![\s\S]*?\*\/)/.test(css)) problems.push("A comment is not closed.");
  return problems;
}
