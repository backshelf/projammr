import type { RateBucketName } from "@workspace/settings/groups/instance-rate-limits";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AuthType } from "../auth.js";
import { clientAddress } from "../lib/client-address.js";
import { instancePolicy } from "../lib/instance-policy.js";

type Bucket = { tokens: number; refilledAt: number; burst: number };

/** One spend's outcome: allowed, or refused with how long until a token is back. */
type Spend = { allowed: true } | { allowed: false; retryAfterSeconds: number };

const SWEEP_INTERVAL_MS = 10 * 60_000;
const IDLE_MS = 60 * 60_000;

/**
 * Every named bucket lives in one map, keyed `name:caller` — `takeToken` is
 * called directly by a non-middleware caller (the MCP route) and by
 * `rateLimit` below, so there is one bucket implementation behind both.
 */
const buckets = new Map<string, Bucket>();

// Unreferenced so the sweep cannot hold the process — or the test runner —
// open on its own. Only a full bucket is swept: deleting one that still owes
// refill would hand back tokens early, but tearing down a full one and
// rebuilding it fresh next time is exactly the same state.
setInterval(() => {
  const cutoff = Date.now() - IDLE_MS;
  for (const [key, bucket] of buckets) {
    if (bucket.tokens >= bucket.burst && bucket.refilledAt < cutoff) {
      buckets.delete(key);
    }
  }
}, SWEEP_INTERVAL_MS).unref();

/**
 * Spends one token from the bucket named `name:key`, creating it full on first
 * use, at the allowance the instance policy gives `name` at this moment
 * (`rateLimits` in `lib/instance-policy.ts`). A bucket whose burst was lowered
 * since its last spend is clamped to the new burst on this one, and one whose
 * refill changed refills at the new rate from here on; no spend already
 * allowed is taken back.
 */
function spend(name: RateBucketName, key: string): Spend {
  const { burst, perMinute } = instancePolicy().rateLimits[name];
  const refillPerMs = perMinute / 60_000;
  const bucketKey = `${name}:${key}`;
  const now = Date.now();

  const bucket = buckets.get(bucketKey) ?? {
    tokens: burst,
    refilledAt: now,
    burst,
  };
  bucket.tokens = Math.min(
    burst,
    bucket.tokens + (now - bucket.refilledAt) * refillPerMs
  );
  bucket.refilledAt = now;
  bucket.burst = burst;
  buckets.set(bucketKey, bucket);

  if (bucket.tokens < 1) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((1 - bucket.tokens) / refillPerMs / 1000),
    };
  }

  bucket.tokens -= 1;
  return { allowed: true };
}

/**
 * Spends one token from `name`'s bucket for `key`. Returns whether the call is
 * allowed; the caller decides what a refusal means (a 429, a dropped MCP
 * request, …).
 */
export function takeToken(name: RateBucketName, key: string): boolean {
  return spend(name, key).allowed;
}

/**
 * `takeToken` for a caller outside the middleware chain — an MCP tool, the MCP
 * route — which answers a refusal with the same 429 a route does.
 */
export function spendToken(name: RateBucketName, key: string): void {
  if (!takeToken(name, key)) {
    throw new HTTPException(429, { message: "Too many requests" });
  }
}

/**
 * Meters a route on `name`'s bucket: `burst` requests at once, refilling at
 * `perMinute`, both read from the policy on every request. Keyed per user,
 * falling back to `clientAddress` (`lib/client-address.ts`) for the
 * unauthenticated path — which means anywhere outside compose, with no
 * trusted proxy in front, every anonymous caller shares one bucket; that is
 * the same trade `TRUSTED_PROXY_HOPS = 0` makes everywhere else.
 */
export function rateLimit(name: RateBucketName) {
  return createMiddleware<{ Variables: AuthType }>(async (c, next) => {
    const caller = c.get("user")?.id ?? clientAddress(c);

    const result = spend(name, caller);
    if (!result.allowed) {
      c.header("Retry-After", String(result.retryAfterSeconds));
      throw new HTTPException(429, { message: "Too many requests" });
    }

    await next();
  });
}

/** Every entity move draws on the one `moves` bucket. */
export const moveRateLimit = rateLimit("moves");

export const bulkMoveRateLimit = rateLimit("bulk-moves");
