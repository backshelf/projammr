import { toast } from "sonner";

const toastIds = new WeakMap<object, string>();
let nextToastId = 0;

/** One id per refusal object; a failure that is not an object gets a fresh one. */
function toastIdFor(failure: unknown): string {
  const id = `settings-refused-${nextToastId++}`;
  if (typeof failure !== "object" || failure === null) return id;
  const known = toastIds.get(failure);
  if (known) return known;
  toastIds.set(failure, id);
  return id;
}

/**
 * Tells the viewer a setting they changed outside the hub (the theme, a
 * sidebar fold, a strip) did not save. The settings store has already put
 * the old value back. Every caller of one refused batch receives the same
 * failure, so the toast id keys on it and sonner shows a single toast.
 */
export function toastRefusedWrite(failure: unknown): void {
  toast.error(
    failure instanceof Error ? failure.message : "Couldn't save the setting",
    { id: toastIdFor(failure) }
  );
}
