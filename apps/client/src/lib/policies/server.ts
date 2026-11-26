import "server-only";
import { policiesFrom } from "@/lib/policies/from-settings";
import type { Policies } from "@/lib/policies/policies";
import { cachedEffectiveSettings } from "@/lib/settings/server";
import { cache } from "react";

// React's `cache` keys on the arguments as passed, so `f()` and `f(undefined)`
// would be two entries; `cachedPolicies` folds both into `null`.
const read = cache(async (projectId: number | null): Promise<Policies> =>
  policiesFrom((await cachedEffectiveSettings(projectId ?? undefined)).values)
);

/**
 * The viewer's policies for this request, built from their effective
 * settings: the value the signed-in shell hands `PoliciesProvider`, and what a
 * server component that lays itself out by a policy (the sidebar, a page's
 * sections, an inventory's defaults) reads for itself, since a server render
 * cannot read the provider's context. A render on a project's route passes
 * the project's id, so the project's layer of the settings applies.
 */
export const cachedPolicies = (projectId?: number): Promise<Policies> =>
  read(projectId ?? null);
