import { adsTxt } from "@/config/integrations";

export const dynamic = "force-dynamic";

/** /ads.txt: exactly the line(s) AdSense gives for this account (ADS_TXT), or 404 when not configured. */
export function GET() {
  const body = adsTxt();
  if (!body) return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
