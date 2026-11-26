"use client";

import { useState } from "react";

function shallowEqual(a: object, b: object) {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (key) =>
      Object.hasOwn(b, key) &&
      a[key as keyof typeof a] === b[key as keyof typeof b]
  );
}

/**
 * The last `value` whose own properties all still match, so an object rebuilt
 * on every render out of members that are themselves memoised keeps one
 * identity. A hook that returns a plain object literal is the usual source of
 * one, and without this every memo keyed on what it holds recomputes for a
 * value that never changed.
 *
 * Held in state and synced during render — the previous-value pattern, the same
 * one the tables sync their rows with. React re-runs the caller before
 * committing and without rendering anything below it, so a genuine change costs
 * one more pass through the caller's own body and nothing else.
 */
export function useShallowStable<T extends object>(value: T): T {
  const [held, setHeld] = useState(value);
  if (shallowEqual(held, value)) return held;
  setHeld(value);
  return value;
}
