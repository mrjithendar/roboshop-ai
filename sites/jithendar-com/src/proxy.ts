import { NextResponse, type NextRequest } from "next/server";
import { isGone } from "@/config/gone";
import { isIndexableHost } from "@/config/site";

const NOINDEX = "noindex, nofollow";

/** One JSON access-log line per request (static assets excluded by the matcher). */
function accessLog(request: NextRequest, response: NextResponse, requestId: string) {
  // NextResponse.next() means the app renders it; only proxy-decided responses have a final status here.
  const decided = response.headers.has("x-middleware-next") ? {} : { status: response.status };
  // Plain stdout write: the proxy must stay dependency-free and fast.
  process.stdout.write(
    `${JSON.stringify({
      time: new Date().toISOString(),
      level: "info",
      msg: "request",
      service: "jithendar-com",
      requestId,
      method: request.method,
      path: request.nextUrl.pathname,
      ...decided,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent")?.slice(0, 200) ?? null,
    })}\n`,
  );
}

export function proxy(request: NextRequest) {
  const response = route(request);
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  response.headers.set("x-request-id", requestId);
  if (process.env.ACCESS_LOG !== "false" && process.env.NODE_ENV !== "test") accessLog(request, response, requestId);
  return response;
}

function route(request: NextRequest): NextResponse {
  const indexable = isIndexableHost(request.headers.get("host"));

  if (isGone(request.nextUrl.pathname)) {
    return new NextResponse("410 Gone\n", {
      status: 410,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": NOINDEX },
    });
  }

  const { pathname } = request.nextUrl;
  // IndexNow key file at the site root ({key}.txt), proving ownership to participating search engines.
  const indexNowKey = process.env.INDEXNOW_KEY;
  if (indexNowKey && /^[A-Za-z0-9-]{8,128}$/.test(indexNowKey) && pathname === `/${indexNowKey}.txt`) {
    return new NextResponse(indexNowKey, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
  }

  if (pathname.length > 1 && pathname.endsWith("/")) {
    // A plain URL: NextURL re-applies the trailing slash when formatted.
    const url = new URL(request.url);
    url.pathname = pathname.replace(/\/+$/, "") || "/";
    return NextResponse.redirect(url, 308);
  }

  const response = NextResponse.next();
  if (!indexable) response.headers.set("X-Robots-Tag", NOINDEX);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
