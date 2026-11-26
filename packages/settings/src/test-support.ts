/**
 * The fields of a definition a test does not care about, spread into a
 * `defineSetting` call beside the ones it does.
 */
export const FIXTURE = {
  label: "Fixture",
  description: "A setting declared by a test.",
  keywords: [],
  control: { kind: "text" },
  audience: "all",
} as const;
