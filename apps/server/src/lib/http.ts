import type { Context, Env, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  type DescribeRouteOptions,
  describeRoute,
  resolver,
  validator as openapiValidator,
} from "hono-openapi";
import { z, type ZodType } from "zod";
import { errorFields, log } from "./log.js";

const logger = log("http");

/** The body of every non-2xx answer the API gives. */
export const errorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  /**
   * The facts a client needs to say more than "it failed" — the used and
   * allowed bytes behind a storage refusal, for instance. Only a failure that
   * documents its own code carries them.
   */
  details: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string().optional(),
});

type ErrorBody = z.infer<typeof errorSchema>;

/**
 * A failure a client is expected to handle rather than merely report: it
 * carries a stable `code` and, where the explanation needs numbers, the
 * `details` to build it from. Anything the client only shows as text stays a
 * plain `HTTPException`.
 */
export class ApiError extends HTTPException {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: ContentfulStatusCode,
    {
      code,
      message,
      details,
    }: { code: string; message: string; details?: Record<string, unknown> }
  ) {
    super(status, { message });
    this.code = code;
    this.details = details;
  }
}

/** One refused field, as a body or query validation failure reports it. */
export type ValidationIssue = {
  path: (string | number)[];
  message: string;
  code?: string;
  maximum?: number | string;
};

/**
 * The parts of a schema issue a client can act on. Standard Schema types an
 * issue as a message and a path whose segments may be `{ key }` objects; the
 * `code` and `maximum` are zod's own fields, which its issues carry at runtime.
 */
const toValidationIssue = (issue: {
  message: string;
  path?: readonly (PropertyKey | { key: PropertyKey })[];
  code?: unknown;
  maximum?: unknown;
}): ValidationIssue => {
  const path = (issue.path ?? []).map((segment) => {
    const key = typeof segment === "object" ? segment.key : segment;
    return typeof key === "number" ? key : String(key);
  });
  const code = typeof issue.code === "string" ? issue.code : undefined;
  const maximum =
    code === "too_big" &&
    (typeof issue.maximum === "number" || typeof issue.maximum === "string")
      ? issue.maximum
      : undefined;
  return {
    path,
    message: issue.message,
    ...(code ? { code } : {}),
    ...(maximum !== undefined ? { maximum } : {}),
  };
};

/**
 * A request that failed its schema, in the shared error envelope. `message`
 * says why when one reason covers every issue, for a client that shows only
 * the message.
 */
export const invalidRequest = (
  issues: readonly Parameters<typeof toValidationIssue>[0][],
  message = "Invalid request"
) =>
  new ApiError(400, {
    code: "invalid_request",
    message,
    details: { issues: issues.map(toValidationIssue) },
  });

/**
 * `hono-openapi`'s `validator`, answering a body, query or form that fails its
 * schema with a 400 in the shared error envelope: the refused fields are in
 * `details.issues`. The request schema still reaches the OpenAPI document.
 */
export const validator = ((target, schema, hook, options) =>
  openapiValidator(
    target,
    schema,
    (result, c) => {
      if (!result.success) throw invalidRequest(result.error);
      return hook?.(result, c);
    },
    options
  )) as typeof openapiValidator;

/**
 * Parses a request value against a schema chosen while handling it — one that
 * depends on the path, say — answering a failure with the same 400 `validator`
 * gives.
 */
export function parseRequest<T extends ZodType>(
  schema: T,
  value: unknown
): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidRequest(parsed.error.issues);
  return parsed.data;
}

/** The body of a write that acknowledges rather than returning an entity. */
export const messageSchema = z.object({ message: z.string() });

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: "Malformed request",
  401: "Not signed in",
  403: "Insufficient project role",
  404: "Not found",
  409: "Conflict with the current state",
  410: "No longer available",
  411: "Content-Length required",
  413: "Payload too large",
  415: "Unsupported media type",
  422: "Request could not be processed",
  429: "Too many requests",
  500: "Internal server error",
};

/** What to say when a thrown `HTTPException` carried no message of its own. */
export const defaultErrorMessage = (status: number) =>
  ERROR_DESCRIPTIONS[status] ?? "Error";

/**
 * Every failure leaves as JSON in the shared envelope, which is what the route
 * documentation promises and what `packages/api` reads. An `HTTPException`
 * that carried its own `res` keeps it — that is a deliberate answer, not an
 * error message.
 */
export const jsonErrorHandler: ErrorHandler = (err, c) => {
  // The handler is mounted on apps whose variables it does not know; the id is
  // there whenever `requestId()` ran, and absent is a fine answer when it did
  // not.
  const requestId = c.get("requestId") as string | undefined;
  const where = { method: c.req.method, path: c.req.path, requestId };

  if (err instanceof HTTPException) {
    logger.warn(err.message || defaultErrorMessage(err.status), {
      ...where,
      status: err.status,
      ...(err instanceof ApiError ? { code: err.code } : {}),
    });
    if (err.res) return err.res;
    return c.json<ErrorBody>(
      {
        error: err.message || defaultErrorMessage(err.status),
        ...(err instanceof ApiError
          ? { code: err.code, details: err.details }
          : {}),
        requestId,
      },
      err.status
    );
  }

  logger.error("unhandled error", { ...where, ...errorFields(err) });
  return c.json<ErrorBody>({ error: "Internal Server Error", requestId }, 500);
};

/** One documented JSON response. */
export const json = <T extends ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema: resolver(schema) } },
});

/** The error responses a route can produce, all in the shared envelope. */
export const errors = (...codes: number[]) =>
  Object.fromEntries(
    codes.map((code) => [
      code,
      json(errorSchema, ERROR_DESCRIPTIONS[code] ?? "Error"),
    ])
  );

type Success = {
  schema: ZodType;
  description?: string;
  status?: ContentfulStatusCode;
};

/**
 * An operation's summary is the first sentence of its description: the line a
 * reference lists the operation by. The description keeps the whole text,
 * unless that one sentence is all there is.
 */
export function summarise(description: string): {
  summary: string;
  description?: string;
} {
  const summary =
    description.match(/^(.+?)[.:;](?=\s|$)/s)?.[1] ?? description.trim();
  const rest = description
    .slice(summary.length)
    .replace(/^[.:;]/, "")
    .trim();
  return rest ? { summary, description } : { summary };
}

/**
 * The route-description helpers for one group of the API reference. Each
 * router takes its own, so every operation it declares is tagged with the
 * group it belongs to and summarised from its description.
 */
export function describer(tag: string) {
  const route = ({
    description,
    ...spec
  }: DescribeRouteOptions & { description: string }) =>
    describeRoute({ tags: [tag], ...summarise(description), ...spec });

  return {
    /** `describeRoute` in this group, for responses neither shorthand fits. */
    route,

    /**
     * `describeRoute` with the error envelope applied. `ok` describes the
     * success body; the trailing codes are the failures the route can produce.
     */
    describe: (description: string, ok: Success, ...errorCodes: number[]) =>
      route({
        description,
        responses: {
          [ok.status ?? 200]: json(ok.schema, ok.description ?? "OK"),
          ...errors(...errorCodes),
        },
      }),

    /**
     * For a route that answers with something other than JSON — a file
     * stream, a redirect — while still documenting its errors in the envelope.
     */
    describeRaw: (
      description: string,
      ok: { status?: number; description: string },
      ...errorCodes: number[]
    ) =>
      route({
        description,
        responses: {
          [ok.status ?? 200]: { description: ok.description },
          ...errors(...errorCodes),
        },
      }),
  };
}

/**
 * A path segment that names a row. The wire value is a string, which is what
 * the segment is and what the generated client sends; the handler reads the
 * number it parses to.
 */
export const idValue = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().positive());

/**
 * Validates the path parameters, answering a 400 in the shared envelope before
 * the handler runs. Hono keeps one validated value per target, so a route
 * declares all of its parameters in a single call.
 */
export function params<T extends z.ZodRawShape>(shape: T) {
  return openapiValidator("param", z.object(shape), (result) => {
    if (!result.success) {
      throw new HTTPException(400, {
        message: `Invalid path parameter: ${Object.keys(shape).join(", ")}`,
      });
    }
  });
}

/** Path parameters that are all row ids. */
export function idParams<const N extends readonly [string, ...string[]]>(
  ...names: N
) {
  return params(
    Object.fromEntries(names.map((name) => [name, idValue])) as {
      [K in N[number]]: typeof idValue;
    }
  );
}

/** The common case: a single `:id`. */
export const idParam = () => idParams("id");

/**
 * Sends `data`, checking it against `schema` outside production so a route
 * whose payload drifts from its documentation fails a test rather than the
 * client's types. In production the check is skipped.
 */
export function respond<T extends ZodType, E extends Env>(
  c: Context<E>,
  schema: T,
  data: z.infer<T>,
  status: ContentfulStatusCode = 200
) {
  if (process.env.NODE_ENV !== "production") {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new Error(
        `${c.req.method} ${c.req.path} response does not match its schema: ${parsed.error.message}`
      );
    }
  }
  return c.json(data, status);
}

/** Acknowledges a write whose caller has no use for the entity. */
export const respondMessage = <E extends Env>(
  c: Context<E>,
  message: string,
  status: ContentfulStatusCode = 200
) => respond(c, messageSchema, { message }, status);
