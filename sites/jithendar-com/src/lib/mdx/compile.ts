import { evaluate } from "@mdx-js/mdx";
import rehypeShiki from "@shikijs/rehype";
import type { MDXContent } from "mdx/types";
import * as runtime from "react/jsx-runtime";
import rehypeSlug from "rehype-slug";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import { collectHeadings, demoteH1, type Heading } from "./headings";
import { remarkShortcodes } from "./shortcodes";

export type CompiledMdx = { Content: MDXContent; headings: Heading[] };

const compiled = new Map<string, CompiledMdx>();
const MAX_CACHED = 300;

/**
 * Compile article/page bodies on the server: heading ids + TOC and syntax highlighting (no client JS).
 * Bodies are compiled as plain Markdown (`format: "md"`): JSX, JavaScript expressions and raw HTML are
 * NOT executed, so authors and API keys can never run code on the server. Results are memoised by body.
 */
export async function compileMdx(source: string): Promise<CompiledMdx> {
  const hit = compiled.get(source);
  if (hit) return hit;
  const headings: Heading[] = [];
  const { default: Content } = await evaluate(source, {
    ...runtime,
    format: "md",
    development: false,
    // GFM: tables, strikethrough, task lists, autolinks.
    remarkPlugins: [remarkGfm, remarkDirective, remarkShortcodes],
    rehypePlugins: [
      demoteH1,
      rehypeSlug,
      collectHeadings(headings),
      [rehypeShiki, { themes: { light: "github-light", dark: "github-dark" }, lazy: true, fallbackLanguage: "text" }],
    ],
  });
  const result = { Content, headings };
  if (compiled.size >= MAX_CACHED) compiled.delete(compiled.keys().next().value!);
  compiled.set(source, result);
  return result;
}
