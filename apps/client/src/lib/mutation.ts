"use client";

import { isActionError } from "@workspace/api/lib/action-result";

declare const MUTATION: unique symbol;

/** `route` is this route's server components. Any other key names a list held in client state. */
export type InvalidationKey = "route" | "collection-tracks" | "machines";
type StoreKey = Exclude<InvalidationKey, "route">;

/** A mutation that has not run. Only `applyMutation` unwraps it, and it always applies `invalidates`. */
export type Mutation<T> = {
  readonly [MUTATION]: true;
  run: () => Promise<T>;
  invalidates: readonly InvalidationKey[];
};

export const defineMutation = <T>(
  run: () => Promise<T>,
  invalidates: readonly InvalidationKey[]
): Mutation<T> => ({ run, invalidates }) as Mutation<T>;

const listeners = new Map<StoreKey, Set<() => void>>();

/** Subscribes a client-held list to a key; returns the unsubscribe. */
export const onInvalidated = (
  key: StoreKey,
  listener: () => void
): (() => void) => {
  const set = listeners.get(key) ?? new Set();
  listeners.set(key, set);
  set.add(listener);
  return () => set.delete(listener);
};

/** The part of a router `applyMutation` needs to refresh the route. */
export type MutationRouter = { refresh: () => void };

/** Runs a mutation and, only when it succeeded, invalidates what it declared. */
export const applyMutation = async <T>(
  mutation: Mutation<T>,
  router: MutationRouter
): Promise<T> => {
  const result = await mutation.run();
  if (isActionError(result)) return result;
  for (const key of mutation.invalidates) {
    if (key === "route") router.refresh();
    else listeners.get(key)?.forEach((listener) => listener());
  }
  return result;
};
