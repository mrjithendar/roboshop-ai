"use server";

import { desc } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { mdxComponents } from "@/components/Mdx";
import { getDb, schema } from "@/db";
import { staffActor } from "@/lib/admin";
import { compileMdx } from "@/lib/mdx/compile";
import { storeUpload } from "@/lib/media";
import { storageReady } from "@/lib/storage";

/** Editor preview: the same safe Markdown pipeline as the public site (shortcodes, highlighting). */
export async function previewMarkdown(body: string): Promise<string> {
  await staffActor();
  const { Content } = await compileMdx(body.slice(0, 200_000));
  // Images in preview render as plain <img> (next/image needs the request pipeline).
  const components = { ...mdxComponents, img: (p: { src?: string; alt?: string }) => createElement("img", { src: p.src, alt: p.alt, loading: "lazy", style: { maxWidth: "100%" } }) };
  return renderToStaticMarkup(createElement(Content, { components }));
}

export type MediaItem = { id: string; src: string; alt: string; width: number; height: number; context: string };

export async function listMedia(limit = 60): Promise<MediaItem[]> {
  await staffActor();
  const db = await getDb();
  const rows = await db
    .select({ id: schema.media.id, filename: schema.media.filename, alt: schema.media.alt, width: schema.media.width, height: schema.media.height, context: schema.media.context })
    .from(schema.media)
    .orderBy(desc(schema.media.createdAt))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, src: `/media/${r.id}/${r.filename}`, alt: r.alt, width: r.width, height: r.height, context: r.context }));
}

export async function mediaUploadsEnabled(): Promise<boolean> {
  await staffActor();
  return storageReady();
}

export async function uploadMedia(form: FormData) {
  const actor = await staffActor();
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false as const, error: "Choose an image to upload." };
  return storeUpload({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, String(form.get("alt") ?? ""), actor.id, String(form.get("context") ?? "library"));
}
