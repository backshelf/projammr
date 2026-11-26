import {
  InventoryFilters,
  type InventoryFiltersProps,
} from "@/components/inventory/InventoryFilters";
import {
  InventoryWeb,
  type InventoryWebProps,
} from "@/components/inventory/InventoryWeb";
import { InventorySearchProvider } from "@/components/inventory/inventory-search-context";
import { ConstellationPlaceholder } from "@workspace/ui/components/constellation/constellation-frame";
import { PageHead } from "@workspace/ui/components/layout/page-head";
import { ScrollRoot } from "@workspace/ui/components/layout/scroll-root";
import { PAGE } from "@workspace/ui/lib/shell";
import { Suspense, type ReactNode } from "react";

/**
 * A project page that inventories what its sessions use, one row per thing:
 * the head with a lede, tabs, an optional Library toggle and a search box,
 * then the web of the sets and the things they use with its stock-chain
 * strip, then the rows. The web streams in behind the head, in a frame of its
 * own height so nothing below it moves. The search lights the web's nodes and
 * filters the rows; the tabs and the toggle are URL params, so the server
 * re-renders with a shorter list. The page knows nothing about what it lists:
 * `filters`, `web` and `rows` carry all of it. With nothing to list, `web` is
 * left out and the rows' empty line stands alone.
 */
export function InventoryPage({
  crumbs,
  title,
  lede,
  filters,
  web,
  rows,
}: {
  crumbs: ReactNode;
  title: string;
  lede: ReactNode;
  filters: InventoryFiltersProps;
  web?: InventoryWebProps;
  /** Reads the search from `useInventorySearch`. */
  rows: ReactNode;
}) {
  return (
    <ScrollRoot className={PAGE}>
      <InventorySearchProvider>
        <PageHead
          crumbs={crumbs}
          title={title}
          lede={lede}
          action={<InventoryFilters {...filters} />}
        />
        {web && (
          <Suspense fallback={<ConstellationPlaceholder />}>
            <InventoryWeb {...web} />
          </Suspense>
        )}
        {rows}
      </InventorySearchProvider>
    </ScrollRoot>
  );
}
