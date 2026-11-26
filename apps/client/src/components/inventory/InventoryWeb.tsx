import { InventoryConstellation } from "@/components/inventory/InventoryConstellation";
import { StockChainStrip } from "@/components/inventory/StockChainStrip";
import type { InventoryWeb as Web } from "@/lib/inventory-web";

export type InventoryWebProps = {
  /** Lays the web out. Called when the web renders, after the head: the
   *  layout is synchronous work that would otherwise hold the head back. */
  layout: () => Promise<Web>;
  /** What a screen reader hears in place of the drawing: the page's lede. */
  label: string;
  /** Whether the web draws the stock chain (`?stock=1`). */
  stock: boolean;
  /** The same view with `stock` the other way. */
  toggleHref: string;
};

/**
 * An inventory page's web and the stock-chain strip under it. The layout is
 * the slowest part of the page, so it streams in behind the head in its own
 * Suspense boundary (`InventoryPage` holds the frame for it). A web with
 * nothing left to draw shows only the strip.
 */
export async function InventoryWeb({
  layout,
  label,
  stock,
  toggleHref,
}: InventoryWebProps) {
  const { web, stock: parked } = await layout();
  if (web.nodes.length === 0 && parked.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {web.nodes.length > 0 && (
        <InventoryConstellation data={web} label={label} />
      )}
      {parked.length > 0 && (
        <StockChainStrip items={parked} shown={stock} toggleHref={toggleHref} />
      )}
    </div>
  );
}
