import { NextResponse, type NextRequest } from "next/server";
import { isGone } from "@/config/gone";
import { isIndexableHost } from "@/config/site";

const NOINDEX = "noindex, nofollow";

export function proxy(request: NextRequest) {
  const indexable = isIndexableHost(request.headers.get("host"));

  if (isGone(request.nextUrl.pathname)) {
    return new NextResponse("410 Gone\n", {
      status: 410,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": NOINDEX },
    });
  }

  const { pathname } = request.nextUrl;
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
