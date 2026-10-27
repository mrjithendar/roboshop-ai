import { parse } from "yaml";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Split YAML frontmatter from an MDX body. Uses the YAML 1.2 core schema so
 * timestamps stay strings and keep their UTC offset.
 */
export function splitFrontmatter(source: string): { data: unknown; body: string } {
  const match = FRONTMATTER.exec(source);
  if (!match) throw new Error("missing YAML frontmatter block");
  return { data: parse(match[1] ?? "", { schema: "core" }) ?? {}, body: source.slice(match[0].length) };
}
