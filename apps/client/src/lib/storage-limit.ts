import { defaultFormatters } from "@workspace/ui/lib/formatters";

/** The storage refusal an upload or a conversion was answered with. */
export type StorageLimit = {
  scopeKind: "project" | "user";
  usedBytes: number;
  limitBytes: number;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

/**
 * The envelope behind a failure. An upload's error is the response text, since
 * the multipart client reads the body itself; openapi-fetch hands over the
 * parsed body. Either way what is wanted is `{ code, details }`.
 */
function envelope(failure: unknown): Record<string, unknown> | null {
  const direct = asRecord(failure);
  if (!direct) return null;
  if (typeof direct.code === "string") return direct;

  if (typeof direct.error === "string") {
    try {
      return asRecord(JSON.parse(direct.error));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The storage cap a failure was refused by, or null when it failed for any
 * other reason. The server documents the refusal with `code: "storage_limit"`
 * and the two numbers, which is what lets the client name the limit instead of
 * reporting that something went wrong.
 */
export function storageLimitFailure(failure: unknown): StorageLimit | null {
  const body = envelope(failure);
  if (body?.code !== "storage_limit") return null;

  const details = asRecord(body.details);
  const { scopeKind, usedBytes, limitBytes } = details ?? {};
  if (scopeKind !== "project" && scopeKind !== "user") return null;
  if (typeof usedBytes !== "number" || typeof limitBytes !== "number") {
    return null;
  }

  return { scopeKind, usedBytes, limitBytes };
}

/** What to tell whoever hit the cap, naming the limit they hit. A limit in
 *  whole units has no decimal sign for a locale to change, so the default
 *  formatter set writes it as any viewer's would. */
export const storageLimitMessage = ({
  scopeKind,
  limitBytes,
}: StorageLimit): string => {
  const limit = defaultFormatters().bytes(limitBytes, 0);
  return scopeKind === "project"
    ? `This project is at its ${limit} storage limit`
    : `Your account is at its ${limit} storage limit`;
};
