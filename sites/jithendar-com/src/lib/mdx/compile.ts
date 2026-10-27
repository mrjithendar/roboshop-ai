import { evaluate } from "@mdx-js/mdx";
import rehypeShiki from "@shikijs/rehype";
import type { MDXContent } from "mdx/types";
import * as runtime from "react/jsx-runtime";
import rehypeSlug from "rehype-slug";
import { collectHeadings, demoteH1, type Heading } from "./headings";

export type CompiledMdx = { Content: MDXContent; headings: Heading[] };

/** Compile MDX on the server: heading ids + TOC, and build-time syntax highlighting (no client JS). */
export async function compileMdx(source: string): Promise<CompiledMdx> {
  const headings: Heading[] = [];
  const { default: Content } = await evaluate(source, {
    ...runtime,
    development: false,
    rehypePlugins: [
      demoteH1,
      rehypeSlug,
      collectHeadings(headings),
      [rehypeShiki, { themes: { light: "github-light", dark: "github-dark" }, lazy: true, fallbackLanguage: "text" }],
    ],
  });
  return { Content, headings };
}
