/**
 * `next` with every part that equals the same part of `previous` replaced by that part itself. The app sends the
 * whole view on every change and each arrives as new objects; sharing what did not change lets a row that
 * received the same set again skip rendering (`memo` compares by identity). An array is compared by index.
 */
export function shareStructure<T>(previous: unknown, next: T): T {
  if (
    previous === next ||
    typeof next !== "object" ||
    next === null ||
    typeof previous !== "object" ||
    previous === null ||
    Array.isArray(previous) !== Array.isArray(next)
  ) {
    return next;
  }
  // Both are arrays or both are plain objects, as JSON from the app is: walk them by key.
  const before = previous as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  const merged: Record<string, unknown> | unknown[] = Array.isArray(after)
    ? []
    : {};
  for (const key of keys) {
    (merged as Record<string, unknown>)[key] = shareStructure(
      before[key],
      after[key]
    );
  }
  const same =
    keys.length === Object.keys(before).length &&
    keys.every(
      (key) => (merged as Record<string, unknown>)[key] === before[key]
    );
  return (same ? previous : merged) as T;
}
