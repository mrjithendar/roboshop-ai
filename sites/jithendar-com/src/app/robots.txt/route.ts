import { headers } from "next/headers";
import { isIndexableHost } from "@/config/site";
import { robotsTxt } from "@/lib/seo/robots";

export async function GET() {
  const host = (await headers()).get("host");
  return new Response(robotsTxt(isIndexableHost(host)), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
