"use client";

import { useCommandScope } from "@/components/commands/provider";
import { VIEW_SCOPE, type ViewSurface } from "@/components/commands/views";
import { TABLE_PARAM } from "@/lib/table-params";
import { IconLayoutBoard, IconLayoutList } from "@tabler/icons-react";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

export type TableView = ViewSurface["current"];

/**
 * Toggles which surface renders the rows. A real navigation rather than
 * client state — the module page decides which component to render for the
 * current `view` param, so switching views goes through the router like any
 * other table-state change.
 *
 * While mounted it holds the `view` command scope, whose `b` key makes the
 * same switch to the other option. It renders only on pages that have a
 * board, so the key does nothing elsewhere.
 */
export function ViewSwitcher({ current }: { current: TableView }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setView = useCallback(
    (view: string) => {
      const params = new URLSearchParams(searchParams.toString());
      // Always set, never delete: a deleted `view` would leave a bare URL,
      // which a fresh load would redirect. A switch is never bare.
      params.set(TABLE_PARAM.view, view);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const surface = useMemo<ViewSurface>(
    () => ({
      current,
      toggle: () => setView(current === "list" ? "board" : "list"),
    }),
    [current, setView]
  );
  useCommandScope(VIEW_SCOPE, surface, true);

  return (
    <Tabs value={current} onValueChange={setView}>
      <TabsList variant="line">
        <TabsTrigger value="list">
          <IconLayoutList />
          List
        </TabsTrigger>
        <TabsTrigger value="board">
          <IconLayoutBoard />
          Board
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
