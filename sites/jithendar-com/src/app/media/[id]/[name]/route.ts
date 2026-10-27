import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Uploaded images, streamed from S3 under our own domain (no third-party requests for readers). Ids are immutable. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const [row] = await db.select({ key: schema.media.storageKey, contentType: schema.media.contentType }).from(schema.media).where(eq(schema.media.id, id));
  if (!row) return new Response("Not found", { status: 404 });
  const bytes = await getObject(row.key);
  if (!bytes) return new Response("Temporarily unavailable", { status: 503, headers: { "Retry-After": "30" } });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": row.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
