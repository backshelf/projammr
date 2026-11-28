"use client";

import { AppLink } from "@/components/navigation/AppLink";
import {
  SidebarMenuButton,
  SidebarMenuSubButton,
} from "@workspace/ui/components/sidebar";
import { usePathname } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";

function normalizePath(path: string): string {
  const bare = path.split(/[?#]/, 1)[0] ?? path;
  if (bare.length > 1 && bare.endsWith("/")) return bare.slice(0, -1);
  return bare;
}

/** Exact path match against the active URL, ignoring query strings and hashes. */
export function isSidebarPathActive(
  pathname: string | null,
  href: string
): boolean {
  if (!pathname) return false;
  return normalizePath(pathname) === normalizePath(href);
}

export function SidebarNavLink({
  href,
  title,
  className,
  size = "sm",
  children,
}: {
  href: string;
  title?: string;
  className?: string;
  size?: ComponentProps<typeof SidebarMenuButton>["size"];
  children: ReactNode;
}) {
  const active = isSidebarPathActive(usePathname(), href);

  return (
    <SidebarMenuButton
      asChild
      isActive={active}
      size={size}
      className={className}
    >
      <AppLink
        href={href}
        title={title}
        aria-current={active ? "page" : undefined}
      >
        {children}
      </AppLink>
    </SidebarMenuButton>
  );
}

export function SidebarSubNavLink({
  href,
  title,
  className,
  children,
}: {
  href: string;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const active = isSidebarPathActive(usePathname(), href);

  return (
    <SidebarMenuSubButton asChild isActive={active} className={className}>
      <AppLink
        href={href}
        title={title}
        aria-current={active ? "page" : undefined}
      >
        {children}
      </AppLink>
    </SidebarMenuSubButton>
  );
}
