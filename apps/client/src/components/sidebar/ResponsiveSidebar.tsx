import type { PropsWithChildren } from "react";
import { Sidebar } from "@workspace/ui/components/sidebar";

/**
 * The app sidebar's shell: an off-canvas column that slides away on desktop
 * and is absent on phones, which navigate through the docked chrome instead.
 */
export function ResponsiveSidebar({ children }: PropsWithChildren) {
  return (
    <Sidebar collapsible="offcanvas" mobile="hidden">
      {children}
    </Sidebar>
  );
}
