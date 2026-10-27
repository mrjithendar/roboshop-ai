import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth, type Role } from "./auth";

export type SessionUser = { id: string; name: string; email: string; role: Role; emailVerified: boolean };

export async function getSessionUser(): Promise<SessionUser | null> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user as typeof session.user & { role?: string; banned?: boolean | null };
  if (u.banned) return null;
  const role = (["admin", "author", "user"] as const).includes(u.role as Role) ? (u.role as Role) : "user";
  return { id: u.id, name: u.name, email: u.email, role, emailVerified: u.emailVerified };
}

/** Server components and actions: require one of the roles, otherwise send to /login. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/admin");
  if (!roles.includes(user.role)) redirect("/account?denied=1");
  return user;
}
