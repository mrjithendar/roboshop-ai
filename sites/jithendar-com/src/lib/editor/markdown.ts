import { Node, type AnyExtension, type JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

/**
 * The editor's document model. Markdown (with the site's directive shortcodes) is the one canonical,
 * stored format; the visual editor is a view over it:
 *
 *   stored Markdown ──parse──▶ editor document ──serialize──▶ stored Markdown
 *
 * Anything the visual blocks cannot represent exactly — shortcodes (`:::callout`, `::video`, `:::gallery` …)
 * and HTML comments — becomes a *protected block* that keeps its source text byte for byte. Before a
 * document is opened visually, fidelity() checks that the round trip changes nothing that matters;
 * otherwise the editor stays in source (Markdown) mode and says why. Nothing is ever executed: the site
 * renders Markdown with raw HTML, JSX and expressions disabled (lib/mdx/compile.ts).
 */

const CONTAINER = /^(:{3,})([a-z][\w-]*)[^\n]*\n[\s\S]*?\n\1[ \t]*(?:\n|$)/;
const LEAF = /^::[a-z][\w-]*(?:\[[^\]\n]*\])?(?:\{[^}\n]*\})?[ \t]*(?:\n|$)/;
const COMMENT = /^<!--[\s\S]*?-->[ \t]*(?:\n|$)/;
/** Raw HTML/JSX blocks (e.g. `<Todo>…</Todo>`): never rendered by the site, but kept so nothing is lost. */
const RAW_BLOCK = /^<([A-Za-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>[ \t]*(?:\n|$)|^<[A-Za-z][\w-]*\b[^>]*\/>[ \t]*(?:\n|$)/;

/** A shortcode or HTML comment, kept verbatim. */
export const ProtectedBlock = Node.create({
  name: "protectedBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { source: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-protected-block]", getAttrs: (el) => ({ source: (el as HTMLElement).getAttribute("data-source") ?? "" }) }];
  },
  renderHTML({ node }) {
    return ["div", { "data-protected-block": "", "data-source": node.attrs.source }, String(node.attrs.source)];
  },
  markdownTokenName: "protectedBlock",
  markdownTokenizer: {
    name: "protectedBlock",
    level: "block",
    start: (src: string) => {
      const m = /^(?::{2,}[a-z]|<!--|<[A-Za-z])/m.exec(src);
      return m ? m.index : -1;
    },
    tokenize: (src: string) => {
      const m = CONTAINER.exec(src) ?? LEAF.exec(src) ?? COMMENT.exec(src) ?? RAW_BLOCK.exec(src);
      if (!m) return undefined;
      return { type: "protectedBlock", raw: m[0], text: m[0].replace(/\n+$/, "") };
    },
  },
  parseMarkdown(token) {
    return { type: "protectedBlock", attrs: { source: token.text ?? token.raw ?? "" } };
  },
  renderMarkdown(node) {
    return String(node.attrs?.source ?? "");
  },
});

/** Shared by the browser editor and the server-side tests, so both use exactly the same schema. */
export function editorExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      // H1 is the post title; the body uses H2–H6.
      heading: { levels: [2, 3, 4, 5, 6] },
      link: {
        openOnClick: false,
        autolink: true,
        protocols: ["http", "https", "mailto"],
        isAllowedUri: (url) => isSafeUrl(url),
      },
      // Underline has no Markdown syntax the site renders; leaving it on would lose formatting.
      underline: false,
    }),
    Image,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit,
    ProtectedBlock,
  ];
}

/** Links and images may only be http(s), mailto, site-relative paths or in-page anchors. */
export function isSafeUrl(url: string): boolean {
  const u = url.trim();
  if (u.startsWith("/") && !u.startsWith("//")) return true;
  if (u.startsWith("#")) return true;
  return /^(https?:\/\/|mailto:)/i.test(u);
}

let manager: MarkdownManager | undefined;
function md(): MarkdownManager {
  manager ??= new MarkdownManager({ extensions: editorExtensions() });
  return manager;
}

export const parseMarkdown = (source: string): JSONContent => md().parse(source);
export const serializeMarkdown = (doc: JSONContent): string => md().serialize(doc);

/** Whitespace-insensitive comparison: blank-line runs, trailing spaces and list markers (- vs *) are not meaning. */
export function normalizeMarkdown(source: string): string {
  return source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, "").replace(/^(\s*)[*+] /, "$1- "))
    // An escaped underscore inside a word renders the same as a plain one (GFM: no intraword emphasis).
    .map((l) => l.replace(/(\w)\\_(?=\w)/g, "$1_"))
    // Escaped square brackets render as the same literal brackets.
    .map((l) => l.replace(/\\([[\]])/g, "$1"))
    // Table cell padding is cosmetic.
    .map((l) => (l.startsWith("|") ? l.replace(/[ \t]*\|[ \t]*/g, "|").replace(/\|:?-+:?(?=\|)/g, (c) => c.replace(/-+/, "-")) : l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type Fidelity = { lossless: true } | { lossless: false; firstDifference: string };

/** Would opening this Markdown in the visual editor and saving it change it? */
export function fidelity(source: string): Fidelity {
  let out: string;
  try {
    out = serializeMarkdown(parseMarkdown(source));
  } catch {
    return { lossless: false, firstDifference: "the content could not be parsed by the visual editor" };
  }
  const a = normalizeMarkdown(source).split("\n");
  const b = normalizeMarkdown(out).split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return { lossless: false, firstDifference: `line ${i + 1}: “${(a[i] ?? "").slice(0, 80)}”` };
  }
  return { lossless: true };
}
