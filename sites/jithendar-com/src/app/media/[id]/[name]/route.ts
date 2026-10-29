import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getSessionUser } from "@/lib/session";
import { getObject, IMMUTABLE, presignGet, publicObjectUrl } from "@/lib/storage";
import { legacyGet } from "@/lib/storage-legacy";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RANGE = /^bytes=\d*-\d*$/;

/**
 * Uploaded media under our own domain. Ids are immutable, so responses are cached for a year.
 * - Images are streamed from R2 (next/image optimises them from this URL; readers make no third-party requests).
 * - Video, audio and PDFs redirect to R2_PUBLIC_BASE_URL when one is configured (Cloudflare serves the
 *   bytes and range requests); otherwise they are streamed here with Range support.
 * - Private files are only for signed-in staff, through a five-minute signed link.
 * - Rows not yet migrated from the old S3 bucket are read from it transparently.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const [row] = await db.select().from(schema.media).where(eq(schema.media.id, id));
  if (!row || row.status !== "ready") return new Response("Not found", { status: 404 });

  if (row.visibility === "private") {
    const user = await getSessionUser();
    if (!user || (user.role !== "admin" && user.role !== "author") || row.storageBackend !== "r2") return new Response("Not found", { status: 404 });
    return new Response(null, { status: 302, headers: { Location: await presignGet(row.storageKey, row.filename), "Cache-Control": "private, no-store" } });
  }

  if (row.kind !== "images" && row.storageBackend === "r2") {
    const url = await publicObjectUrl(row.storageKey);
    if (url) return new Response(null, { status: 301, headers: { Location: url, "Cache-Control": "public, max-age=86400" } });
  }

  const rangeHeader = req.headers.get("range");
  const range = rangeHeader && RANGE.test(rangeHeader) && row.kind !== "images" ? rangeHeader : undefined;
  const res = row.storageBackend === "r2" ? await getObject(row.storageKey, range).catch(() => null) : await legacyGet(row.storageKey, range);
  if (!res?.Body) return new Response("Temporarily unavailable", { status: 503, headers: { "Retry-After": "30" } });

  const headers: Record<string, string> = {
    "Content-Type": row.contentType,
    "Cache-Control": IMMUTABLE,
    "Accept-Ranges": row.kind === "images" ? "none" : "bytes",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  if (res.ContentLength !== undefined) headers["Content-Length"] = String(res.ContentLength);
  if (res.ContentRange) headers["Content-Range"] = res.ContentRange;
  if (res.ETag) headers.ETag = res.ETag;
  if (row.kind === "documents") headers["Content-Disposition"] = `inline; filename="${row.filename}"`;
  return new Response(res.Body.transformToWebStream(), { status: res.ContentRange ? 206 : 200, headers });
}
