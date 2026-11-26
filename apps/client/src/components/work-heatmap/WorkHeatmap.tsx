"use client";

import { clientGetProjectHeatmap, type HeatmapFilters } from "@/lib/client-api";
import { isDawId } from "@/lib/daw";
import { lastSaveLabel } from "@workspace/ui/lib/day-label";
import { useHeatmapWindow } from "@/hooks/use-heatmap-window";
import { YEAR_WEEKS } from "@/lib/heatmap-range";
import { pluralizeCount } from "@workspace/session-diff/format";
import type {
  CollectionSummary,
  HeatmapDay,
  Label,
  SessionDaw,
} from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Heatmap } from "@workspace/ui/components/heatmap";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { streaks } from "@workspace/ui/lib/heatmap";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { RecentSaves } from "./RecentSaves";

/**
 * Query-string keys for the WORK heatmap's own collection/label/DAW filters.
 * Deliberately distinct from `collection`/`label`/`daw` in
 * `lib/table-params.ts` — those already belong to the collections table on
 * this same project page, and sharing them would make filtering the table
 * silently filter the heatmap too.
 */
const HEATMAP_PARAM = {
  collection: "wc",
  label: "wl",
  daw: "wd",
  day: "wday",
} as const;

const ALL = "all";

function numberParam(value: string | null): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** A hand-edited URL is the only way a value that is not a DAW id reaches
 *  here, and the server answers 400 for one — which would read as a project
 *  with no saves rather than as a bad link. Drop it instead. */
function dawParam(value: string | null): string | undefined {
  return value != null && isDawId(value) ? value : undefined;
}

/**
 * The project's save-activity grid over a fixed trailing 53-week window, the
 * saves behind it, and the collection/label/DAW filters both obey. Picking a
 * day on the grid narrows the feed to it without touching the grid. All of
 * that state lives in the URL (its own `wc`/`wl`/`wd`/`wday` params) so a
 * filtered view is linkable, the same way `ViewSwitcher` drives the table's
 * `view` param.
 */
export function WorkHeatmap({
  projectId,
  collections,
  labels,
  daws,
}: {
  projectId: number;
  collections: CollectionSummary[];
  labels: Label[];
  daws: SessionDaw[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const collectionId = numberParam(searchParams.get(HEATMAP_PARAM.collection));
  const labelId = numberParam(searchParams.get(HEATMAP_PARAM.label));
  const daw = dawParam(searchParams.get(HEATMAP_PARAM.daw));
  const selectedDay = searchParams.get(HEATMAP_PARAM.day) ?? undefined;

  const setFilter = useCallback(
    (key: string, value: string | undefined) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname, searchParams]
  );

  const { from, to, today, query, weekStart } = useHeatmapWindow(YEAR_WEEKS);

  const [days, setDays] = useState<HeatmapDay[]>([]);

  useEffect(() => {
    let cancelled = false;
    const filters: HeatmapFilters = { collectionId, labelId, daw };

    void clientGetProjectHeatmap(projectId, query, filters).then((result) => {
      if (cancelled) return;
      setDays(isActionError(result) ? [] : result);
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, collectionId, labelId, daw, query]);

  const totalSaves = days.reduce((sum, d) => sum + d.saves, 0);
  const { longest, since, current } = streaks(days, today);

  // The streak sentence only earns its place once it says something the raw
  // count doesn't: a one-day "streak" is just today, and repeating the same
  // number as both the current and the longest streak says nothing twice.
  const lede = [
    `${pluralizeCount(totalSaves, "save")} on ${pluralizeCount(days.length, "day")}`,
    current >= 2 ? `on a ${current}-day streak` : null,
    current === longest
      ? null
      : `longest streak ${pluralizeCount(longest, "day")}`,
    since == null ? null : `last save ${lastSaveLabel(since)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  // Each filter's own "All …" option sits ahead of the entities it lists, so
  // the same array both drives `Select`'s `items` (the trigger's label
  // lookup) and the `SelectItem`s the popup renders — one place to keep the
  // wording in sync.
  const collectionItems = [
    { value: ALL, label: "All collections" },
    ...collections.map((collection) => ({
      value: String(collection.id),
      label: collection.title,
    })),
  ];
  const labelItems = [
    { value: ALL, label: "All labels" },
    ...labels.map((label) => ({ value: String(label.id), label: label.name })),
  ];
  const dawItems = [
    { value: ALL, label: "All DAWs" },
    ...daws.map((d) => ({ value: d.daw, label: d.dawName ?? d.daw })),
  ];

  return (
    <>
      <SectionHead
        action={
          <div className="flex items-center gap-2">
            <Select
              value={collectionId != null ? String(collectionId) : ALL}
              onValueChange={(value) =>
                setFilter(
                  HEATMAP_PARAM.collection,
                  value === ALL ? undefined : value
                )
              }
              items={collectionItems}
            >
              <SelectTrigger size="sm" className="w-36">
                <SelectValue placeholder="Collection" />
              </SelectTrigger>
              <SelectContent>
                {collectionItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={labelId != null ? String(labelId) : ALL}
              onValueChange={(value) =>
                setFilter(
                  HEATMAP_PARAM.label,
                  value === ALL ? undefined : value
                )
              }
              items={labelItems}
            >
              <SelectTrigger size="sm" className="w-32">
                <SelectValue placeholder="Label" />
              </SelectTrigger>
              <SelectContent>
                {labelItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={daw ?? ALL}
              onValueChange={(value) =>
                setFilter(HEATMAP_PARAM.daw, value === ALL ? undefined : value)
              }
              items={dawItems}
            >
              <SelectTrigger size="sm" className="w-32">
                <SelectValue placeholder="DAW" />
              </SelectTrigger>
              <SelectContent>
                {dawItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        WORK
      </SectionHead>
      <div className="flex flex-col gap-3">
        <Heatmap
          days={days}
          from={from}
          to={to}
          weekStart={weekStart}
          selectedDay={selectedDay}
          onSelectDay={(day) =>
            setFilter(HEATMAP_PARAM.day, day === selectedDay ? undefined : day)
          }
        />
        <p className="text-micro text-ink-soft">{lede}</p>
      </div>
      <div className="mt-6">
        <RecentSaves
          projectId={projectId}
          day={selectedDay}
          collectionId={collectionId}
          labelId={labelId}
          daw={daw}
          onClearDay={() => setFilter(HEATMAP_PARAM.day, undefined)}
        />
      </div>
    </>
  );
}
