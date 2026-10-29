import { NextResponse, type NextRequest } from "next/server";
import { isGone } from "@/config/gone";
import { isIndexableHost } from "@/config/site";
import { MAINTENANCE_EXEMPT, maintenancePage, maintenanceState } from "@/lib/site-config/maintenance";

const PREVIEW_COOKIE = "site_preview";

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

export async function proxy(request: NextRequest) {
  const response = (await maintenance(request)) ?? route(request);
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
  // Draft previews (admin-only, see lib/site-config): never cached by anyone, never indexed.
  if (request.cookies.has(PREVIEW_COOKIE)) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", NOINDEX);
  }
  return response;
}

/**
 * Maintenance mode (Admin → Appearance → General): public pages answer 503 with Retry-After, which tells
 * crawlers to come back later without dropping pages from the index (robots settings are not touched).
 * Admins and authors keep browsing the site; sign-in, admin, account and API routes stay up.
 */
async function maintenance(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;
  if (MAINTENANCE_EXEMPT.test(pathname)) return null;
  const state = await maintenanceState();
  if (!state.enabled) return null;
  if ([...request.cookies.getAll()].some((c) => c.name.endsWith("session_token"))) {
    const { getAuth } = await import("@/lib/auth");
    const session = await (await getAuth()).api.getSession({ headers: request.headers }).catch(() => null);
    const role = (session?.user as { role?: string } | undefined)?.role;
    if (role === "admin" || role === "author") return null;
  }
  const { getPublishedConfig } = await import("@/lib/site-config/store");
  const siteName = (await getPublishedConfig()).config.general.siteName;
  return new NextResponse(maintenancePage(siteName, state.message), {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": String(state.retryAfterMinutes * 60),
      "Cache-Control": "no-store",
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
