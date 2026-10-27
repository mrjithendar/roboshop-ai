import { actorOf } from "@/lib/admin";
import { audit } from "@/lib/audit";
import { buildBackup } from "@/lib/backups";
import { PostError } from "@/lib/posts";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Download a fresh encrypted backup (admins only). */
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return new Response("Forbidden", { status: 403 });
  try {
    const { filename, data } = await buildBackup();
    await audit(actorOf(user), "backup.download", filename);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof PostError) return new Response(error.message, { status: 400 });
    throw error;
  }
}
