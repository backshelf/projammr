"use client";

import { policiesFrom } from "@/lib/policies/from-settings";
import type { LabPolicy } from "@/lib/policies/lab";
import type { PlaybackPolicy } from "@/lib/policies/playback";
import { DEFAULT_POLICIES, type Policies } from "@/lib/policies/policies";
import type { FeedbackPolicy, ShellPolicy } from "@/lib/policies/shell";
import type { VisualsPolicy } from "@/lib/policies/visuals";
import { useSettingsDerived } from "@/lib/settings/provider";
import { createContext, use, type ReactNode } from "react";

/**
 * Starts at the defaults, so a surface with no provider above it (the share
 * page, a component under test) reads each policy's defaults.
 */
const PoliciesContext = createContext<Policies>(DEFAULT_POLICIES);

/**
 * Hands the signed-in shell's policies to everything under it, as one value
 * with one hook per policy. `policies` is the server's build from the
 * viewer's settings; from the first change to the settings on, the policies
 * are built from the settings store, so a write reaches every reader at once.
 */
export function PoliciesProvider({
  policies,
  children,
}: {
  policies: Policies;
  children: ReactNode;
}) {
  const value = useSettingsDerived(policies, policiesFrom);
  return <PoliciesContext value={value}>{children}</PoliciesContext>;
}

export const usePlaybackPolicy = (): PlaybackPolicy =>
  use(PoliciesContext).playback;

export const useLabPolicy = (): LabPolicy => use(PoliciesContext).lab;

export const useVisualsPolicy = (): VisualsPolicy =>
  use(PoliciesContext).visuals;

export const useShellPolicy = (): ShellPolicy => use(PoliciesContext).shell;

export const useFeedbackPolicy = (): FeedbackPolicy =>
  use(PoliciesContext).feedback;
