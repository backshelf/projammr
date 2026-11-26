export type ActionError = {
  error: string;
  /** The HTTP status of the response that produced this error. Absent when no response did. */
  status?: number;
  /** The API's machine-readable error code, when its envelope carried one. */
  code?: string;
  /** The facts the envelope documents for that code (the used and allowed bytes behind a storage refusal). */
  details?: Record<string, unknown>;
};

/** Narrows a `T | ActionError` union to its failure arm. */
export const isActionError = <T>(
  result: T | ActionError
): result is ActionError =>
  typeof result === "object" && result !== null && "error" in result;

/** A missing row and a forbidden one read the same to the caller. */
export const isNotFound = (error: ActionError): boolean =>
  error.status === 404 || error.status === 403;

type ApiResult = {
  data?: unknown;
  error?: unknown;
  response: Response;
};

/**
 * Messages for the status codes whose meaning is the same everywhere. A caller
 * that can say something more specific passes its own `messages`.
 */
const DEFAULT_MESSAGES: Record<number, string> = {
  401: "You are not signed in",
  403: "You do not have access to that",
  404: "Not found",
};

export type ResultOptions = {
  /** Per-status messages, taking precedence over the shared defaults. */
  messages?: Record<number, string>;
  /**
   * Treat an empty body as success. Delete endpoints answer `204`, which
   * leaves `data` undefined even though nothing went wrong.
   */
  allowEmpty?: boolean;
};

/**
 * The one place an openapi-fetch result becomes either its payload or an
 * `ActionError`. `statusText` is empty over HTTP/2, so a status-derived
 * message is used before falling back to the caller's description of the
 * operation.
 */
export async function toActionResult<T>(
  result: ApiResult,
  fallback: string,
  options: ResultOptions = {}
): Promise<T | ActionError> {
  const { response } = result;

  if (!response.ok || result.error) {
    return failure(result, fallback, options.messages);
  }

  if (result.data === undefined || result.data === null) {
    if (options.allowEmpty) return undefined as T;
    return failure(result, fallback, options.messages);
  }

  return result.data as T;
}

/**
 * For endpoints whose payload the caller ignores — deletes, and writes it
 * answers by refetching. Reports the given value on success rather than a body.
 */
export async function toActionOutcome<T>(
  result: ApiResult,
  fallback: string,
  success: T,
  options: Omit<ResultOptions, "allowEmpty"> = {}
): Promise<T | ActionError> {
  if (!result.response.ok || result.error) {
    return failure(result, fallback, options.messages);
  }

  return success;
}

/**
 * Builds the `ActionError` for a failing result: the message chosen exactly
 * as `errorMessage` used to (per-status `messages`, then the envelope's
 * message, then `DEFAULT_MESSAGES`, then `statusText`, then `fallback`),
 * plus the response's status and whatever the envelope documents.
 */
async function failure(
  result: ApiResult,
  fallback: string,
  messages?: Record<number, string>
): Promise<ActionError> {
  const { response } = result;
  const envelope = await serverMessage(result);

  return {
    error:
      messages?.[response.status] ||
      envelope?.message ||
      DEFAULT_MESSAGES[response.status] ||
      response.statusText ||
      fallback,
    status: response.status,
    ...(envelope?.code !== undefined ? { code: envelope.code } : {}),
    ...(envelope?.details !== undefined ? { details: envelope.details } : {}),
  };
}

type Envelope = {
  message?: string;
  code?: string;
  details?: Record<string, unknown>;
};

/**
 * The facts the API's `{ error, code?, details?, requestId? }` envelope
 * carries. openapi-fetch reads and parses a failed response's body itself and
 * hands the result over as `error`, which leaves the response no longer
 * readable; the body is only worth reading directly when it survived that
 * path untouched.
 */
async function serverMessage(result: ApiResult): Promise<Envelope | undefined> {
  const parsed = envelopeMessage(result.error);
  if (parsed) return parsed;

  if (result.response.bodyUsed) return undefined;

  const body = await result.response
    .clone()
    .json()
    .catch(() => null);

  return envelopeMessage(body);
}

function envelopeMessage(body: unknown): Envelope | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { error, code, details } = body as {
    error?: unknown;
    code?: unknown;
    details?: unknown;
  };

  const message = typeof error === "string" && error !== "" ? error : undefined;
  const envelopeCode =
    typeof code === "string" && code !== "" ? code : undefined;
  const envelopeDetails =
    typeof details === "object" && details !== null && !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : undefined;

  if (
    message === undefined &&
    envelopeCode === undefined &&
    envelopeDetails === undefined
  ) {
    return undefined;
  }

  return { message, code: envelopeCode, details: envelopeDetails };
}
