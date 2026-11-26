import type { DemoSample } from "./demo-set";

/** Every seventh sample, from the fourth, is missing; a short list still gets two. */
const MISSING_EVERY = 7;
const MISSING_FROM = 3;

/** Of every ten samples: two are library, one is outside, seven are project. */
function kindAt(index: number): DemoSample["kind"] {
  const slot = index % 10;
  if (slot === 2 || slot === 7) return "library";
  if (slot === 4) return "outside";
  return "project";
}

/**
 * Gives a curated set's sample paths the spread the demo's screenshots need:
 * mostly `project`, a few `outside`, some `library`, and a handful `missing`
 * with the rest `present`. A library sample is `unknown`, as the producer's
 * machine would judge it, so the missing ones are chosen among the others. A
 * real set's own mix is whatever its author's library made it, so kinds are
 * assigned by position rather than kept. Depends on position only, so curating
 * twice gives the same set.
 */
export function spreadSamples(paths: string[]): DemoSample[] {
  const kinds = paths.map((_, i) => kindAt(i));
  const judged = kinds.flatMap((kind, i) => (kind === "library" ? [] : [i]));
  const missing = new Set<number>();
  for (let i = MISSING_FROM; i < paths.length; i += MISSING_EVERY)
    if (kinds[i] !== "library") missing.add(i);
  for (const i of judged) {
    if (missing.size >= 2) break;
    missing.add(i);
  }
  return paths.map((path, i) => ({
    path,
    kind: kinds[i]!,
    status:
      kinds[i] === "library"
        ? "unknown"
        : missing.has(i)
          ? "missing"
          : "present",
  }));
}
