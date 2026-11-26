import { SEEDED_SETTINGS } from "../../lib/instance-policy.js";

/**
 * The `env` layer: values the server's environment seeds for instance keys,
 * keyed by setting key. The resolver places it below every stored scope and
 * above the registry's default, so a seeded key resolves from here (source
 * `env`) until an admin writes an instance row over it, and from here again
 * once that row is cleared. It holds a key only while the variable that seeds
 * it is set: `SEEDED_SETTINGS`, which the instance policy reads from the
 * environment once, at import, through the same mapping it takes every value
 * by.
 *
 * It is a module of its own so that a test can stand in for the environment
 * without replacing the queries that read and write rows.
 */
export function envLayer(): Readonly<Record<string, unknown>> {
  return SEEDED_SETTINGS;
}
