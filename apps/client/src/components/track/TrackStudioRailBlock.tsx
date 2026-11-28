"use client";

import { OpenInDawButton } from "@/components/session/OpenInDawButton";
import { holderOfRepo, type DitHolder } from "@/components/session/open-in-daw";
import { clientGetMyMachines } from "@/lib/client-api";
import { useParamWriter } from "@/hooks/use-param-writer";
import type { GetTrack } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { useFormat } from "@workspace/ui/components/format-provider";
import { RailBlock, RailLabel } from "@workspace/ui/components/layout/rail";
import { MetadataItem } from "@workspace/ui/components/layout/metadata-item";
import { SectionAdd } from "@workspace/ui/components/layout/empty-section";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useState } from "react";

/**
 * The Track Rail's Studio / DAW summary block. Renders from the compact
 * `track.studio` summary at SSR without touching session/save/repo tables;
 * only checks `clientGetMyMachines()` if the main session lives in a dit repo
 * so the 1-click Open in DAW button is live without blocking SSR.
 */
export function TrackStudioRailBlock({
  studio,
}: {
  studio: GetTrack["studio"];
}) {
  const format = useFormat();
  const { write } = useParamWriter({ shallow: true });
  const [holder, setHolder] = useState<DitHolder | null>(null);
  const repoId = studio.mainSession?.repoId ?? null;

  useEffect(() => {
    if (repoId == null) return;
    let cancelled = false;
    void clientGetMyMachines().then((res) => {
      if (cancelled || isActionError(res)) return;
      setHolder(holderOfRepo(res.machines, repoId));
    });
    return () => {
      cancelled = true;
    };
  }, [repoId]);

  const effectiveHolder = repoId == null ? null : holder;

  if (studio.sessionCount === 0 || !studio.mainSession) {
    return null;
  }

  const { mainSession } = studio;
  const dawLabel =
    mainSession.dawVersion ?? mainSession.dawName ?? mainSession.daw;
  const stats = [
    `${studio.sessionCount} ${studio.sessionCount === 1 ? "set" : "sets"}`,
    studio.commitCount > 0
      ? `${studio.commitCount} ${studio.commitCount === 1 ? "commit" : "commits"}`
      : studio.saveCount > 0
        ? `${studio.saveCount} ${studio.saveCount === 1 ? "save" : "saves"}`
        : null,
    studio.lastSaveAt ? `saved ${format.relative(studio.lastSaveAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <RailBlock>
      <RailLabel
        action={
          <OpenInDawButton
            sessionId={mainSession.id}
            holder={effectiveHolder}
            compact
          />
        }
      >
        STUDIO / DAW
      </RailLabel>
      <MetadataItem>
        <span className="flex items-center gap-2">
          {studio.openOn != null && (
            <span
              title={`Open on ${studio.openOn.machine} (${studio.openOn.owner.name})`}
              className="size-1.5 shrink-0 rounded-full bg-art ring-2 ring-art/25"
            />
          )}
          <span className="truncate">
            {mainSession.name}
            {dawLabel ? ` · ${dawLabel}` : ""}
          </span>
        </span>
      </MetadataItem>
      {stats && (
        <p className="text-micro text-ink-soft tabular-nums">{stats}</p>
      )}
      <button
        type="button"
        onClick={() =>
          write({ studio: "overview", session: String(mainSession.id) })
        }
        className={cn(
          "mt-1 inline-flex min-h-7 items-center rounded-sm text-small text-art outline-none hover:underline",
          "focus-visible:ring-2 focus-visible:ring-ring/30 coarse:min-h-11"
        )}
      >
        Inspect DAW &amp; history →
      </button>
    </RailBlock>
  );
}

/** Add-line control when a track has 0 DAW sets (editors only). */
export function TrackStudioEmptyControl() {
  const { write } = useParamWriter({ shallow: true });
  return (
    <SectionAdd onClick={() => write({ studio: "overview" })}>
      DAW set
    </SectionAdd>
  );
}
