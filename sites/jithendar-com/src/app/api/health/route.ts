// Liveness/readiness probe target: no content or network access, so it only fails when the server does.
// `version` is the commit the image was built from; CI polls it to confirm a rollout.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", version: process.env.GIT_SHA ?? "dev" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
