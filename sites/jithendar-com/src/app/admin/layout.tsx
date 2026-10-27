import { count, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AdminNav, type NavItem } from "@/components/admin/AdminNav";
import { LogoMark } from "@/components/Logo";
import { getDb, schema } from "@/db";
import { requireRole } from "@/lib/session";
import { SignOutButton } from "../account/SignOutButton";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin" }, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("admin", "author");
  const db = await getDb();
  const [[pending], [unread]] = await Promise.all([
    db.select({ n: count() }).from(schema.comment).where(eq(schema.comment.status, "pending")),
    db.select({ n: count() }).from(schema.contactMessage).where(eq(schema.contactMessage.status, "new")),
  ]);
  const isAdmin = user.role === "admin";
  const items: NavItem[] = [
    { href: "/admin", label: "Dashboard", section: "Overview" },
    { href: "/admin/posts", label: "Posts", section: "Content" },
    { href: "/admin/pages", label: "Pages", section: "Content" },
    { href: "/admin/media", label: "Media", section: "Content" },
    { href: "/admin/categories", label: "Categories", section: "Content" },
    { href: "/admin/tags", label: "Tags", section: "Content" },
    { href: "/admin/comments", label: "Comments", badge: pending?.n, section: "Community" },
    ...(isAdmin ? [{ href: "/admin/messages", label: "Messages", badge: unread?.n, section: "Community" }] : []),
    { href: "/admin/profile", label: "Author profile", section: "Account" },
    { href: "/admin/api-keys", label: "API keys", section: "Account" },
    ...(isAdmin
      ? [
          { href: "/admin/users", label: "Users", section: "Site" },
          { href: "/admin/settings", label: "Settings", section: "Site" },
          { href: "/admin/backups", label: "Backups", section: "Site" },
          { href: "/admin/system", label: "System status", section: "Operations" },
          { href: "/admin/database", label: "Database", section: "Operations" },
          { href: "/admin/audit", label: "Audit log", section: "Operations" },
        ]
      : []),
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black/30">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-8 lg:grid-cols-[240px_minmax(0,1fr)] sm:px-8">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Link href="/admin" className="mb-6 flex items-center gap-2 px-3">
            <LogoMark className="h-7 w-7" />
            <span className="font-semibold text-ink dark:text-white">Admin</span>
          </Link>
          <AdminNav items={items} />
          <div className="mt-8 border-t border-slate-200 px-3 pt-6 text-sm dark:border-white/10">
            <p className="font-medium text-ink dark:text-white">{user.name}</p>
            <p className="truncate text-slate-500 dark:text-slate-400">
              {user.email} · {user.role}
            </p>
            <div className="mt-3">
              <SignOutButton />
            </div>
          </div>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
