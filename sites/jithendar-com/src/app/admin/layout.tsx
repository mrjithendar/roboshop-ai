import { count, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AdminNav, type NavItem } from "@/components/admin/AdminNav";
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
          { href: "/admin/appearance", label: "Appearance & settings", section: "Site" },
          { href: "/admin/storage", label: "Storage & email", section: "Site" },
          { href: "/admin/backups", label: "Backups", section: "Site" },
          { href: "/admin/system", label: "System status", section: "Operations" },
          { href: "/admin/database", label: "Database", section: "Operations" },
          { href: "/admin/audit", label: "Audit log", section: "Operations" },
        ]
      : []),
  ];

  return (
    <div data-admin-shell className="min-h-[calc(100dvh-var(--spacing-header))] bg-surface-muted lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="border-b border-line bg-canvas lg:sticky lg:top-header lg:h-[calc(100dvh-var(--spacing-header))] lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 lg:min-h-full lg:gap-6 lg:px-4 lg:py-6">
          <Link href="/admin" className="hidden items-center gap-2 px-3 lg:flex">
            <span className="text-sm font-semibold text-fg">Admin</span>
            <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium capitalize text-fg-muted">{user.role}</span>
          </Link>
          <AdminNav items={items} />
          <div className="mt-auto hidden border-t border-line px-3 pt-4 text-sm lg:block">
            <p className="truncate font-medium text-fg" title={user.name}>{user.name}</p>
            <p className="truncate text-fg-subtle" title={user.email}>{user.email}</p>
            <div className="mt-3">
              <SignOutButton />
            </div>
          </div>
        </div>
      </aside>
      <div className="min-w-0 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </div>
    </div>
  );
}
