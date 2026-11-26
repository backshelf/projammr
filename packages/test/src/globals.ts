/**
 * Replaces a global for the rest of a test. `bun:test` has no `stubGlobal`, and
 * several globals Bun defines (`navigator`, `window` under a DOM preload) are
 * accessors a plain assignment cannot overwrite, so the property is redefined
 * and its original descriptor kept for `unstubAllGlobals`.
 */
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();

export function stubGlobal(name: PropertyKey, value: unknown) {
  if (!originals.has(name)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

/** Puts back every global `stubGlobal` replaced, deleting the ones that did not exist. */
export function unstubAllGlobals() {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<PropertyKey, unknown>)[name];
  }
  originals.clear();
}
