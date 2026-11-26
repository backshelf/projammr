/*
 * The outer bounds of instance settings that something besides the settings
 * is built from: a transport's body cap, Better Auth's own password bounds, a
 * form's fallback rule. The settings' schemas take their ranges from here too,
 * so each number has one definition.
 *
 * This module imports nothing: the web client's `next.config.ts` reads it, and
 * Next loads a config's imports with plain `require`, which cannot follow the
 * `.js` specifiers the rest of this package uses.
 */

/**
 * The largest upload any instance can be set to take, in MiB: the schema
 * maximum of `instance-limits.maxUploadMb`, and the ceiling the API's and the
 * web client's body caps are built at, so that the setting, not the
 * transport, refuses a file, and raising it needs no rebuild.
 */
export const MAX_UPLOAD_CEILING_MB = 2048;

/**
 * The shortest and longest password any instance can require: the range of
 * `instance-access.passwordMin` and `passwordMax`, and the bounds Better Auth
 * is built with, since it copies its own out of its options once. The
 * instance's own rule is checked per request inside them.
 */
export const PASSWORD_LENGTH_FLOOR = 8;
export const PASSWORD_LENGTH_CEILING = 128;
