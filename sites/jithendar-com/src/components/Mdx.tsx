import { evaluate } from "@mdx-js/mdx";
import type { ComponentProps } from "react";
import * as runtime from "react/jsx-runtime";

// The page owns the only <h1>; demote any h1 written in the body.
const components = {
  h1: (props: ComponentProps<"h2">) => <h2 {...props} />,
};

export async function Mdx({ source }: { source: string }) {
  const { default: Content } = await evaluate(source, { ...runtime, development: false });
  return <Content components={components} />;
}
