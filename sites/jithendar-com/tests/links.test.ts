import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findBrokenLinks, internalLinks } from "@/lib/content/links";
import { NOW, REAL_CONTENT } from "./helpers";

describe("internal link extraction", () => {
  it("finds markdown and href links, ignoring external, protocol-relative, query and fragment", async () => {
    const body = `See [a](/blog/x#part), [b](/about/), [c](https://example.com/y), [d](//cdn.example.com/z),
<a href="/news?page=2">n</a> and [top](/). ![diagram](/images/x.png) is an image, not a link.`;
    expect(internalLinks(body).sort()).toEqual(["/", "/about", "/blog/x", "/news"]);
  });
});

describe("broken internal links", () => {
  let dir: string;
  afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }));

  const article = (slug: string, status: string, body: string) =>
    `---\ntitle: A valid article title\nslug: ${slug}\ndescription: A description that is comfortably longer than fifty characters.\nauthor: a\ncategory: kubernetes\ncontentType: tutorial\nstatus: ${status}\npublishedAt: "2026-10-01T09:00:00+05:30"\n---\n${body}\n`;

  function site(files: Record<string, string>) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "links-"));
    for (const [rel, text] of Object.entries({ "authors/a.mdx": "---\nname: A\nslug: a\n---\n", ...files })) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    }
    return dir;
  }

  it("flags a published article linking to a draft or a missing page", async () => {
    const root = site({
      "blog/live.mdx": article("live", "published", "[draft](/blog/wip) [missing](/nowhere) [ok](/blog)"),
      "blog/wip.mdx": article("wip", "draft", "[live](/blog/live)"),
    });
    expect(await findBrokenLinks({ root, now: NOW })).toEqual([
      { file: path.join(root, "blog/live.mdx"), link: "/blog/wip" },
      { file: path.join(root, "blog/live.mdx"), link: "/nowhere" },
    ]);
  });

  it("lets drafts link to other unpublished content", async () => {
    const root = site({
      "blog/one.mdx": article("one", "review", "[two](/blog/two)"),
      "blog/two.mdx": article("two", "draft", "[one](/blog/one)"),
    });
    expect(await findBrokenLinks({ root, now: NOW })).toEqual([]);
  });
});

describe("repository content", () => {
  it("has no broken internal links", async () => {
    expect(await findBrokenLinks({ root: REAL_CONTENT })).toEqual([]);
  });
});
