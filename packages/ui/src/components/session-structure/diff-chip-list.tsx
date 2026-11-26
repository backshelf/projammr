import { keyedByContent } from "@workspace/ui/lib/keyed";
import type { DiffChip, DiffChipKind } from "@workspace/session-diff";
import { cn } from "@workspace/ui/lib/utils";
import {
  IconCursorText,
  IconFileMusic,
  IconFlag,
  IconKey,
  IconLayoutGrid,
  IconLayoutRows,
  IconMetronome,
  IconMusic,
  IconPlug,
  IconVersions,
  IconWaveSine,
} from "@tabler/icons-react";

const GLYPH: Record<DiffChipKind, typeof IconFlag> = {
  first: IconFlag,
  tempo: IconMetronome,
  timeSignature: IconMusic,
  key: IconKey,
  tracks: IconLayoutRows,
  rename: IconCursorText,
  devices: IconPlug,
  clips: IconWaveSine,
  scenes: IconLayoutGrid,
  samples: IconFileMusic,
  dawVersion: IconVersions,
};

/** The colour a chip reads in: additions and removals by direction, a
 *  transition or the set's first save quietly, everything else neutral. */
function chipTone(chip: DiffChip): string {
  if (chip.sign === "add") return "text-art font-medium";
  if (chip.sign === "remove") return "text-ink-faint line-through";
  if (chip.kind === "first") return "text-ink-soft";
  return "text-ink-soft";
}

/**
 * A chip's text, with the `to` half of a transition lit — the label already
 * carries `to` as its own suffix, so the split reuses it rather than
 * re-deriving the phrasing.
 */
function ChipLabel({ chip }: { chip: DiffChip }) {
  if (chip.sign == null && chip.to != null) {
    const prefix = chip.label.slice(0, chip.label.length - chip.to.length);
    return (
      <>
        {prefix}
        <span className="text-ink">{chip.to}</span>
      </>
    );
  }
  return <>{chip.label}</>;
}

/**
 * A diff's chips as an inline, wrapping strip: a glyph and worded text per
 * chip, coloured by direction rather than filled or bordered. `compact` drops
 * the glyphs for tight spaces (the recent-saves feed on a phone).
 */
export function DiffChipList({
  chips,
  compact = false,
}: {
  chips: DiffChip[];
  compact?: boolean;
}) {
  if (chips.length === 0) return null;

  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-micro">
      {keyedByContent(chips, (chip) => `${chip.kind}:${chip.label}`).map(
        ({ key, item: chip }) => {
          const Glyph = GLYPH[chip.kind];
          return (
            <span
              key={key}
              className={cn("inline-flex items-center gap-1", chipTone(chip))}
            >
              {!compact && <Glyph size={12} className="shrink-0" />}
              <ChipLabel chip={chip} />
            </span>
          );
        }
      )}
    </span>
  );
}
