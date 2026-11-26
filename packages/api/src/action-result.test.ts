import { describe, expect, it } from "bun:test";
import { isNotFound, toActionOutcome, toActionResult } from "./action-result";

const failure = (
  status: number,
  body?: BodyInit,
  contentType = "application/json"
) =>
  new Response(body, {
    status,
    headers: body === undefined ? undefined : { "content-type": contentType },
  });

describe("toActionResult", () => {
  it("reports the message from the API's error envelope", async () => {
    const result = await toActionResult(
      {
        response: failure(
          409,
          JSON.stringify({
            error: "A track with that number already exists in this collection",
          })
        ),
      },
      "Failed to create track"
    );

    expect(result).toEqual({
      error: "A track with that number already exists in this collection",
      status: 409,
    });
  });

  it("reads the envelope openapi-fetch already parsed off the body", async () => {
    const response = failure(
      422,
      JSON.stringify({ error: "Name is required" })
    );
    await response.text();

    const result = await toActionResult(
      { response, error: { error: "Name is required", code: "invalid" } },
      "Failed to create track"
    );

    expect(result).toEqual({
      error: "Name is required",
      status: 422,
      code: "invalid",
    });
  });

  it("falls back to the status table when the body is not JSON", async () => {
    const result = await toActionResult(
      { response: failure(404, "Not Found", "text/plain") },
      "Failed to load track"
    );

    expect(result).toEqual({ error: "Not found", status: 404 });
  });

  it("falls back to the caller's description for an undocumented status", async () => {
    const result = await toActionResult(
      { response: failure(500) },
      "Failed to load track"
    );

    expect(result).toEqual({ error: "Failed to load track", status: 500 });
  });

  it("prefers an explicit per-status message over the envelope", async () => {
    const result = await toActionResult(
      {
        response: failure(
          409,
          JSON.stringify({ error: "Duplicate track number" })
        ),
      },
      "Failed to create track",
      { messages: { 409: "That number is taken" } }
    );

    expect(result).toEqual({ error: "That number is taken", status: 409 });
  });

  it("returns the payload of a successful response", async () => {
    const result = await toActionResult<{ id: number }>(
      { response: new Response(null, { status: 200 }), data: { id: 7 } },
      "Failed to load track"
    );

    expect(result).toEqual({ id: 7 });
  });

  it("treats an empty body as success when the caller allows it", async () => {
    const result = await toActionResult(
      { response: new Response(null, { status: 204 }) },
      "Failed to delete track",
      { allowEmpty: true }
    );

    expect(result).toBeUndefined();
  });

  it("reports the status of a failed response", async () => {
    const result = await toActionResult(
      { response: failure(404) },
      "Failed to load track"
    );

    expect(result).toEqual({ error: "Not found", status: 404 });
  });

  it("reports the envelope's code", async () => {
    const result = await toActionResult(
      {
        response: failure(
          413,
          JSON.stringify({
            error: "This project is at its storage limit",
            code: "storage_limit",
          })
        ),
      },
      "Failed to upload asset"
    );

    expect(result).toMatchObject({ code: "storage_limit" });
  });

  it("carries the envelope's details", async () => {
    const details = { scopeKind: "project", usedBytes: 1, limitBytes: 2 };
    const result = await toActionResult(
      {
        response: failure(
          413,
          JSON.stringify({
            error: "This project is at its storage limit",
            code: "storage_limit",
            details,
          })
        ),
      },
      "Failed to upload asset"
    );

    expect(result).toEqual({
      error: "This project is at its storage limit",
      status: 413,
      code: "storage_limit",
      details,
    });
  });

  it("reports a 2xx status when the body is empty and empties are not allowed", async () => {
    const result = await toActionResult(
      { response: failure(204) },
      "Failed to load track"
    );

    expect(result).toEqual({ error: "Failed to load track", status: 204 });
  });

  it("keeps the status when a per-status message replaces the text", async () => {
    const result = await toActionResult(
      {
        response: failure(
          413,
          JSON.stringify({
            error: "This project is at its storage limit",
            code: "storage_limit",
          })
        ),
      },
      "Failed to upload asset",
      { messages: { 413: "Too big" } }
    );

    expect(result).toEqual({
      error: "Too big",
      status: 413,
      code: "storage_limit",
    });
  });
});

describe("toActionOutcome", () => {
  it("reports the given value on success", async () => {
    const result = await toActionOutcome(
      { response: new Response(null, { status: 204 }) },
      "Failed to delete track",
      "deleted"
    );

    expect(result).toBe("deleted");
  });

  it("reports the API's message on failure", async () => {
    const result = await toActionOutcome(
      {
        response: failure(
          403,
          JSON.stringify({ error: "Only an owner can delete a project" })
        ),
      },
      "Failed to delete project",
      "deleted"
    );

    expect(result).toEqual({
      error: "Only an owner can delete a project",
      status: 403,
    });
  });

  it("reports status and code", async () => {
    const result = await toActionOutcome(
      {
        response: failure(
          413,
          JSON.stringify({
            error: "This project is at its storage limit",
            code: "storage_limit",
          })
        ),
      },
      "Failed to upload asset",
      "uploaded"
    );

    expect(result).toEqual({
      error: "This project is at its storage limit",
      status: 413,
      code: "storage_limit",
    });
  });
});

describe("isNotFound", () => {
  it("is true for 404 and 403 only", () => {
    expect(isNotFound({ error: "Not found", status: 404 })).toBe(true);
    expect(isNotFound({ error: "Forbidden", status: 403 })).toBe(true);
    expect(isNotFound({ error: "Server error", status: 500 })).toBe(false);
    expect(isNotFound({ error: "Network error" })).toBe(false);
  });
});
