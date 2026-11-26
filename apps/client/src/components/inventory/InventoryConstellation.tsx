"use client";

import { useInventorySearch } from "@/components/inventory/inventory-search-context";
import { AppLink } from "@/components/navigation/AppLink";
import type { LinkComponent } from "@workspace/ui/components/anchor";
import { ConstellationPlaceholder } from "@workspace/ui/components/constellation/constellation-frame";
import type { ConstellationData } from "@workspace/ui/lib/constellation";
import dynamic from "next/dynamic";

// The renderer needs WebGL and a DOM, so it loads in the browser only, in
// the frame the page already holds for it.
const Constellation = dynamic(
  () =>
    import("@workspace/ui/components/constellation/constellation").then(
      (module) => module.Constellation
    ),
  { ssr: false, loading: () => <ConstellationPlaceholder /> }
);

/** A note's link out keeps the page where it is: "Show row" opens a row
 *  further down this page, which brings itself into view. */
const NoteLink: LinkComponent = (props) => (
  <AppLink {...props} scroll={false} />
);

/**
 * An inventory page's web: the settled drawing the server laid out, lit by
 * the page's search as the rows below are filtered by it.
 */
export function InventoryConstellation({
  data,
  label,
}: {
  data: ConstellationData;
  /** What a screen reader hears in place of the drawing: the page's lede. */
  label: string;
}) {
  const { query } = useInventorySearch();
  return (
    <Constellation
      data={data}
      label={label}
      highlight={query}
      link={NoteLink}
    />
  );
}
