import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";

const SAFE = /^(https?:|mailto:|\/(?!\/)|#|\.{0,2}\/)/i;

/**
 * Defence in depth against stored XSS: drop link and media URLs whose scheme could run script
 * (javascript:, data:, vbscript:, …). Saving already rejects them; this covers older content and previews.
 */
export function rehypeSafeUrls() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      for (const prop of ["href", "src", "poster"] as const) {
        const value = node.properties?.[prop];
        if (typeof value === "string" && value.trim() && !SAFE.test(value.trim())) delete node.properties[prop];
      }
    });
  };
}
