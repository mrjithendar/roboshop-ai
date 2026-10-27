import type { Root } from "mdast";
import { toString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";

/**
 * Shortcodes via Markdown directives (remark-directive). Only these names and attributes are honoured;
 * anything else renders as its plain text. Nothing is executed.
 *
 *   :::callout{type="info|tip|warning|danger" title="…"}  …  :::
 *   ::button[Label]{href="/path or https://…"}
 *   :::figure{caption="…"}  ![alt](/media/…)  :::
 *   :::details{summary="…"}  …  :::
 *   ::toc
 */
const CALLOUT_TYPES = new Set(["info", "tip", "warning", "danger"]);

type DirectiveNode = {
  type: "containerDirective" | "leafDirective" | "textDirective";
  name: string;
  attributes?: Record<string, string | null | undefined>;
  children: unknown[];
  data?: { hName?: string; hProperties?: Record<string, unknown>; hChildren?: unknown[] };
};

function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  return /^https:\/\/[^\s]+$/i.test(href) ? href : null;
}

const text = (value: string) => ({ type: "text", value });

export function remarkShortcodes() {
  return (tree: Root) => {
    visit(tree, (node) => {
      const n = node as unknown as DirectiveNode;
      if (n.type !== "containerDirective" && n.type !== "leafDirective" && n.type !== "textDirective") return;
      const attrs = n.attributes ?? {};
      const data = (n.data ??= {});

      if (n.name === "callout" && n.type === "containerDirective") {
        const kind = CALLOUT_TYPES.has(attrs.type ?? "") ? attrs.type! : "info";
        data.hName = "aside";
        data.hProperties = { className: ["callout", `callout-${kind}`], role: kind === "warning" || kind === "danger" ? "note" : undefined };
        if (attrs.title) n.children.unshift({ type: "paragraph", data: { hProperties: { className: ["callout-title"] } }, children: [text(attrs.title)] });
        return;
      }
      if (n.name === "button" && n.type !== "containerDirective") {
        const href = safeHref(attrs.href);
        if (!href) return;
        data.hName = "a";
        data.hProperties = { href, className: ["shortcode-button"], ...(href.startsWith("https://") ? { rel: "noopener" } : {}) };
        return;
      }
      if (n.name === "figure" && n.type === "containerDirective") {
        data.hName = "figure";
        data.hProperties = { className: ["shortcode-figure"] };
        if (attrs.caption) n.children.push({ type: "paragraph", data: { hName: "figcaption" }, children: [text(attrs.caption)] });
        return;
      }
      if (n.name === "details" && n.type === "containerDirective") {
        data.hName = "details";
        data.hProperties = { className: ["shortcode-details"] };
        n.children.unshift({ type: "paragraph", data: { hName: "summary" }, children: [text(attrs.summary || "Details")] });
        return;
      }
      if (n.name === "toc" && n.type === "leafDirective") {
        data.hName = "nav";
        data.hProperties = { "data-shortcode": "toc" };
        return;
      }
      // Unknown or misplaced shortcode: show its text content, never render it as markup.
      data.hName = n.type === "textDirective" ? "span" : "p";
      data.hChildren = [{ type: "text", value: toString(n as never) }];
    });
  };
}
