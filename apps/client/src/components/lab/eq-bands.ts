/**
 * Which of the EQ's eight fixed band slots are in use, how a band reads as a
 * figure, and where its readout sits beside its handle. Pure, so the Bands
 * list and the curve's readout can be checked without a DOM.
 */

import type { EqBand, EqFilter } from "@/lib/dsp/lab-settings";
import { formatSignedDecimal } from "@workspace/ui/lib/loudness";

/** A band's filter kind as a person reads it. */
const EQ_FILTER_LABELS: Record<EqFilter, string> = {
  off: "Off",
  peaking: "Peaking",
  lowShelf: "Low shelf",
  highShelf: "High shelf",
  lowPass: "Low pass",
  highPass: "High pass",
};

/** The filter options in menu order, shaped for a Base UI `Select`'s
 *  `items`, which is what lets its trigger print a label rather than the raw
 *  value before the popup has ever mounted. */
export const EQ_FILTER_ITEMS = (
  Object.keys(EQ_FILTER_LABELS) as EqFilter[]
).map((value) => ({ value, label: EQ_FILTER_LABELS[value] }));

export const isPassFilter = (kind: EqFilter) =>
  kind === "lowPass" || kind === "highPass";

/** The slots whose filter is on, in slot order. */
export function activeBandIndices(bands: readonly EqBand[]): number[] {
  return bands.flatMap((band, index) => (band.kind === "off" ? [] : [index]));
}

/** The first slot that is off, for "Add band"; null once all eight run. */
export function freeBandIndex(bands: readonly EqBand[]): number | null {
  const index = bands.findIndex((band) => band.kind === "off");
  return index === -1 ? null : index;
}

/** "120 Hz", or "2.5 kHz" from a thousand up. */
export function hzFigure(hz: number): string {
  return hz >= 1000
    ? `${Number((hz / 1000).toFixed(hz >= 10000 ? 1 : 2))} kHz`
    : `${Math.round(hz)} Hz`;
}

/** The handle's readout: frequency, then gain where the filter has one,
 *  then Q. */
export function bandReadout(band: EqBand): string {
  const parts = [hzFigure(band.hz)];
  if (!isPassFilter(band.kind))
    parts.push(`${formatSignedDecimal(band.gainDb)} dB`);
  parts.push(`Q ${band.q.toFixed(1)}`);
  return parts.join(" · ");
}

/**
 * Where a handle's readout sits, from the handle's position in fraction
 * space: above it unless the handle is near the top (a boost), and anchored
 * at whichever side keeps it inside the drawing near either edge.
 */
export function readoutPlacement(position: { x: number; y: number }): {
  vertical: "above" | "below";
  horizontal: "start" | "center" | "end";
} {
  return {
    vertical: position.y < 0.45 ? "below" : "above",
    horizontal:
      position.x < 0.18 ? "start" : position.x > 0.82 ? "end" : "center",
  };
}
