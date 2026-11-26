"use client";

import { createContext, use, useMemo, useState } from "react";

type InventorySearch = {
  search: string;
  setSearch: (search: string) => void;
  /** What the rows and the graph match against: trimmed and lower-cased. */
  query: string;
};

const InventorySearchContext = createContext<InventorySearch | null>(null);

/**
 * An inventory page's search box lives in the page head, while the graph and
 * the rows it filters sit lower on the page: components with no ancestry
 * between them. This provider is their shared ground: the page wraps all of
 * them in it, the box writes here, and the graph and the rows read.
 */
export function InventorySearchProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [search, setSearch] = useState("");
  const value = useMemo(
    () => ({ search, setSearch, query: search.trim().toLowerCase() }),
    [search]
  );

  return (
    <InventorySearchContext value={value}>{children}</InventorySearchContext>
  );
}

export const useInventorySearch = () => {
  const inventorySearch = use(InventorySearchContext);
  if (!inventorySearch)
    throw new Error("useInventorySearch requires an InventorySearchProvider");
  return inventorySearch;
};
