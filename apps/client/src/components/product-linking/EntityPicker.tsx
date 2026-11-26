"use client";

import type { ActionError } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Input } from "@workspace/ui/components/input";
import { Spinner } from "@workspace/ui/components/spinner";
import { StatusChip } from "@workspace/ui/components/status-chip";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

/** Loads the pickable items plus, optionally, the ids already linked to the target. */
export type PickerLoad<T> = () => Promise<
  { items: T[]; linkedIds?: Iterable<number> } | ActionError
>;

/**
 * A searchable list of records to link to something: loads once, filters as
 * the user types, marks what is already linked, and runs `onPick` for a row.
 * A successful pick marks its row linked; `onPick` owns whatever the app
 * needs to refresh after that.
 */
export function EntityPicker<T extends { id: number }>({
  load,
  matches,
  renderRow,
  onPick,
  placeholder,
  emptyLabel,
  exclude,
}: {
  load: PickerLoad<T>;
  matches: (item: T, query: string) => boolean;
  renderRow: (item: T) => ReactNode;
  /** Persists the pick. Returns whether it succeeded. */
  onPick: (item: T) => Promise<boolean>;
  placeholder: string;
  /** Shown when nothing is loaded at all (as opposed to nothing matching). */
  emptyLabel: string;
  /** Rows to leave out entirely (the target itself). */
  exclude?: (item: T) => boolean;
}) {
  const [items, setItems] = useState<T[] | null>(null);
  const [linked, setLinked] = useState<Set<number>>(() => new Set());
  const [search, setSearch] = useState("");
  const [pendingId, setPendingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void load().then((result) => {
      if (cancelled) return;
      if (isActionError(result)) {
        toast.error(result.error);
        setItems([]);
        return;
      }
      setItems(result.items);
      if (result.linkedIds) setLinked(new Set(result.linkedIds));
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (items ?? []).filter(
      (item) => !exclude?.(item) && (!q || matches(item, q))
    );
  }, [items, search, matches, exclude]);

  const pick = async (item: T) => {
    setPendingId(item.id);
    const ok = await onPick(item);
    setPendingId(null);
    if (!ok) return;
    setLinked((prev) => new Set(prev).add(item.id));
  };

  if (items === null) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Input
        placeholder={placeholder}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      {visible.length === 0 ? (
        <p className="py-6 text-center text-small text-ink-soft">
          {search.trim() ? "Nothing matches your search." : emptyLabel}
        </p>
      ) : (
        <ul className="max-h-[24rem] overflow-y-auto">
          {visible.map((item) => {
            const isLinked = linked.has(item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={isLinked || pendingId !== null}
                  onClick={() => void pick(item)}
                  className={cn(
                    "flex w-full items-center gap-2 border-t border-rule px-2 py-2 text-left text-small first:border-t-0",
                    "hover:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]",
                    "disabled:cursor-default disabled:hover:bg-transparent",
                    isLinked && "text-ink-faint"
                  )}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    {renderRow(item)}
                  </span>
                  {pendingId === item.id ? (
                    <Spinner className="size-3.5" />
                  ) : isLinked ? (
                    <StatusChip flag colour="var(--ink-soft)">
                      Linked
                    </StatusChip>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The secondary text beside a picker row's title. */
export function PickerDetail({ children }: { children: ReactNode }) {
  return <span className="truncate text-micro text-ink-soft">{children}</span>;
}
