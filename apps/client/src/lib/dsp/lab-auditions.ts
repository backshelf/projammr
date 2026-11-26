/**
 * Every audition a single toggle turns on or off, as one table: what it's
 * called, whether it's on, and the settings patch that flips it. The
 * palette's `lab ` command, the hotkeys, the desktop card's overflow menu and
 * the Lab's own pills all read this rather than each carrying its own copy
 * of which key means what — adding an audition here is what reaches every
 * surface at once.
 *
 * Bands and the right-channel polarity flip stay out of this table: they are
 * independent multi-selects (any number of bands soloed at once) rather than
 * a single flag or a mutually-exclusive mode, and only the Lab's own pills
 * offer them today.
 */

import type {
  Auditions,
  BandKey,
  DeviceKey,
  LabSettings,
  StereoAudition,
} from "@/lib/dsp/lab-settings";
import {
  DEFAULT_LAB_POLICY,
  normaliseLabel,
  type LabPolicy,
} from "@/lib/policies/lab";

type StereoAuditionKey = Exclude<StereoAudition, "stereo">;
type FlagAuditionKey = "dim" | "crossfeed" | "normalise";

export type LabAuditionKey = StereoAuditionKey | FlagAuditionKey | DeviceKey;

/** Which mutually-exclusive group an audition belongs to, for a surface that
 *  only offers a subset — the pills' stereo and device rows, say. */
type LabAuditionGroup = "stereo" | "device" | "flag";

/** What an audition's name can depend on: the normalise target it names. */
type NamingPolicy = Pick<LabPolicy, "normaliseTargetLufs">;

export type LabAudition = {
  key: LabAuditionKey;
  /** The audition's name under the default Lab policy. */
  label: string;
  /** The audition's name under `policy`; most never change. */
  labelFor: (policy: NamingPolicy) => string;
  group: LabAuditionGroup;
  isOn: (auditions: Auditions) => boolean;
  /** The patch `setAudition` takes to turn this audition on or off. */
  set: (on: boolean) => Partial<Auditions>;
};

/** A fixed name, or one the Lab policy decides. */
type Name = string | ((policy: NamingPolicy) => string);

const naming = (name: Name) =>
  typeof name === "string"
    ? { label: name, labelFor: () => name }
    : { label: name(DEFAULT_LAB_POLICY), labelFor: name };

const stereoAudition = (key: StereoAuditionKey, name: Name): LabAudition => ({
  key,
  ...naming(name),
  group: "stereo",
  isOn: (auditions) => auditions.stereo === key,
  set: (on) => ({ stereo: on ? key : "stereo" }),
});

const deviceAudition = (key: DeviceKey, name: Name): LabAudition => ({
  key,
  ...naming(name),
  group: "device",
  isOn: (auditions) => auditions.device === key,
  set: (on) => ({ device: on ? key : null }),
});

const flagAudition = (key: FlagAuditionKey, name: Name): LabAudition => ({
  key,
  ...naming(name),
  group: "flag",
  isOn: (auditions) => auditions[key],
  set: (on) => ({ [key]: on }) as Partial<Auditions>,
});

/** Every single-toggle audition, in the order a listing reads them. */
export const LAB_AUDITIONS: readonly LabAudition[] = [
  stereoAudition("mono", "Mono"),
  stereoAudition("mid", "Mid"),
  stereoAudition("side", "Side"),
  stereoAudition("left", "Left"),
  stereoAudition("right", "Right"),
  flagAudition("dim", "Dim"),
  flagAudition("crossfeed", "Crossfeed"),
  flagAudition("normalise", (policy) =>
    normaliseLabel(policy.normaliseTargetLufs)
  ),
  deviceAudition("phone", "Phone"),
  deviceAudition("laptop", "Laptop"),
  deviceAudition("earbuds", "Earbuds"),
  deviceAudition("car", "Car"),
  deviceAudition("club", "Club"),
  deviceAudition("radio", "Radio"),
];

/** The band-solo pills' labels, keyed the same way `Auditions.bands` is —
 *  the one place a `BandKey`'s label is decided, since bands are a
 *  multi-select outside {@link LAB_AUDITIONS} but still need a single label
 *  source for the Lab's pills and the bounce name to share. */
export const BAND_LABELS: Record<BandKey, string> = {
  low: "Low",
  lowMid: "Low-mid",
  mid: "Mid",
  highMid: "High-mid",
  air: "Air",
};

const BY_KEY = new Map<LabAuditionKey, LabAudition>(
  LAB_AUDITIONS.map((audition) => [audition.key, audition])
);

/** The registry entry for `key`, or a thrown error for a key not in the table. */
export function labAudition(key: LabAuditionKey): LabAudition {
  const audition = BY_KEY.get(key);
  if (!audition) throw new Error(`Unknown Lab audition: ${key}`);
  return audition;
}

/** Whether `key`'s audition is engaged in `settings`. */
export function labAuditionOn(
  settings: LabSettings,
  key: LabAuditionKey
): boolean {
  return labAudition(key).isOn(settings.auditions);
}

/** The patch that turns `key`'s audition off if it is on, on otherwise. */
export function toggleLabAudition(
  settings: LabSettings,
  key: LabAuditionKey
): Partial<Auditions> {
  const audition = labAudition(key);
  return audition.set(!audition.isOn(settings.auditions));
}
