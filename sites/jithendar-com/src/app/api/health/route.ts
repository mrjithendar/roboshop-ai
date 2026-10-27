// Liveness/readiness probe target: no content or network access, so it only fails when the server does.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
