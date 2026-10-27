import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { isProductionEnv } from "@/config/site";
import type { MDXComponents } from "mdx/types";
import { CodeBlock } from "./CodeBlock";

/** Owner placeholder for facts that cannot be verified from the repo. Hidden in production builds. */
function Todo({ children }: { children?: ReactNode }) {
  if (isProductionEnv()) return null;
  return (
    <span className="rounded border border-amber-400 bg-amber-50 px-1 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      TODO(owner): {children}
    </span>
  );
}

function Anchor({ href = "", ...props }: ComponentProps<"a">) {
  if (href.startsWith("/") && !href.startsWith("//")) return <Link href={href} {...props} />;
  if (href.startsWith("#")) return <a href={href} {...props} />;
  return <a href={href} rel="noopener" {...props} />;
}

export const mdxComponents: MDXComponents = {
  a: Anchor,
  pre: CodeBlock,
  Todo,
};
