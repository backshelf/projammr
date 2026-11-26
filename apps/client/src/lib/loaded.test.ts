import { describe, expect, it, mock } from "bun:test";

class NotFoundError extends Error {}

mock.module("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError("NOT_FOUND");
  },
}));

const { loaded } = await import("./loaded");

describe("loaded", () => {
  it("returns the payload of a successful read", () => {
    expect(loaded({ id: 1 })).toEqual({ id: 1 });
  });

  it("calls notFound for 404 and for 403", () => {
    expect(() => loaded({ error: "Not found", status: 404 })).toThrow(
      NotFoundError
    );
    expect(() => loaded({ error: "Forbidden", status: 403 })).toThrow(
      NotFoundError
    );
  });

  it("throws the error's message for a 500 and for an error with no status", () => {
    expect(() => loaded({ error: "Server error", status: 500 })).toThrow(
      "Server error"
    );
    expect(() => loaded({ error: "Dropped connection" })).toThrow(
      "Dropped connection"
    );
  });
});
