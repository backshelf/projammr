import "dotenv/config";

import addressparser from "nodemailer/lib/addressparser";
import type { MasterKeys } from "./notes-crypto.js";
import { parseStorageConfig, type StorageConfig } from "./storage/types.js";

/**
 * Origins are matched against the browser's `Origin` header by exact string,
 * and the browser lowercases the host it sends. A host written with capitals
 * here — an mDNS name like `MyMachine.local` is the usual way this happens —
 * would therefore never match, so the case is normalised away.
 */
function parseOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Origins allowed to make credentialed calls to this API. The same list feeds
 * Hono's CORS and Better Auth's `trustedOrigins`, so the two cannot disagree.
 * `CLIENT_URL` is honoured as a fallback for deployments that only ever had a
 * single web client.
 */
export const trustedOrigins: string[] = (() => {
  const configured = parseOrigins(process.env.TRUSTED_ORIGINS);
  if (configured.length > 0) return configured;

  const clientUrl = parseOrigins(process.env.CLIENT_URL);
  if (clientUrl.length > 0) return clientUrl;

  return ["http://localhost:3000"];
})();

/**
 * The key Better Auth signs session cookies with. Left unset, Better Auth
 * generates one per boot and every restart silently signs every user out, so
 * the process refuses to start instead.
 */
export const betterAuthSecret: string = (() => {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is not set. Generate one with `openssl rand -base64 32`."
    );
  }
  return secret;
})();

/**
 * The browser-facing origin Better Auth is served from. The OAuth issuer, its
 * JWKS URL and the MCP resource all derive from it, so it cannot be left for
 * Better Auth to infer per request. Development serves the API through the
 * Next rewrite, so the default is the client's origin.
 */
export const betterAuthUrl: string =
  process.env.BETTER_AUTH_URL || "http://localhost:3000";

/** The canonical MCP resource URI, the audience every access token is bound to. */
export const mcpResource: string = new URL("/api/mcp", betterAuthUrl).href;

/**
 * Whether the MCP OAuth provider can run. Its plugin refuses a resource that is
 * neither HTTPS nor a loopback host and throws at construction, so a plain-HTTP
 * LAN address in `BETTER_AUTH_URL` turns MCP off rather than stopping the
 * server. Same rule as `@better-auth/mcp`'s resource validation.
 *
 * `MCP_DISABLED=1` turns it off outright. The typegen script sets it: the
 * provider seeds its resource row from the database as soon as Better Auth is
 * constructed, and typegen runs where there is no database. The MCP route is
 * not in the OpenAPI document, so the generated types are the same either way.
 */
export const mcpEnabled: boolean = (() => {
  if (process.env.MCP_DISABLED === "1") return false;
  const { protocol, hostname } = new URL(mcpResource);
  if (protocol === "https:") return true;
  const octets = hostname.split(".");
  const ipv4Loopback =
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d+$/.test(octet) && Number(octet) <= 255);
  return (
    protocol === "http:" &&
    (hostname === "localhost" || hostname === "[::1]" || ipv4Loopback)
  );
})();

/**
 * The root of every note's key hierarchy. Notes are encrypted at rest under
 * keys derived from this one, so it must outlive every note: losing it with
 * no {@link notesMasterKeyPrevious} set makes every note unreadable.
 */
const notesMasterKey: Buffer = (() => {
  const raw = process.env.NOTES_MASTER_KEY;
  const key = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (key.length !== 32) {
    throw new Error(
      "NOTES_MASTER_KEY must be 32 bytes, base64-encoded. Generate one with `openssl rand -base64 32`."
    );
  }
  return key;
})();

/**
 * The previous root key, set only while a rotation
 * (`scripts/rotate-notes-key.ts`) is in flight: `NOTES_MASTER_KEY` is the new
 * key, this is the one every note was wrapped under before the rotation
 * started. A note the rotation has not reached yet still reads under it;
 * once every row is on the current {@link notesKeyVersion} this can be unset.
 */
const notesMasterKeyPrevious: Buffer | null = (() => {
  const raw = process.env.NOTES_MASTER_KEY_PREVIOUS;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "NOTES_MASTER_KEY_PREVIOUS must be 32 bytes, base64-encoded. Generate one with `openssl rand -base64 32`."
    );
  }
  return key;
})();

/**
 * The version `NOTES_MASTER_KEY` is tagged with on every note it wraps, from
 * `NOTES_KEY_VERSION` (default 1). Raised by one per key rotation and left at
 * that value afterwards. The `notes.key_version` column is a smallint, so
 * that is the range accepted.
 */
const notesKeyVersion: number = (() => {
  const raw = process.env.NOTES_KEY_VERSION;
  if (!raw) return 1;
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1 || version > 32767) {
    throw new Error(
      `NOTES_KEY_VERSION must be a whole number from 1 to 32767, got "${raw}".`
    );
  }
  return version;
})();

/** The keys and version {@link unwrap} and {@link rewrap} need to read a note wrapped under either key version. */
export const notesMasterKeys: MasterKeys = {
  current: notesMasterKey,
  previous: notesMasterKeyPrevious,
  version: notesKeyVersion,
};

/**
 * How many trusted reverse proxies sit in front of this server and append to
 * `X-Forwarded-For`: 1 in compose (Caddy, the only ingress, which proxies
 * `/api/*` straight to this service), 0 anywhere else. `clientAddress` (`lib/client-address.ts`) reads this many entries in
 * from the right of the header; at 0 the header is ignored outright rather
 * than partially trusted, since a caller in front of the untrusted part of
 * the chain could otherwise pick its own claimed address.
 */
export const trustedProxyHops: number = (() => {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (!raw) return 0;
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error("TRUSTED_PROXY_HOPS must be a non-negative integer.");
  }
  return hops;
})();

/**
 * Whether this deployment is reachable through a publicly trusted
 * certificate (Caddy's `TLS_MODE=acme`), as opposed to its local, self-signed
 * CA (`tls internal`) that a LAN deployment uses. HSTS is safe only in the
 * former: a browser that remembers HSTS for a host whose certificate
 * authority nobody outside the LAN trusts can be locked out of the site the
 * next time that CA changes. Unset — outside Docker, or `TLS_MODE=internal`
 * — means not public.
 */
export const publicTlsMode: boolean = process.env.TLS_MODE === "acme";

/**
 * The transport `lib/mail.ts` sends through, or null when this instance sends
 * no mail. A bare connection string (`smtps://user:pass@host:465`) for a real
 * deployment; the test suite points it at the sentinel `lib/mail.ts` reads as
 * "build a `jsonTransport` instead of dialing anything."
 */
export const smtpUrl: string | null = process.env.SMTP_URL || null;

/**
 * Whether this instance can send mail at all. Every mail-dependent path —
 * password reset by request (as opposed to an admin-issued link), required
 * email verification, a mailed change-email or delete-account confirmation,
 * invite delivery — checks this and hides or changes its behaviour rather
 * than failing at send time.
 */
export const emailEnabled: boolean = smtpUrl != null;

/**
 * Pulls the address out of a `MAIL_FROM` value, accepting both a bare
 * `addr@x` and a `Name <addr@x>` form. The display name, if the value
 * carries one, is discarded here — `lib/mail.ts`'s `sendMail` supplies its
 * own, read from `instance-branding.mailSenderName` on every send. Returns
 * `null` when nothing parses.
 */
export function parseMailFromAddress(value: string): string | null {
  const [parsed] = addressparser(value);
  if (!parsed || !("address" in parsed) || !parsed.address) return null;
  return parsed.address;
}

/**
 * The address every outgoing mail's `From` header carries. Required as soon
 * as {@link smtpUrl} is set — mail with no return address is not a real
 * deployment — and meaningless without it. The one reader is
 * `lib/mail.ts`'s `sendMail`, which pairs it with the display name read
 * fresh from the instance's branding on every send.
 */
export const mailFromAddress: string | null = (() => {
  if (!smtpUrl) return null;
  const from = process.env.MAIL_FROM;
  if (!from) {
    throw new Error("MAIL_FROM must be set when SMTP_URL is configured.");
  }
  const address = parseMailFromAddress(from);
  if (!address) {
    throw new Error(`MAIL_FROM does not contain a valid address: ${from}`);
  }
  return address;
})();

/**
 * Which blob store the server uses (`local` or `s3`) and, when `s3`, its
 * bucket, credentials, optional endpoint/prefix and region. Validated at boot
 * so a misconfigured deployment refuses to start instead of failing on the
 * first upload.
 */
export const storageConfig: StorageConfig = parseStorageConfig(process.env);
