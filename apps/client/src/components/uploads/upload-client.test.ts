import { describe, expect, it } from "bun:test";
import { tooBigMaximum } from "./upload-client";

describe("tooBigMaximum", () => {
  it("reads the cap from the failure uploadMultipart hands back for a too_big refusal", () => {
    // The API's envelope carries `error` as a string, so `uploadMultipart`
    // hands back that string with the envelope's `code` and `details`.
    expect(
      tooBigMaximum({
        error: "Invalid request",
        status: 400,
        code: "invalid_request",
        details: {
          issues: [
            {
              code: "too_big",
              maximum: 41943040,
              path: ["file"],
              message: "File is over the 41943040-byte upload limit",
            },
          ],
        },
      })
    ).toBe(41943040);
  });

  it("is null for a validation failure of another kind", () => {
    expect(
      tooBigMaximum({
        error: "Invalid request",
        status: 400,
        code: "invalid_request",
        details: {
          issues: [
            { code: "invalid_type", path: ["projectId"], message: "Required" },
          ],
        },
      })
    ).toBeNull();
  });

  it("is null for a failure that carries no issues", () => {
    expect(tooBigMaximum({ error: "Network error" })).toBeNull();
    expect(
      tooBigMaximum({
        error: "This project is at its storage limit",
        status: 413,
        code: "storage_limit",
        details: { scopeKind: "project", usedBytes: 1, limitBytes: 1 },
      })
    ).toBeNull();
  });
});
