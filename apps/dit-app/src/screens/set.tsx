import { useMemo, type JSX } from "react";
import { artVarsFromAccent } from "@workspace/ui/lib/art";

import { artUrl, type OpenSet, type Snapshot } from "../ipc";
import { CommitBox } from "../set/commit-box";
import { NothingToCommit } from "../set/last-commit";
import { SavesList } from "../set/saves-list";
import { RenderBand } from "../renders/render-list";
import { SetMasthead } from "../set/set-masthead";
import { SkylineReadout } from "../set/skyline-readout";
import { skylineStructure } from "../set/skyline-model";
import { StatusLines } from "../set/status-lines";
import { liveLines, pushLines } from "../set/status-model";
import { TrackProposalCard } from "../set/track-proposal";

/** The width the cover is asked for: the band is 400px, so double that keeps it sharp on a Retina screen. */
const ART_WIDTH = 800;

/**
 * The open set, top to bottom as a commit runs: the masthead lit by the track's cover, the skyline with the tracks
 * changed since the last commit lit, the commit box (or "Nothing to commit" and the last commit), then the saves.
 * The set's accent, the cover's, is set here so every `text-art` below reads it.
 */
export function SetScreen({
  snapshot,
  open,
  flushTop = true,
}: {
  snapshot: Snapshot;
  open: OpenSet;
  flushTop?: boolean;
}): JSX.Element {
  const { artwork, headMeta, latestMeta, liveTracks, tracksChanged } = snapshot;
  const artVars = useMemo(
    () =>
      artVarsFromAccent(
        artwork?.accentHue,
        artwork?.accentChroma,
        artwork ? artUrl(artwork.assetPath, ART_WIDTH) : null
      ),
    [artwork]
  );
  const structure = useMemo(
    () =>
      skylineStructure({
        head: headMeta,
        latest: latestMeta,
        live: liveTracks,
        changed: tracksChanged,
      }),
    [headMeta, latestMeta, liveTracks, tracksChanged]
  );

  return (
    <div style={artVars} className="flex flex-col gap-4">
      <SetMasthead
        open={open}
        hasArtwork={artwork !== null}
        timeSinceCommit={snapshot.timeSinceCommit}
        flushTop={flushTop}
      />
      {structure && (
        <SkylineReadout
          structure={structure}
          committed={snapshot.lastCommit !== null}
        />
      )}
      <StatusLines lines={liveLines(snapshot)} />
      {snapshot.trackProposal && (
        <TrackProposalCard set={open.path} proposal={snapshot.trackProposal} />
      )}
      {snapshot.saves.length > 0 ? (
        <CommitBox
          key={`${open.path}:${snapshot.lastCommit?.at ?? ""}`}
          set={open.path}
          clauses={snapshot.clauses}
          appDraft={snapshot.draft}
          firstCommit={snapshot.firstCommit}
        />
      ) : (
        <NothingToCommit lastCommit={snapshot.lastCommit} />
      )}
      <StatusLines lines={pushLines(snapshot)} />
      {snapshot.saves.length > 0 && (
        <SavesList
          saves={snapshot.saves}
          headMeta={headMeta}
          lastCommit={snapshot.lastCommit}
        />
      )}
      <RenderBand cards={snapshot.renders} />
    </div>
  );
}
