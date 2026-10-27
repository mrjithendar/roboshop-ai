import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { collections, type Collection } from "@/config/taxonomy";
import { splitFrontmatter } from "./frontmatter";
import {
  authorFrontmatter,
  collectionSchema,
  pageFrontmatter,
  type ArticleFrontmatter,
  type AuthorFrontmatter,
  type PageFrontmatter,
} from "./schema";

export type Article = {
  collection: Collection;
  slug: string;
  /** Site-relative path, e.g. /blog/my-post */
  path: string;
  frontmatter: ArticleFrontmatter;
  body: string;
  file: string;
  /** Set only in local preview, for review items shown as if published. */
  preview?: boolean;
};

export type Author = { slug: string; path: string; frontmatter: AuthorFrontmatter; body: string; file: string };

export type Page = { slug: string; path: string; frontmatter: PageFrontmatter; body: string; file: string };

export type ContentStore = { articles: Article[]; authors: Map<string, Author>; pages: Map<string, Page> };

export function contentRoot(): string {
  // Shipped via outputFileTracingIncludes in next.config.ts, so tracing must not follow these paths.
  return process.env.CONTENT_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "content");
}

function mdxFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".mdx"))
    .sort()
    .map((name) => path.join(/*turbopackIgnore: true*/ dir, name));
}

function formatIssues(file: string, error: z.ZodError): string[] {
  return error.issues.map((issue) => `${file}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

/** Read and validate every content file. Throws one error listing every problem found. */
export function loadContent(root: string = contentRoot()): ContentStore {
  const errors: string[] = [];
  const rel = (file: string) => path.relative(root, file);

  const authors = new Map<string, Author>();
  for (const file of mdxFiles(path.join(/*turbopackIgnore: true*/ root, "authors"))) {
    try {
      const { data, body } = splitFrontmatter(fs.readFileSync(file, "utf8"));
      const parsed = authorFrontmatter.safeParse(data);
      if (!parsed.success) {
        errors.push(...formatIssues(rel(file), parsed.error));
        continue;
      }
      const fm = parsed.data;
      if (path.basename(file, ".mdx") !== fm.slug) errors.push(`${rel(file)}: slug must match the file name`);
      authors.set(fm.slug, { slug: fm.slug, path: `/authors/${fm.slug}`, frontmatter: fm, body, file });
    } catch (error) {
      errors.push(`${rel(file)}: ${(error as Error).message}`);
    }
  }

  const articles: Article[] = [];
  for (const collection of collections) {
    const schema = collectionSchema(collection);
    const seen = new Set<string>();
    for (const file of mdxFiles(path.join(/*turbopackIgnore: true*/ root, collection))) {
      try {
        const { data, body } = splitFrontmatter(fs.readFileSync(file, "utf8"));
        const parsed = schema.safeParse(data);
        if (!parsed.success) {
          errors.push(...formatIssues(rel(file), parsed.error));
          continue;
        }
        const fm = parsed.data;
        if (path.basename(file, ".mdx") !== fm.slug) errors.push(`${rel(file)}: slug must match the file name`);
        if (seen.has(fm.slug)) errors.push(`${rel(file)}: duplicate slug "${fm.slug}" in ${collection}`);
        if (!authors.has(fm.author)) errors.push(`${rel(file)}: author "${fm.author}" not found in authors/`);
        seen.add(fm.slug);
        articles.push({ collection, slug: fm.slug, path: `/${collection}/${fm.slug}`, frontmatter: fm, body, file });
      } catch (error) {
        errors.push(`${rel(file)}: ${(error as Error).message}`);
      }
    }
  }

  const known = new Set(articles.map((a) => `${a.collection}/${a.slug}`));
  for (const a of articles) {
    for (const ref of a.frontmatter.related) {
      if (!known.has(ref)) errors.push(`${rel(a.file)}: related "${ref}" does not exist`);
      if (ref === `${a.collection}/${a.slug}`) errors.push(`${rel(a.file)}: related cannot reference itself`);
    }
  }

  const pages = new Map<string, Page>();
  for (const file of mdxFiles(path.join(/*turbopackIgnore: true*/ root, "pages"))) {
    try {
      const { data, body } = splitFrontmatter(fs.readFileSync(file, "utf8"));
      const parsed = pageFrontmatter.safeParse(data);
      if (!parsed.success) {
        errors.push(...formatIssues(rel(file), parsed.error));
        continue;
      }
      const fm = parsed.data;
      if (path.basename(file, ".mdx") !== fm.slug) errors.push(`${rel(file)}: slug must match the file name`);
      pages.set(fm.slug, { slug: fm.slug, path: `/${fm.slug}`, frontmatter: fm, body, file });
    } catch (error) {
      errors.push(`${rel(file)}: ${(error as Error).message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid content (${errors.length} problem${errors.length === 1 ? "" : "s"}):\n  ${errors.join("\n  ")}`);
  }
  return { articles, authors, pages };
}
