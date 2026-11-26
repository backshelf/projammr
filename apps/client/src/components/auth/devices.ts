/**
 * A signed-in session as `authClient.listSessions()` returns it. The shared
 * auth client is built with no `<typeof auth>` binding (it also serves the
 * other clients, against whichever server it points at), so `deviceName` — a
 * `session.additionalFields` entry the server always sends — is read off the
 * response structurally rather than through the client's own inferred type.
 */
export type DeviceSession = {
  id: string;
  token: string;
  updatedAt: string | Date;
  userAgent?: string | null;
  deviceName?: string | null;
};

/**
 * What a signed-in-devices list calls a session: the device name it gave
 * itself at sign-in when it has one (how a client's token is told apart from
 * a generic User-Agent string), otherwise a browser/OS guess parsed from the
 * User-Agent, otherwise "Unknown device".
 */
export function describeDevice(session: DeviceSession): string {
  if (session.deviceName) return session.deviceName;

  const ua = session.userAgent;
  if (!ua) return "Unknown device";

  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";

  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : null;

  return os ? `${browser} on ${os}` : browser;
}

/** Most recently active first, so the device someone is looking at leads. */
export function sortByLastActive<T extends { updatedAt: string | Date }>(
  sessions: T[]
): T[] {
  return [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/** The one method `revokeDeviceSession` needs from the auth client, so a test
 *  can hand it a fake without building a whole `authClient`. */
type RevokesSessions = {
  revokeSession: (body: { token: string }) => Promise<{
    error: { message?: string } | null;
  }>;
};

/**
 * Signs one device out, for a "Sign out" action in a devices list.
 * `authClient.revokeSession` itself is fire-and-forget from the caller's
 * point of view (it resolves `{data, error}` rather than throwing); this
 * turns that into the plain success/failure shape a toast reads from.
 */
export async function revokeDeviceSession(
  token: string,
  client: RevokesSessions
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await client.revokeSession({ token });
  if (error) {
    return {
      ok: false,
      message: error.message ?? "Failed to sign out that device",
    };
  }
  return { ok: true };
}
