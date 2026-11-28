"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { ENTITY_API } from "@/entities/api";
import { toastActionResult } from "@/lib/action-toast";
import { browserApi } from "@/lib/browser-api";
import {
  clientGetTrackSessions,
  clientGetTrackSummaries,
} from "@/lib/client-api";
import { useFeedbackPolicy } from "@/lib/policies/provider";
import { hrefFromParsedRoute } from "@/lib/utils";
import { IconEyeOff, IconLink, IconPlus } from "@tabler/icons-react";
import type { ProjectToday, TrackSummary } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Button } from "@workspace/ui/components/button";
import { useFormat } from "@workspace/ui/components/format-provider";
import { Arrive } from "@workspace/ui/components/layout/arrive";
import {
  Row,
  RowMain,
  RowMeta,
  RowTitle,
  Rows,
} from "@workspace/ui/components/layout/rows";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import {
  ResponsivePicker,
  ResponsivePickerContent,
  ResponsivePickerEmpty,
  ResponsivePickerItem,
  ResponsivePickerList,
  ResponsivePickerSearch,
} from "@workspace/ui/components/responsive-picker";
import { StatusChip } from "@workspace/ui/components/status-chip";
import { pluralizeCount } from "@workspace/session-diff/format";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { cleanSetTitle, suggestTrackMatch } from "./unassigned-helpers";

export type UnassignedSetItem =
  ProjectToday["unassignedSets"]["sessions"][number];

function setMetaParts(
  item: UnassignedSetItem,
  format: ReturnType<typeof useFormat>
): string[] {
  const parts: string[] = [];
  const daw = item.dawName ?? item.daw;
  if (daw) parts.push(daw);
  if (item.saveCount > 0) parts.push(pluralizeCount(item.saveCount, "save"));
  const lastActivity =
    item.lastSaveAt ?? item.localFileUpdatedAt ?? item.updatedAt;
  if (lastActivity) parts.push(`saved ${format.relative(lastActivity)}`);
  const key = format.key(item.rootNote, item.scale);
  if (key) parts.push(key);
  if (item.tempo != null) parts.push(format.tempo(item.tempo));
  return parts;
}

function LinkSetToTrackPicker({
  projectId,
  item,
  tracks,
  loadingTracks,
  onOpen,
  onSelectTrack,
  disabled,
}: {
  projectId: number;
  item: UnassignedSetItem;
  tracks: TrackSummary[] | null;
  loadingTracks: boolean;
  onOpen: () => void;
  onSelectTrack: (track: TrackSummary) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const suggested = useMemo(
    () => (tracks ? suggestTrackMatch(item.name, tracks) : null),
    [tracks, item.name]
  );

  const orderedTracks = useMemo(() => {
    if (!tracks) return [];
    const q = query.trim().toLowerCase();
    const filtered = tracks.filter((track) => {
      if (!q) return true;
      return (
        track.title.toLowerCase().includes(q) ||
        (track.artists ?? []).some((a) => a.toLowerCase().includes(q))
      );
    });
    if (!suggested) return filtered;
    const match = filtered.find((t) => t.id === suggested.id);
    if (!match) return filtered;
    return [match, ...filtered.filter((t) => t.id !== suggested.id)];
  }, [tracks, query, suggested]);

  return (
    <ResponsivePicker
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onOpen();
      }}
      searchValue={query}
      onSearchChange={setQuery}
      align="end"
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={disabled}
          className="text-ink-soft hover:text-ink"
        >
          <IconLink size={14} aria-hidden />
          <span>Link to track</span>
        </Button>
      }
    >
      <ResponsivePickerContent
        title={`Link "${item.name}" to a track`}
        align="end"
        desktopClassName="w-72"
      >
        <ResponsivePickerSearch placeholder="Search tracks…" />
        <ResponsivePickerList>
          {loadingTracks && tracks === null ? (
            <ResponsivePickerEmpty>Loading tracks…</ResponsivePickerEmpty>
          ) : orderedTracks.length === 0 ? (
            <ResponsivePickerEmpty>
              {tracks && tracks.length === 0
                ? "No tracks in this project yet."
                : "No matching tracks."}
            </ResponsivePickerEmpty>
          ) : (
            orderedTracks.map((track) => {
              const isSuggested = suggested?.id === track.id;
              return (
                <ResponsivePickerItem
                  key={track.id}
                  onSelect={() => onSelectTrack(track)}
                  description={
                    isSuggested ? (
                      <span className="inline-flex items-center gap-1.5 text-art">
                        Suggested match
                        {track.artists?.length
                          ? ` · ${track.artists.join(", ")}`
                          : ""}
                      </span>
                    ) : track.artists?.length ? (
                      track.artists.join(", ")
                    ) : undefined
                  }
                >
                  <span className="inline-flex items-center gap-2">
                    <span className="truncate">{track.title}</span>
                    {isSuggested && (
                      <StatusChip flag colour="var(--art)">
                        Match
                      </StatusChip>
                    )}
                  </span>
                </ResponsivePickerItem>
              );
            })
          )}
        </ResponsivePickerList>
        <div className="border-t border-rule px-2 pt-1.5 text-micro text-ink-soft">
          <AppLink
            href={hrefFromParsedRoute({ kind: "track-all" }, projectId)}
            className="hover:text-ink"
          >
            Browse all tracks
          </AppLink>
        </div>
      </ResponsivePickerContent>
    </ResponsivePicker>
  );
}

export function UnassignedSetsList({
  projectId,
  sessions,
  total,
}: {
  projectId: number;
  sessions: readonly UnassignedSetItem[];
  total: number;
}) {
  const router = useRouter();
  const format = useFormat();
  const feedback = useFeedbackPolicy();

  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<number>>(
    () => new Set()
  );
  const [busyId, setBusyId] = useState<number | null>(null);
  const [tracks, setTracks] = useState<TrackSummary[] | null>(null);
  const [loadingTracks, setLoadingTracks] = useState(false);

  const loadTracks = useCallback(async () => {
    if (tracks !== null || loadingTracks) return;
    setLoadingTracks(true);
    try {
      const result = await clientGetTrackSummaries(projectId);
      setTracks(isActionError(result) ? [] : result);
    } finally {
      setLoadingTracks(false);
    }
  }, [projectId, tracks, loadingTracks]);

  const hideLocally = useCallback((id: number) => {
    setHiddenIds((prev) => new Set(prev).add(id));
  }, []);

  const restoreLocally = useCallback((id: number) => {
    setHiddenIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleLinkToTrack = useCallback(
    async (item: UnassignedSetItem, track: TrackSummary) => {
      setBusyId(item.id);
      try {
        const existingSessions = await clientGetTrackSessions(track.id);
        if (isActionError(existingSessions)) {
          toast.error(existingSessions.error);
          return;
        }
        const shouldPromote = !existingSessions.some((s) => s.main);
        const res = await ENTITY_API.session.patch(browserApi, item.id, {
          trackId: track.id,
          main: shouldPromote,
        });
        if (isActionError(res)) {
          toast.error(res.error);
          return;
        }
        hideLocally(item.id);
        router.refresh();
        toastActionResult(
          {
            ok: true,
            message: `Linked "${item.name}" to "${track.title}"`,
            undo: async () => {
              const undone = await ENTITY_API.session.patch(
                browserApi,
                item.id,
                shouldPromote
                  ? { trackId: null, main: false }
                  : { trackId: null }
              );
              if (isActionError(undone)) {
                return { ok: false, message: undone.error };
              }
              restoreLocally(item.id);
              router.refresh();
              return {
                ok: true,
                message: `Unlinked "${item.name}"`,
              };
            },
          },
          feedback.undoWindowMs
        );
      } finally {
        setBusyId(null);
      }
    },
    [feedback.undoWindowMs, hideLocally, restoreLocally, router]
  );

  const handleCreateTrack = useCallback(
    async (item: UnassignedSetItem) => {
      setBusyId(item.id);
      try {
        const title = cleanSetTitle(item.name);
        const created = await ENTITY_API.track.create(browserApi, {
          projectId,
          title,
        });
        if (isActionError(created)) {
          toast.error(created.error);
          return;
        }

        const patched = await ENTITY_API.session.patch(browserApi, item.id, {
          trackId: created.id,
          main: true,
        });
        if (isActionError(patched)) {
          toast.error(patched.error);
          return;
        }

        hideLocally(item.id);
        setTracks(null);
        router.refresh();

        const trackHref = hrefFromParsedRoute(
          { kind: "track", trackId: created.id },
          projectId
        );
        toast.success(`Created "${created.title}" from "${item.name}"`, {
          duration: feedback.undoWindowMs,
          action: {
            label: "Open",
            onClick: () => router.push(trackHref),
          },
          cancel: {
            label: "Undo",
            onClick: () => {
              void (async () => {
                const unlinked = await ENTITY_API.session.patch(
                  browserApi,
                  item.id,
                  { trackId: null, main: false }
                );
                if (isActionError(unlinked)) {
                  toast.error(unlinked.error);
                  return;
                }
                const removed = await ENTITY_API.track.remove(
                  browserApi,
                  created.id
                );
                if (isActionError(removed)) {
                  toast.error(removed.error);
                  return;
                }
                restoreLocally(item.id);
                setTracks((prev) =>
                  prev ? prev.filter((t) => t.id !== created.id) : prev
                );
                router.refresh();
                toast.success(`Reverted "${created.title}"`);
              })();
            },
          },
        });
      } finally {
        setBusyId(null);
      }
    },
    [feedback.undoWindowMs, hideLocally, projectId, restoreLocally, router]
  );

  const handleIgnore = useCallback(
    async (item: UnassignedSetItem) => {
      setBusyId(item.id);
      try {
        const res = await ENTITY_API.session.patch(browserApi, item.id, {
          inboxDismissedAt: new Date().toISOString(),
        });
        if (isActionError(res)) {
          toast.error(res.error);
          return;
        }
        hideLocally(item.id);
        router.refresh();
        toastActionResult(
          {
            ok: true,
            message: `Ignored "${item.name}"`,
            undo: async () => {
              const undone = await ENTITY_API.session.patch(
                browserApi,
                item.id,
                { inboxDismissedAt: null }
              );
              if (isActionError(undone)) {
                return { ok: false, message: undone.error };
              }
              restoreLocally(item.id);
              router.refresh();
              return {
                ok: true,
                message: `Restored "${item.name}"`,
              };
            },
          },
          feedback.undoWindowMs
        );
      } finally {
        setBusyId(null);
      }
    },
    [feedback.undoWindowMs, hideLocally, restoreLocally, router]
  );

  const visible = sessions.filter((s) => !hiddenIds.has(s.id));
  const remainingTotal = Math.max(visible.length, total - hiddenIds.size);

  if (visible.length === 0) return null;

  return (
    <Arrive>
      <section id="unassigned-sets">
        <SectionHead
          count={remainingTotal}
          action={
            remainingTotal > visible.length ? (
              <AppLink
                href={hrefFromParsedRoute({ kind: "session-all" }, projectId)}
                className="text-micro text-ink-soft hover:text-ink"
              >
                View all
              </AppLink>
            ) : undefined
          }
        >
          UNASSIGNED DAW SETS
        </SectionHead>
        <Rows>
          {visible.map((item) => {
            const busy = busyId === item.id;
            const meta = setMetaParts(item, format).join(" · ");
            return (
              <Row key={item.id} className="flex-wrap justify-between gap-y-2">
                <RowMain>
                  <AppLink
                    href={hrefFromParsedRoute(
                      { kind: "session", sessionId: item.id },
                      projectId
                    )}
                    className="block min-w-0"
                  >
                    <RowTitle>{item.name}</RowTitle>
                  </AppLink>
                  {meta && <RowMeta>{meta}</RowMeta>}
                </RowMain>
                <div className="flex shrink-0 items-center gap-1">
                  <LinkSetToTrackPicker
                    projectId={projectId}
                    item={item}
                    tracks={tracks}
                    loadingTracks={loadingTracks}
                    onOpen={() => {
                      void loadTracks();
                    }}
                    onSelectTrack={(track) => {
                      void handleLinkToTrack(item, track);
                    }}
                    disabled={busy}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    onClick={() => {
                      void handleCreateTrack(item);
                    }}
                    className="text-ink-soft hover:text-ink"
                  >
                    <IconPlus size={14} aria-hidden />
                    <span>New track</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    aria-label={`Ignore ${item.name}`}
                    onClick={() => {
                      void handleIgnore(item);
                    }}
                    className="text-ink-soft hover:text-ink"
                  >
                    <IconEyeOff size={14} aria-hidden />
                    <span>Ignore</span>
                  </Button>
                </div>
              </Row>
            );
          })}
        </Rows>
      </section>
    </Arrive>
  );
}
