"use client";

import { useShellPolicy } from "@/lib/policies/provider";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import type { ComponentProps, CSSProperties } from "react";

/** `SidebarProvider` at the shell policy's sidebar width, following it as it changes. */
export function AppSidebarProvider({
  style,
  ...props
}: ComponentProps<typeof SidebarProvider>) {
  const { sidebarWidthRem } = useShellPolicy();
  return (
    <SidebarProvider
      {...props}
      style={
        {
          ...style,
          "--sidebar-width": `${sidebarWidthRem}rem`,
        } as CSSProperties
      }
    />
  );
}
