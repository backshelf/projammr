import { useId, type JSX } from "react";
import { Button } from "@workspace/ui/components/button";
import { sectionTitle } from "@workspace/ui/components/layout/section-head";

import { call } from "../bridge";
import { ErrorLine } from "../error-line";
import { NEW_TRACK, type TrackProposal } from "../ipc";
import { useCommand } from "../use-command";

/**
 * "Which track is this?", above the commit box on a set's first commit: the hub's tracks whose titles read like the
 * set's name or its folder's, best first, then a new track named for the folder. One press answers; the app clears
 * the proposal when the set's session has a track.
 */
export function TrackProposalCard({
  set,
  proposal,
}: {
  /** The set file's path. */
  set: string;
  proposal: TrackProposal;
}): JSX.Element {
  const headingId = useId();
  const { run, pending, error } = useCommand();

  function pick(track: string): void {
    void run(() => call("propose_track", { set, track }));
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className={sectionTitle()}>
        Which track is this?
      </h2>
      <div className="flex flex-wrap gap-1.5">
        {proposal.choices.map((choice) => (
          <Button
            key={choice.track}
            variant="outline"
            disabled={pending}
            onClick={() => pick(choice.track)}
          >
            {choice.label}
          </Button>
        ))}
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => pick(NEW_TRACK)}
        >
          New track: {proposal.newTrack}
        </Button>
      </div>
      <ErrorLine error={error} />
    </section>
  );
}
