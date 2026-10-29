import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { actorOf } from "@/lib/admin";
import { isProductionEnv } from "@/config/site";
import { getSessionUser } from "@/lib/session";
import { createConfigPreview, endConfigPreview, PREVIEW_COOKIE } from "@/lib/site-config/store";
import { safeNext } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

/**
 * GET ?path=/blog → (admins only) issue a one-hour preview token in an HttpOnly cookie and open `path`,
 * which then renders with the draft configuration. GET ?exit=1 → revoke the token and return to the editor.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  if (url.searchParams.get("exit") === "1") {
    await endConfigPreview(jar.get(PREVIEW_COOKIE)?.value);
    const res = NextResponse.redirect(new URL("/admin/appearance", url), { status: 303, headers: NO_STORE });
    res.cookies.delete(PREVIEW_COOKIE);
    return res;
  }
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  const { token, maxAge } = await createConfigPreview(actorOf(user));
  const target = safeNext(url.searchParams.get("path"), "/");
  const res = NextResponse.redirect(new URL(target.startsWith("/admin") ? "/" : target, url), { status: 303, headers: NO_STORE });
  res.cookies.set(PREVIEW_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: isProductionEnv(), path: "/", maxAge });
  return res;
}
