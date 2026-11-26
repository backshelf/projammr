import {
  DEFAULT_INSTANCE_POLICY,
  type InstancePolicy,
  refreshInstancePolicy,
} from "../lib/instance-policy.js";

/** Some of a policy's values, group by group; everything left out keeps its default. */
export type InstancePolicyPatch = {
  [Group in keyof InstancePolicy]?: Partial<InstancePolicy[Group]>;
};

/**
 * Runs the server under the default policy with `patch` laid over it, through
 * the same `refreshInstancePolicy` a settings change uses. Pair it with
 * {@link restoreInstancePolicy} in an `afterEach`, so no case leaves its
 * snapshot behind for the next.
 */
export function stubInstancePolicy(patch: InstancePolicyPatch): InstancePolicy {
  const base = DEFAULT_INSTANCE_POLICY;
  return refreshInstancePolicy({
    access: { ...base.access, ...patch.access },
    limits: { ...base.limits, ...patch.limits },
    jobs: { ...base.jobs, ...patch.jobs },
    integrations: { ...base.integrations, ...patch.integrations },
    rateLimits: { ...base.rateLimits, ...patch.rateLimits },
  });
}

/** Puts the default policy back. */
export function restoreInstancePolicy(): void {
  refreshInstancePolicy(DEFAULT_INSTANCE_POLICY);
}
