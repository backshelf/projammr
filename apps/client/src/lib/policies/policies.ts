/**
 * Every policy the signed-in shell hands down, as the one value
 * `PoliciesProvider` carries, and that value at its defaults. Kept apart from
 * the provider, which is a client module, so a server layout can import the
 * defaults as a value rather than as a client reference.
 */

import { DEFAULT_LAB_POLICY, type LabPolicy } from "@/lib/policies/lab";
import { DEFAULT_PLAYBACK, type PlaybackPolicy } from "@/lib/policies/playback";
import {
  DEFAULT_FEEDBACK,
  DEFAULT_SHELL,
  type FeedbackPolicy,
  type ShellPolicy,
} from "@/lib/policies/shell";
import { DEFAULT_VISUALS, type VisualsPolicy } from "@/lib/policies/visuals";

export type Policies = {
  playback: PlaybackPolicy;
  lab: LabPolicy;
  visuals: VisualsPolicy;
  shell: ShellPolicy;
  feedback: FeedbackPolicy;
};

export const DEFAULT_POLICIES: Policies = {
  playback: DEFAULT_PLAYBACK,
  lab: DEFAULT_LAB_POLICY,
  visuals: DEFAULT_VISUALS,
  shell: DEFAULT_SHELL,
  feedback: DEFAULT_FEEDBACK,
};
