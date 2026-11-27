import { resolver } from "hono-openapi";
import type { ZodType } from "zod";

/**
 * OpenAPI `requestBody` descriptor for a streaming multipart upload route,
 * matching the media types `validator("form", schema)` emits while letting
 * the handler stream `c.req.raw.body` directly to disk instead of buffering.
 */
export const multipartRequestBody = <T extends ZodType>(schema: T) => ({
  required: true,
  content: {
    "application/x-www-form-urlencoded": { schema: resolver(schema) },
    "multipart/form-data": { schema: resolver(schema) },
  },
});
