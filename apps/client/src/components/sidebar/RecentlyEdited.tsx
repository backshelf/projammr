import { ArtSwatch } from "@/components/art/ArtSwatch";
import { SidebarNavLink } from "@/components/sidebar/SidebarNavLink";
import type { Artwork } from "@workspace/api/api";
import { SidebarMenu, SidebarMenuItem } from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";

export type RecentItem = {
  id: number;
  label: string;
  href: string;
  /** Omit to show no spine (notes and sessions carry no artwork of their own). */
  swatch?: Artwork | null;
  /** Secondary context line shown quietly beneath the title (e.g. linked track on notes). */
  badge?: string | null;
};

/**
 * The sidebar's short recent list under a section heading. The server already
 * orders summaries by `updatedAt`, so the list is the newest slice followed by
 * the link to the full listing.
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
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.id}>
          <SidebarNavLink
            href={item.href}
            title={item.badge ? `${item.label} · ${item.badge}` : item.label}
            className={cn(item.badge && "h-auto items-start py-1.5")}
          >
            {item.swatch !== undefined && (
              <ArtSwatch artwork={item.swatch} variant="spine" />
            )}
            {item.badge ? (
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate leading-snug">{item.label}</span>
                <span className="truncate text-micro leading-tight text-ink-faint">
                  {item.badge}
                </span>
              </span>
            ) : (
              <span className="truncate">{item.label}</span>
            )}
          </SidebarNavLink>
        </SidebarMenuItem>
      ))}
      <SidebarMenuItem className="pt-0.5">
        <SidebarNavLink
          href={hrefAll}
          className="h-6 text-micro text-ink-faint hover:text-ink"
        >
          {allLabel}
        </SidebarNavLink>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
