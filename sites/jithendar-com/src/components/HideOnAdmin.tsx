"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** The admin app has its own shell; public-only chrome (the site footer) is left out there. */
export function HideOnAdmin({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return pathname === "/admin" || pathname.startsWith("/admin/") ? null : children;
}
