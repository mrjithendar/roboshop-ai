import rehypeShiki from "@shikijs/rehype";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { demoteH1 } from "./headings";
import { remarkShortcodes } from "./shortcodes";

/**
 * Markdown → HTML string with the same plugins as the site renderer (GFM, shortcodes, heading ids,
 * Shiki), without React. Raw HTML in the source is dropped (remark-rehype default), so the output is safe
 * to show in the editor preview.
 */
export async function markdownToHtml(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(remarkShortcodes)
    .use(remarkRehype)
    .use(demoteH1)
    .use(rehypeSlug)
    .use(rehypeShiki, { themes: { light: "github-light", dark: "github-dark" }, lazy: true, fallbackLanguage: "text" })
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}
