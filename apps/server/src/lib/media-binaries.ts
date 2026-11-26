/**
 * Path to the external media tool the server shells out to.
 *
 * Local development uses the copy built into `apps/server/deps`; other
 * deployments install it system-wide and set this variable to the bare
 * command name so it resolves on PATH.
 */
export const FFMPEG_PATH =
  process.env.FFMPEG_PATH ?? "./deps/ffmpeg/bin/ffmpeg";
