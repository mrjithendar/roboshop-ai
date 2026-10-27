import fs from "node:fs";
import path from "node:path";
import { imageSize } from "image-size";

/** All site images live in public/images and are referenced as /images/... */
export const IMAGE_PREFIX = "/images/";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".svg"];

export function publicRoot(): string {
  // public/ is copied next to server.js in the image; resolved at request time, not traced.
  return process.env.PUBLIC_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "public");
}

export type LocalImage = { src: string; file: string; width: number; height: number; svg: boolean };

/** Resolve a /images/... src to its file and intrinsic size; undefined if it is not a readable local image. */
export function readLocalImage(src: string, root: string = publicRoot()): LocalImage | undefined {
  if (!src.startsWith(IMAGE_PREFIX) || src.includes("..")) return undefined;
  const file = path.join(/*turbopackIgnore: true*/ root, decodeURI(src));
  if (!file.startsWith(path.join(root, IMAGE_PREFIX)) || !fs.existsSync(file)) return undefined;
  try {
    const size = imageSize(fs.readFileSync(file));
    if (!size.width || !size.height) return undefined;
    return { src, file, width: size.width, height: size.height, svg: path.extname(file).toLowerCase() === ".svg" };
  } catch {
    return undefined;
  }
}

export type ImageRef = { src: string; alt: string | undefined };

/** Images referenced in an MDX body: markdown ![alt](src "title") and <img src alt>. */
export function imageRefs(body: string): ImageRef[] {
  const refs: ImageRef[] = [];
  for (const m of body.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) {
    refs.push({ alt: m[1], src: m[2]! });
  }
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1];
    const alt = /\balt=["']([^"']*)["']/i.exec(tag)?.[1];
    if (src) refs.push({ src, alt });
  }
  return refs;
}

export type ImageProblem = { file: string; src: string; problem: string };

/** Validate one image reference: local, allowed type, present, under the size limit, with alt text. */
export function checkImage(file: string, ref: ImageRef, root: string = publicRoot()): ImageProblem[] {
  const problems: string[] = [];
  if (!ref.alt?.trim()) problems.push("missing alt text");
  if (/^(https?:)?\/\//i.test(ref.src)) {
    problems.push("remote images are not allowed (they leak readers' IPs to third parties); add the file under public/images");
  } else if (!ref.src.startsWith(IMAGE_PREFIX)) {
    problems.push(`must live under public${IMAGE_PREFIX} and be referenced as ${IMAGE_PREFIX}...`);
  } else if (!IMAGE_EXTENSIONS.includes(path.extname(ref.src).toLowerCase())) {
    problems.push(`unsupported type (use ${IMAGE_EXTENSIONS.join(", ")})`);
  } else {
    const local = path.join(root, decodeURI(ref.src));
    if (!fs.existsSync(local)) problems.push("file not found in public/");
    else if (fs.statSync(local).size > MAX_IMAGE_BYTES) problems.push(`larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB; resize or compress it`);
    else if (!readLocalImage(ref.src, root)) problems.push("not a readable image");
  }
  return problems.map((problem) => ({ file, src: ref.src, problem }));
}
