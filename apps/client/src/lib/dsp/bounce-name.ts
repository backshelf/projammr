/**
 * A bounce's file name: the track title, the version printed, and every
 * non-default Lab setting — so a listener who saves several bounces of the
 * same track can tell them apart from the file name alone, and one who
 * changed nothing sees a plain name with no parenthetical.
 */

import { BAND_LABELS, LAB_AUDITIONS } from "@/lib/dsp/lab-auditions";
import { DEFAULT_LAB, type LabSettings } from "@/lib/dsp/lab-settings";
import { BOUNCE_EXTENSIONS, type LabPolicy } from "@/lib/policies/lab";

/** What a bounce's name reads from the Lab policy. */
export type BounceNamePolicy = Pick<
  LabPolicy,
  "bounceNameTemplate" | "bounceFormat" | "normaliseTargetLufs"
>;

/** A number with at most two decimals and no trailing zeros: 0.85, 1.5, 2. */
function trimmed(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * The non-default settings, in the Lab's own top-to-bottom order (time and
 * pitch, the rack, then how it's heard) — reusing {@link LAB_AUDITIONS} for
 * every audition it covers, and {@link BAND_LABELS} for a band solo, rather
 * than a second label table for either.
 */
function settingsLabels(
  settings: LabSettings,
  policy: BounceNamePolicy
): string[] {
  const labels: string[] = [];
  if (settings.speed !== DEFAULT_LAB.speed) {
    labels.push(`${trimmed(settings.speed)}×`);
  }
  if (settings.pitch !== DEFAULT_LAB.pitch) {
    labels.push(
      `${settings.pitch > 0 ? "+" : ""}${trimmed(settings.pitch)} st`
    );
  }
  if (settings.rack.eq.on) labels.push("EQ");
  if (settings.rack.comp.on) labels.push("Comp");
  if (settings.rack.reverb.on) labels.push("Reverb");
  for (const audition of LAB_AUDITIONS) {
    if (audition.isOn(settings.auditions)) {
      labels.push(audition.labelFor(policy));
    }
  }
  if (settings.auditions.bands.length > 0) {
    const bands = settings.auditions.bands
      .map((band) => BAND_LABELS[band])
      .join("+");
    labels.push(`${bands} solo`);
  }
  if (settings.auditions.polarityRight) labels.push("Inverted right");
  if (settings.auditions.matchEq) labels.push("Match EQ");
  return labels;
}

const TOKEN = /\{(title|version|settings|details)\}/g;

type Token = "title" | "version" | "settings" | "details";

/**
 * The bounce's attachment name for `title`, the version it prints, and
 * `settings`: the policy's template with its tokens filled in, and the
 * extension of the policy's bounce format.
 */
export function bounceName(
  title: string,
  version: number | undefined,
  settings: LabSettings,
  policy: BounceNamePolicy
): string {
  const printed = version != null ? `v${version}` : "";
  const labels = settingsLabels(settings, policy);
  const parts = [...(printed ? [printed] : []), ...labels];
  const tokens: Record<Token, string> = {
    title,
    version: printed,
    settings: labels.join(", "),
    details: parts.length > 0 ? ` (${parts.join(", ")})` : "",
  };
  const stem = policy.bounceNameTemplate.replace(
    TOKEN,
    (_, token: Token) => tokens[token]
  );
  return `${stem}.${BOUNCE_EXTENSIONS[policy.bounceFormat]}`;
}
