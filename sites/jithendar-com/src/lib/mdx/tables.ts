import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";

/**
 * Wide tables scroll inside their own focusable region instead of widening the page on phones.
 * The region is keyboard-scrollable (tabindex) and announced with a label.
 */
export function rehypeTableScroll() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "table" || !parent || index === undefined) return;
      const p = parent as Element;
      if (p.type === "element" && p.tagName === "div" && (p.properties?.className as string[] | undefined)?.includes("table-scroll")) return;
      parent.children[index] = {
        type: "element",
        tagName: "div",
        properties: { className: ["table-scroll"], tabIndex: 0, role: "region", ariaLabel: "Table (scrolls sideways)" },
        children: [node],
      };
    });
  };
}
