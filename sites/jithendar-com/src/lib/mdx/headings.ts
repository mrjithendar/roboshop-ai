import type { Element, Root } from "hast";
import { toString } from "hast-util-to-string";
import { visit } from "unist-util-visit";

export type Heading = { id: string; text: string; level: 2 | 3 };

/** Rehype plugin: after rehype-slug, record h2/h3 ids and text for the table of contents. */
export function collectHeadings(into: Heading[]) {
  return () => (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if ((node.tagName === "h2" || node.tagName === "h3") && typeof node.properties.id === "string") {
        into.push({ id: node.properties.id, text: toString(node), level: node.tagName === "h2" ? 2 : 3 });
      }
    });
  };
}

/** MDX bodies may use "#"; the page owns the only h1, so demote it before ids and the TOC are built. */
export function demoteH1() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName === "h1") node.tagName = "h2";
    });
  };
}
