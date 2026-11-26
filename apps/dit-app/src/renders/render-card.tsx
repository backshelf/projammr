import { Fragment, memo, type JSX } from "react";
import {
  IconCheck,
  IconClockPause,
  IconPlayerPause,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { useFormat } from "@workspace/ui/components/format-provider";
import { IconButton } from "@workspace/ui/components/icon-button";
import { Progress } from "@workspace/ui/components/progress";
import { cn } from "@workspace/ui/lib/utils";

import { ErrorLine } from "../error-line";
import type { RenderCard } from "../ipc";
import { NotThisSet } from "./not-this-set";
import { toggleAudition, usePreviewOf } from "./preview";
import {
  factsOf,
  folderOf,
  isDecidable,
  isPair,
  mainFile,
  namesOf,
  percentOf,
  reasonsOf,
} from "./render-model";

/** What the person can decide on a card; the list runs each against the app. */
export type CardDecision =
  | { kind: "accept"; session?: number }
  | { kind: "reject"; mode: "not-a-bounce" | "never-here" };

/** The id a card's option element carries. */
function optionId(id: number): string {
  return `render-card-${id}`;
}

/**
 * One render waiting on the person or on the hub, as one component over the card's state: proposed (the file, why
 * it was offered and the four decisions), over the size limit (the same with "Add anyway"), uploading (a progress
 * line where the decisions were), queued (offline, to upload when the hub is back) and added. Every state has the
 * play control; a pair of formats is one card that names both files and the one it uploads. The element is an
 * option of the list's listbox, which owns the keys.
 */
export const RenderCardView = memo(function RenderCardView({
  card,
  active,
  busy,
  error,
  onCursor,
  onDecide,
}: {
  card: RenderCard;
  /** Whether the list's cursor is on this card. */
  active: boolean;
  /** Whether a decision on this card is in flight. */
  busy: boolean;
  /** The app's refusal of the last decision on this card. */
  error: string | null;
  onCursor: (id: number) => void;
  onDecide: (card: RenderCard, decision: CardDecision) => void;
}): JSX.Element {
  const format = useFormat();
  const main = mainFile(card);
  const path = main?.path ?? null;
  const preview = usePreviewOf(path);
  const names = namesOf(card);
  const folder = path === null ? "" : folderOf(path);
  const facts = factsOf(card, format, preview?.length);
  const reasons = reasonsOf(card, format);
  const decidable = isDecidable(card);

  return (
    <div
      id={optionId(card.id)}
      role="option"
      aria-selected={active}
      aria-label={names}
      tabIndex={active ? 0 : -1}
      data-render={card.id}
      data-state={card.state}
      data-cursor={active || undefined}
      onClick={() => onCursor(card.id)}
      className={cn(
        "relative -mx-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-t border-rule px-4 py-3 motion-ink outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset",
        active && "bg-[color-mix(in_oklab,var(--ink)_6%,transparent)]"
      )}
    >
      {/* The cursor's mark: a hairline of the set's accent at the card's edge. */}
      {active && (
        <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-art" />
      )}

      <IconButton
        variant="play"
        disabled={path === null}
        aria-label={preview?.playing ? `Pause ${names}` : `Play ${names}`}
        onClick={(event) => {
          event.stopPropagation();
          onCursor(card.id);
          if (path !== null) void toggleAudition(path);
        }}
        className={cn("mt-px", preview?.playing && "text-art")}
      >
        {preview?.playing ? <IconPlayerPause /> : <IconPlayerPlay />}
      </IconButton>

      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-body/snug [overflow-wrap:anywhere] text-ink">
          {names}
        </p>
        {folder !== "" && (
          <p className="text-small/snug [overflow-wrap:anywhere] text-ink-faint">
            {folder}
          </p>
        )}
        {(facts.length > 0 || preview) && (
          <p className="flex flex-wrap items-baseline gap-x-2 text-small/snug text-ink-soft">
            {facts.map((fact, index) => (
              <Fragment key={fact}>
                {index > 0 && (
                  <span aria-hidden className="text-ink-faint">
                    {"\u00b7"}
                  </span>
                )}
                <span className="tabular-nums">{fact}</span>
              </Fragment>
            ))}
            {preview && (
              <span className="font-mono text-micro text-art tabular-nums">
                {format.timecode(preview.at * 1000)} /{" "}
                {format.timecode(preview.length * 1000)}
              </span>
            )}
          </p>
        )}
        {decidable && (reasons.length > 0 || card.set !== null) && (
          <p className="text-small/snug text-pretty text-ink-soft">
            {card.set !== null && (
              <span className="text-ink">
                {card.set}
                {reasons.length > 0 ? " \u00b7 " : ""}
              </span>
            )}
            {reasons.join(" \u00b7 ")}
          </p>
        )}
        {card.state === "proposed" && isPair(card) && (
          <p className="text-small/snug text-pretty text-ink-faint">
            Only the largest file under your size limit is uploaded.
          </p>
        )}
        <StateLine card={card} />
        {card.message !== null && card.state !== "added" && (
          <p
            role="status"
            className="text-small/snug text-pretty text-ink-soft"
          >
            {card.message}
          </p>
        )}
        {decidable && (
          <Decisions
            card={card}
            busy={busy}
            onDecide={(decision) => onDecide(card, decision)}
          />
        )}
        <ErrorLine error={error} />
      </div>
    </div>
  );
});

/** What the card says of where it stands, below its facts: nothing while it waits on a decision. */
function StateLine({ card }: { card: RenderCard }): JSX.Element | null {
  const format = useFormat();
  switch (card.state) {
    case "uploading": {
      const percent = percentOf(card.progress);
      return (
        <div className="flex flex-col gap-1.5 pt-1">
          <Progress
            value={percent}
            aria-label="Upload progress"
            aria-valuenow={percent}
            indicatorClassName="bg-art"
          />
          <p className="text-micro text-ink-soft tabular-nums">
            {card.progress
              ? `Uploading ${format.bytes(card.progress.sent)} of ${format.bytes(card.progress.total)}`
              : "Uploading\u2026"}
          </p>
        </div>
      );
    }
    case "queued-offline":
      return (
        <p className="flex items-center gap-1.5 text-small/snug text-ink-soft">
          <IconClockPause aria-hidden className="size-3.5 shrink-0" />
          <span>
            <span className="text-ink">Queued</span>
            {" \u00b7 uploads when dit can reach the hub"}
          </span>
        </p>
      );
    case "added":
      return (
        <p className="flex items-center gap-1.5 text-small/snug text-ink">
          <IconCheck aria-hidden className="size-3.5 shrink-0 text-art" />
          <span>
            Added as version
            {card.set !== null && (
              <span className="text-ink-soft"> to {card.set}</span>
            )}
          </span>
        </p>
      );
    case "over-limit":
      return <p className="text-small/snug text-ink">Over your size limit</p>;
    case "proposed":
    case "waiting":
      return null;
  }
}

/** The four decisions of a card waiting on one; the first is "Add anyway" past the size limit. */
function Decisions({
  card,
  busy,
  onDecide,
}: {
  card: RenderCard;
  busy: boolean;
  onDecide: (decision: CardDecision) => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 pt-1">
      <div className="flex items-center gap-1">
        <Button
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onDecide({ kind: "accept" });
          }}
        >
          {card.state === "over-limit" ? "Add anyway" : "Add as version"}
        </Button>
        <NotThisSet
          sets={card.otherSets}
          disabled={busy}
          onPick={(session) => onDecide({ kind: "accept", session })}
        />
      </div>
      <div className="-ml-2 flex items-center gap-1">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onDecide({ kind: "reject", mode: "not-a-bounce" });
          }}
        >
          Not a bounce
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onDecide({ kind: "reject", mode: "never-here" });
          }}
        >
          Never here
        </Button>
      </div>
    </div>
  );
}
