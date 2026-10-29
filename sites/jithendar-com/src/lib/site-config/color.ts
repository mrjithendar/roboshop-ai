/** sRGB colour helpers for #rrggbb values: WCAG contrast, blending and readable foregrounds. Isomorphic. */

export const HEX = /^#[0-9a-f]{6}$/;

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

function channel(v: number) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio (1–21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `top` at `alpha` (0–1) over `bottom`. */
export function blend(top: string, bottom: string, alpha: number): string {
  const t = hexToRgb(top);
  const b = hexToRgb(bottom);
  return rgbToHex([0, 1, 2].map((i) => t[i]! * alpha + b[i]! * (1 - alpha)) as RGB);
}

/** White or near-black, whichever reads better on `bg`. */
export function readableOn(bg: string): "#ffffff" | "#111317" {
  return contrast("#ffffff", bg) >= contrast("#111317", bg) ? "#ffffff" : "#111317";
}

/**
 * Worst-case contrast of `text` on an image covered by an overlay: the image could be anything from
 * black to white, so check the overlay blended over both extremes.
 */
export function overlayContrast(text: string, overlay: string, opacityPercent: number): number {
  const a = opacityPercent / 100;
  return Math.min(contrast(text, blend(overlay, "#ffffff", a)), contrast(text, blend(overlay, "#000000", a)));
}

export const AA = 4.5;
