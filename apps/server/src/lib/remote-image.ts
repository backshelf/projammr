import { HTTPException } from "hono/http-exception";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { basename } from "node:path";
import sharp from "sharp";
import { instancePolicy, uploadLimitBytes } from "./instance-policy.js";

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 15_000;

const SHARP_FORMAT_MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
};

const MIME_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type HostLookup = (hostname: string) => Promise<string[]>;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

type FetchRemoteImageOptions = {
  maxBytes?: number;
  allowedTypes?: readonly string[];
  timeoutMs?: number;
  fetch?: FetchLike;
  lookup?: HostLookup;
};

type FetchedRemoteImage = {
  kind: "bytes";
  bytes: Uint8Array;
  name: string;
  type: string;
};

function isPrivateIpv4Octets(a: number, b: number, c: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / Tailscale
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums as [number, number, number, number];
}

function parseIpv6Groups(raw: string): number[] | null {
  const withoutZone = raw.split("%")[0] ?? raw;
  const halves = withoutZone.split("::");
  if (halves.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const tokens = side.split(":");
    const groups: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (token.includes(".")) {
        if (i !== tokens.length - 1) return null;
        const v4 = parseIpv4(token);
        if (!v4) return null;
        groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
        groups.push(parseInt(token, 16));
      }
    }
    return groups;
  };

  const left = parseSide(halves[0]!);
  if (!left) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;

  const right = parseSide(halves[1]!);
  if (!right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

/**
 * Whether an IPv4 or IPv6 literal falls in a non-public range (loopback,
 * RFC 1918, CGNAT/Tailscale, link-local, metadata, ULA, multicast, or an
 * IPv4-mapped / 6to4 / NAT64 address wrapping one).
 */
export function isPrivateIp(address: string): boolean {
  const stripped = address.replace(/^\[|\]$/g, "");
  const version = isIP(stripped);
  if (version === 4) {
    const octets = parseIpv4(stripped);
    return !octets || isPrivateIpv4Octets(octets[0], octets[1], octets[2]);
  }
  if (version === 6) {
    const g = parseIpv6Groups(stripped);
    if (!g) return true;
    const allZero = g.every((n) => n === 0);
    if (allZero) return true; // ::
    const isLoopback = g.slice(0, 7).every((n) => n === 0) && g[7] === 1;
    if (isLoopback) return true; // ::1
    const isIpv4Mapped = g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff;
    if (isIpv4Mapped) {
      return isPrivateIpv4Octets(g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8);
    }
    // 6to4 embeds IPv4 in groups 1 and 2.
    if (g[0] === 0x2002) {
      return isPrivateIpv4Octets(g[1]! >> 8, g[1]! & 0xff, g[2]! >> 8);
    }
    // NAT64 well-known / local-use prefixes.
    if (g[0] === 0x0064 && g[1] === 0xff9b) return true;
    // Discard-only 100::/64.
    if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;
    // Documentation 2001:db8::/32.
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true;
    // Unique local fc00::/7.
    if ((g[0]! & 0xfe00) === 0xfc00) return true;
    // Link-local fe80::/10.
    if ((g[0]! & 0xffc0) === 0xfe80) return true;
    // Multicast ff00::/8.
    if ((g[0]! & 0xff00) === 0xff00) return true;
    return false;
  }
  return true;
}

const defaultLookup: HostLookup = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true });
  return records.map((record) => record.address);
};

async function assertPublicUrl(raw: string, lookup: HostLookup): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HTTPException(400, { message: "Invalid image URL" });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new HTTPException(400, {
      message: "Image URL must use http or https",
    });
  }
  if (parsed.username || parsed.password) {
    throw new HTTPException(400, {
      message: "Image URL must not include credentials",
    });
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!host) {
    throw new HTTPException(400, { message: "Invalid image URL host" });
  }

  if (isIP(host) !== 0) {
    if (isPrivateIp(host)) {
      throw new HTTPException(400, {
        message: "Image URL must point to a public address",
      });
    }
    return parsed;
  }

  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new HTTPException(400, {
      message: `Could not resolve image host "${host}"`,
    });
  }

  if (addresses.length === 0 || addresses.some(isPrivateIp)) {
    throw new HTTPException(400, {
      message: "Image URL must resolve to a public address",
    });
  }

  return parsed;
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /(?:^|;)\s*filename\*=[^']*'[^']*'([^;\s]+)/i.exec(header);
  if (star?.[1]) {
    try {
      const decoded = basename(decodeURIComponent(star[1]));
      if (decoded) return decoded;
    } catch {
      // Fall through to plain filename.
    }
  }
  const plain = /(?:^|;)\s*filename=(?:"([^"]+)"|([^;\s]+))/i.exec(header);
  const raw = plain?.[1] ?? plain?.[2];
  if (!raw) return null;
  const clean = basename(raw);
  return clean || null;
}

const FILE_WITH_EXT = /\.[a-z0-9]{1,8}$/i;

function deriveFilename(
  url: URL,
  disposition: string | null,
  mime: string
): string {
  const fromHeader = filenameFromDisposition(disposition);
  if (fromHeader) return fromHeader;

  const pathPart = basename(url.pathname);
  if (pathPart && FILE_WITH_EXT.test(pathPart)) return pathPart;

  for (const value of url.searchParams.values()) {
    const candidate = basename(value);
    if (candidate && FILE_WITH_EXT.test(candidate)) return candidate;
  }

  const ext = MIME_EXTENSION[mime] ?? "bin";
  return `cover.${ext}`;
}

async function readBoundedBytes(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new HTTPException(400, {
      message: `Image exceeds the ${maxBytes}-byte upload limit`,
    });
  }

  if (!response.body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength === 0) {
      throw new HTTPException(400, {
        message: "Image URL returned an empty body",
      });
    }
    if (buf.byteLength > maxBytes) {
      throw new HTTPException(400, {
        message: `Image exceeds the ${maxBytes}-byte upload limit`,
      });
    }
    return buf;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new HTTPException(400, {
          message: `Image exceeds the ${maxBytes}-byte upload limit`,
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (total === 0) {
    throw new HTTPException(400, {
      message: "Image URL returned an empty body",
    });
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Fetches an image from a public `http(s)` URL with SSRF checks on every hop,
 * a size ceiling matching the instance upload limit, and format verification
 * through sharp so only real images of an accepted MIME type are ingested.
 */
export async function fetchRemoteImage(
  rawUrl: string,
  options: FetchRemoteImageOptions = {}
): Promise<FetchedRemoteImage> {
  const policy = instancePolicy();
  const maxBytes = options.maxBytes ?? uploadLimitBytes(policy);
  const allowedTypes = options.allowedTypes ?? policy.limits.imageTypes;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const lookup = options.lookup ?? defaultLookup;

  let current = await assertPublicUrl(rawUrl, lookup);
  let response: Response | null = null;
  const signal = AbortSignal.timeout(timeoutMs);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetchFn(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal,
        headers: { Accept: "image/*" },
      });
    } catch {
      throw new HTTPException(400, {
        message: "Could not fetch image from URL",
      });
    }

    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!location) {
        throw new HTTPException(400, {
          message: "Image URL redirected without a Location header",
        });
      }
      if (hop === MAX_REDIRECTS) {
        throw new HTTPException(400, {
          message: "Image URL exceeded maximum redirects",
        });
      }
      current = await assertPublicUrl(
        new URL(location, current).toString(),
        lookup
      );
      continue;
    }

    response = res;
    break;
  }

  if (!response) {
    throw new HTTPException(400, { message: "Could not fetch image from URL" });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new HTTPException(400, {
      message: `Could not fetch image (HTTP ${response.status})`,
    });
  }

  const bytes = await readBoundedBytes(response, maxBytes);

  let format: string | undefined;
  try {
    const metadata = await sharp(bytes).metadata();
    format = metadata.format;
  } catch {
    throw new HTTPException(400, {
      message: "URL did not return a valid image",
    });
  }

  const mime = format ? SHARP_FORMAT_MIME[format] : undefined;
  if (!mime || !allowedTypes.includes(mime)) {
    throw new HTTPException(400, {
      message: `Unsupported image type "${mime ?? format ?? "unknown"}": expected one of ${allowedTypes.join(", ")}`,
    });
  }

  return {
    kind: "bytes",
    bytes,
    name: deriveFilename(
      current,
      response.headers.get("content-disposition"),
      mime
    ),
    type: mime,
  };
}
