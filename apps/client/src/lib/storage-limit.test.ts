import { describe, expect, it } from "bun:test";
import { storageLimitFailure, storageLimitMessage } from "./storage-limit";

const envelope = {
  error: "This project is at its storage limit",
  code: "storage_limit",
  details: {
    scopeKind: "project",
    usedBytes: 50 * 1024 ** 3,
    limitBytes: 50 * 1024 ** 3,
  },
};

describe("storageLimitFailure", () => {
  it("reads the refusal out of an upload's response text", () => {
    // The multipart client reads the body itself and hands over the text.
    expect(storageLimitFailure({ error: JSON.stringify(envelope) })).toEqual({
      scopeKind: "project",
      usedBytes: 50 * 1024 ** 3,
      limitBytes: 50 * 1024 ** 3,
    });
  });

  it("reads the refusal out of an already-parsed envelope", () => {
    expect(storageLimitFailure(envelope)?.scopeKind).toBe("project");
  });

  it("ignores a failure that is not about storage", () => {
    expect(storageLimitFailure({ error: "Network error" })).toBeNull();
    expect(
      storageLimitFailure({ error: "too big", code: "payload_too_large" })
    ).toBeNull();
    expect(storageLimitFailure(undefined)).toBeNull();
  });

  it("ignores a storage refusal whose numbers are missing", () => {
    expect(
      storageLimitFailure({
        code: "storage_limit",
        details: { scopeKind: "project" },
      })
    ).toBeNull();
  });

  it("names the limit from an upload failure that carries code and details", () => {
    const usedBytes = 50 * 1024 ** 3;
    const limitBytes = 50 * 1024 ** 3;

    expect(
      storageLimitFailure({
        error: "This project is at its storage limit",
        status: 413,
        code: "storage_limit",
        details: { scopeKind: "project", usedBytes, limitBytes },
      })
    ).toEqual({ scopeKind: "project", usedBytes, limitBytes });
  });
});

describe("storageLimitMessage", () => {
  it("names the project's cap", () => {
    expect(
      storageLimitMessage({
        scopeKind: "project",
        usedBytes: 50 * 1024 ** 3,
        limitBytes: 50 * 1024 ** 3,
      })
    ).toBe("This project is at its 50 GB storage limit");
  });

  it("names the account's cap", () => {
    expect(
      storageLimitMessage({
        scopeKind: "user",
        usedBytes: 2 * 1024 ** 3,
        limitBytes: 5 * 1024 ** 3,
      })
    ).toBe("Your account is at its 5 GB storage limit");
  });
});
