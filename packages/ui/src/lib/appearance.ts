import {
  APPEARANCE,
  type AppearanceKey,
  type AppearanceValue,
} from "@workspace/settings/appearance";
import { useMemo, useSyncExternalStore } from "react";

export {
  APPEARANCE,
  ART_FALLBACK_PROPERTY,
  type AppearanceKey,
  type AppearanceValue,
} from "@workspace/settings/appearance";

const ATTRIBUTES = Object.values(APPEARANCE).map((entry) => entry.attribute);

function isValue<K extends AppearanceKey>(
  key: K,
  value: string | null
): value is AppearanceValue<K> {
  return (APPEARANCE[key].values as readonly (string | null)[]).includes(value);
}

/**
 * The value `<html>` carries for one preference, for code outside React. The
 * default wherever there is no document (the server) or the attribute is
 * absent or not one of the preference's values.
 */
export function readAppearance<K extends AppearanceKey>(
  key: K
): AppearanceValue<K> {
  const value =
    typeof document === "undefined"
      ? null
      : document.documentElement.getAttribute(APPEARANCE[key].attribute);
  return isValue(key, value) ? value : APPEARANCE[key].default;
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ATTRIBUTES,
  });
  return () => observer.disconnect();
}

/**
 * One preference as `<html>` carries it, following the attribute live. The
 * stylesheet already answers every attribute on its own; this is for the rare
 * decision a stylesheet cannot make, such as the transition Motion picks or a
 * virtualiser's row estimate.
 *
 * The first client render reads the document too, as Motion's own
 * `useReducedMotion` reads the OS: none of its callers renders markup from
 * the answer, so the hydration pass can already carry the right one.
 */
export function useAppearance<K extends AppearanceKey>(
  key: K
): AppearanceValue<K> {
  const read = () => readAppearance(key);
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * The factor the token layer scales row padding by for one density: 1 at the
 * default, which is today's padding; any other value's factor is read from the
 * stylesheet's `--density` rather than restated here.
 */
function densityFactor(density: AppearanceValue<"density">): number {
  if (density === APPEARANCE.density.default || typeof document === "undefined")
    return 1;
  const factor = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--density")
  );
  return Number.isFinite(factor) ? factor : 1;
}

/**
 * `--density` as a number, for layout maths a stylesheet cannot do, such as a
 * virtualiser's first guess at a row's height. Read once per change of
 * `data-density`, not once per render.
 */
export function useDensity(): number {
  const density = useAppearance("density");
  return useMemo(() => densityFactor(density), [density]);
}
