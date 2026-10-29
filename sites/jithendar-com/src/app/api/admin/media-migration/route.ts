import { migrationManifest } from "@/lib/media-migration";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Download the S3 → R2 manifest (old key, new key, site URL, public URL) as JSON. Admins only. */
export async function GET() {
  const user = await getSessionUser();
  if (user?.role !== "admin") return new Response("Not found", { status: 404 });
  return new Response(JSON.stringify(await migrationManifest(), null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="media-r2-manifest-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
