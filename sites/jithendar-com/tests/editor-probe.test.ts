import fs from "node:fs";
import { it } from "vitest";
import { fidelity, parseMarkdown, serializeMarkdown } from "@/lib/editor/markdown";
it("probe", () => {
  const samples: Record<string, string> = {
    basic: "## Title\n\nSome **bold** and *italic* and ~~strike~~ with `code` and a [link](https://example.com).\n\n- a\n- b\n\n1. one\n2. two\n\n- [ ] task\n- [x] done\n\n> quote\n\n---\n\n```ts\nconst x = 1;\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n![Alt text](/media/0f8fad5b-d9cb-469f-a165-70867728950e/x.png)\n",
    shortcodes: ':::callout{type="info" title="Note"}\nText **here**.\n:::\n\nPara.\n\n::video{src="/media/0f8fad5b-d9cb-469f-a165-70867728950e/demo.mp4"}\n\n<!-- owner note -->\n\n::toc\n',
  };
  for (const f of fs.readdirSync("content/blog")) samples[f] = fs.readFileSync(`content/blog/${f}`, "utf8").replace(/^---[\s\S]*?---\n/, "");
  for (const [k, v] of Object.entries(samples)) {
    const r = fidelity(v);
    console.log(k, JSON.stringify(r));
    if (k === "basic" || k === "shortcodes") console.log(serializeMarkdown(parseMarkdown(v)));
  }
});
