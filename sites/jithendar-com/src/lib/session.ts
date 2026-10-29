import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth, type Role } from "./auth";

export type SessionUser = { id: string; name: string; email: string; role: Role; emailVerified: boolean; image: string | null; sessionCreatedAt: Date };

export async function getSessionUser(): Promise<SessionUser | null> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user as typeof session.user & { role?: string; banned?: boolean | null };
  if (u.banned) return null;
  const role = (["admin", "author", "user"] as const).includes(u.role as Role) ? (u.role as Role) : "user";
  return { id: u.id, name: u.name, email: u.email, role, emailVerified: u.emailVerified, image: u.image ?? null, sessionCreatedAt: new Date(session.session.createdAt) };
}

/** Server components and actions: require one of the roles, otherwise send to /login. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/admin&expired=1");
  if (!roles.includes(user.role)) redirect("/account?denied=1");
  return user;
}

/** Any signed-in user (account pages); otherwise to /login, returning to `next` afterwards. */
export async function requireUser(next: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

/** Whether the session is recent enough for sensitive account changes (Better Auth's freshAge). */
export function isFreshSession(user: SessionUser, freshSeconds: number, now = Date.now()): boolean {
  return now - user.sessionCreatedAt.getTime() < freshSeconds * 1000;
}
