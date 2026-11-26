"use client";

import { Auditions } from "@/components/lab/Auditions";
import { Bounce } from "@/components/lab/Bounce";
import { MatchEq } from "@/components/lab/MatchEq";
import { RackComp } from "@/components/lab/RackComp";
import { RackEq } from "@/components/lab/RackEq";
import { RackReverb } from "@/components/lab/RackReverb";
import { SpeedPitch } from "@/components/lab/SpeedPitch";
import { useCompare } from "@/components/music-player/player-hooks";
import type { MusicPlayerTrack } from "@/components/music-player/types";
import type { TrackAudioWithAsset } from "@workspace/api/api";
import { SECTION_TITLE } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

/** A section head in the rail's caption shape, over a hairline that separates
 *  it from whatever came before — the Lab's own version of `SectionHead` for
 *  a surface with no room for its full layout. */
function LabSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-rule pt-4 first:border-t-0 first:pt-0">
      <h3 className={SECTION_TITLE}>{title}</h3>
      {children}
    </section>
  );
}

/**
 * The Lab: time and pitch, the rack, how to hear it, and the bounce — the
 * sheet's third pane, in the register the loudness and spectrum blocks set.
 * Settings stay editable whatever the Lab's phase is; only the download and
 * failure copy live inside TIME & PITCH, where the engagement they are about
 * shows up first. An unmatched comparison (a coarse pointer's A/B, played on
 * the elements) never touches the Lab, so every affordance here — which all
 * need it — is hidden rather than left inert while one runs.
 */
export function LabView({
  current,
  audios,
}: {
  current: MusicPlayerTrack | null;
  audios: TrackAudioWithAsset[] | null;
}) {
  const compare = useCompare();

  if (!current) {
    return <p className="shrink-0 text-lead text-ink-soft">Nothing playing</p>;
  }

  if (compare?.unmatched) {
    return (
      <p className="shrink-0 text-lead text-ink-soft">
        Not available while comparing on this device
      </p>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain pt-3 pb-5",
        // Rows scrolling past either edge fade out rather than being cut
        // mid-line against the header or the transport.
        "[mask-image:linear-gradient(to_bottom,transparent,black_0.75rem,black_calc(100%-1.25rem),transparent)]"
      )}
      data-base-ui-swipe-ignore
    >
      <LabSection title="Time & pitch">
        <SpeedPitch />
      </LabSection>

      <LabSection title="Rack">
        <RackEq />
        <RackComp />
        <RackReverb />
      </LabSection>

      <LabSection title="Hear it as">
        <Auditions lufs={current.trackAudio?.lufs ?? null} />
        <MatchEq current={current} audios={audios} />
      </LabSection>

      <LabSection title="Bounce">
        <Bounce current={current} />
      </LabSection>
    </div>
  );
}
