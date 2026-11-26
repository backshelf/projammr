import pkg from "../../package.json" with { type: "json" };

/**
 * The version a build reports: `APP_VERSION` when it is a non-empty string (a
 * release image sets it), otherwise the server's own manifest, so there is one
 * place the number lives when nothing overrides it.
 */
export function readAppVersion(env: NodeJS.ProcessEnv): string {
  const override = env.APP_VERSION;
  return override ? override : pkg.version;
}

/**
 * The version of the server that is running. `GET /api/instance` and
 * `GET /api/health` publish it: an operator comparing their instance against a
 * release needs to know what they are on, and a bug report is unreadable
 * without it.
 */
export const appVersion: string = readAppVersion(process.env);
