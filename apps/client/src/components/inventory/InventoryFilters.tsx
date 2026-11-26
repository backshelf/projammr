"use client";

import { useInventorySearch } from "@/components/inventory/inventory-search-context";
import { Input } from "@workspace/ui/components/input";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { TogglePill } from "@workspace/ui/components/toggle-pill";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

type InventoryTab = { value: string; label: string };

type InventoryTabs = {
  /** The URL param the active tab is written to; `fallback`, the tab the
   *  page shows when the URL does not say, leaves it out. */
  param: string;
  active: string;
  fallback: string;
  items: InventoryTab[];
};

type InventoryLibraryToggle = {
  /** The URL param the toggle writes as `1` or `0`; the state the page shows
   *  when the URL does not say (`fallback`) leaves it out. */
  param: string;
  on: boolean;
  fallback: boolean;
  label: string;
};

export type InventoryFiltersProps = {
  tabs: InventoryTabs;
  searchPlaceholder: string;
  library?: InventoryLibraryToggle;
  /** The param a filter change drops from the URL: an expanded row belongs to the view it was opened in. */
  expandParam: string;
};

/**
 * An inventory page's tabs, optional Library toggle and search, together in
 * the page head's action slot. The tabs and the toggle are real filters: they
 * write the URL and the server re-renders with a shorter list. The search box
 * never leaves the browser, so it lives in {@link useInventorySearch} rather
 * than the URL.
 */
export function InventoryFilters({
  tabs,
  searchPlaceholder,
  library,
  expandParam,
}: InventoryFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { search, setSearch } = useInventorySearch();

  const replaceParams = useCallback(
    (change: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete(expandParam);
      change(params);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname, searchParams, expandParam]
  );

  const setTab = (value: string) =>
    replaceParams((params) => {
      if (value === tabs.fallback) params.delete(tabs.param);
      else params.set(tabs.param, value);
    });

  const setLibrary = (on: boolean) =>
    library &&
    replaceParams((params) => {
      if (on === library.fallback) params.delete(library.param);
      else params.set(library.param, on ? "1" : "0");
    });

  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      <Tabs value={tabs.active} onValueChange={setTab}>
        <TabsList variant="line">
          {tabs.items.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {library && (
        <TogglePill
          pressed={library.on}
          onPressedChange={setLibrary}
          className="self-start sm:self-auto"
        >
          {library.label}
        </TogglePill>
      )}
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        className="sm:w-48"
      />
    </div>
  );
}
