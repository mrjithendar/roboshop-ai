import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findImageProblems } from "@/lib/content/links";
import { checkImage, imageRefs, MAX_IMAGE_BYTES, readLocalImage } from "@/lib/images";
import { REAL_CONTENT } from "./helpers";

// Smallest valid 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

let pub: string;
beforeEach(() => {
  pub = fs.mkdtempSync(path.join(os.tmpdir(), "public-"));
  fs.mkdirSync(path.join(pub, "images", "post"), { recursive: true });
  fs.writeFileSync(path.join(pub, "images", "post", "diagram.png"), PNG);
});
afterEach(() => fs.rmSync(pub, { recursive: true, force: true }));

describe("image references", () => {
  it("finds markdown and <img> images with their alt text", () => {
    const body = `![Cluster diagram](/images/post/diagram.png "Figure 1")\n<img src="/images/a.webp" alt="A" />\n![](/images/b.png)`;
    expect(imageRefs(body)).toEqual([
      { alt: "Cluster diagram", src: "/images/post/diagram.png" },
      { alt: "", src: "/images/b.png" },
      { src: "/images/a.webp", alt: "A" },
    ]);
  });

  it("reads intrinsic size of local images and refuses paths outside /images", () => {
    expect(readLocalImage("/images/post/diagram.png", pub)).toMatchObject({ width: 1, height: 1, svg: false });
    expect(readLocalImage("/images/../secret.png", pub)).toBeUndefined();
    expect(readLocalImage("/other/diagram.png", pub)).toBeUndefined();
    expect(readLocalImage("/images/missing.png", pub)).toBeUndefined();
  });
});

describe("image validation", () => {
  const problems = (src: string, alt?: string) => checkImage("post.mdx", { src, alt }, pub).map((p) => p.problem);

  it("accepts a local image with alt text", () => {
    expect(problems("/images/post/diagram.png", "Diagram")).toEqual([]);
  });

  it.each([
    ["missing alt text", "/images/post/diagram.png", ""],
    ["remote images are not allowed", "https://example.com/x.png", "X"],
    ["remote images are not allowed", "//cdn.example.com/x.png", "X"],
    ["must live under public/images/", "/uploads/x.png", "X"],
    ["unsupported type", "/images/post/doc.pdf", "X"],
    ["file not found", "/images/post/missing.png", "X"],
  ])("reports %s", (expected, src, alt) => {
    expect(problems(src, alt).some((p) => p.startsWith(expected))).toBe(true);
  });

  it("rejects files over the size limit", () => {
    fs.writeFileSync(path.join(pub, "images", "post", "huge.png"), Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]));
    expect(problems("/images/post/huge.png", "Huge").some((p) => p.startsWith("larger than"))).toBe(true);
  });
});

describe("repository content", () => {
  it("has only valid, local, alt-texted images", () => {
    expect(findImageProblems({ root: REAL_CONTENT }, path.resolve(import.meta.dirname, "../public"))).toEqual([]);
  });
});
