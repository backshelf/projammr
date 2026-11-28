import { ArtSwatch } from "@/components/art/ArtSwatch";
import { AppLink } from "@/components/navigation/AppLink";
import type { Artwork } from "@workspace/api/api";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { SIDEBAR_EYEBROW } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";

export type RecentItem = {
  id: number;
  label: string;
  href: string;
  /** Omit to show no swatch (sessions carry no artwork of their own). */
  swatch?: Artwork | null;
  /** Secondary tag shown beside repeated titles (e.g. linked track on notes). */
  badge?: string | null;
};

/**
 * The sidebar's short "recently edited" list under its caption. The server
 * already orders the summaries by `updatedAt`, so the list is the newest slice
 * of them and nothing more. With nothing to list there is no caption either.
 */
export function RecentlyEdited({
  items,
  hrefAll,
  allLabel,
}: {
  items: RecentItem[];
  hrefAll: string;
  allLabel: string;
}) {
  if (items.length === 0) return null;

  return (
    <>
      <p className={cn(SIDEBAR_EYEBROW, "-mb-1 px-2 pb-0 text-ink-soft")}>
        Recently edited
      </p>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.id}>
            <SidebarMenuButton asChild>
              <AppLink
                href={item.href}
                title={
                  item.badge ? `${item.label} · ${item.badge}` : item.label
                }
                className={"flex items-center gap-2 truncate"}
              >
                {item.swatch !== undefined && (
                  <ArtSwatch artwork={item.swatch} />
                )}
                <span className={"truncate"}>{item.label}</span>
                {item.badge && (
                  <span className="ml-auto max-w-20 shrink-0 truncate rounded border border-rule px-1 text-micro text-ink-faint">
                    {item.badge}
                  </span>
                )}
              </AppLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
        <SidebarMenuItem>
          <SidebarMenuButton asChild className={"text-ink-soft"}>
            <AppLink href={hrefAll}>{allLabel}</AppLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
}
