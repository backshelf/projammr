import { describe, expect, test } from "bun:test";

import { describeFailure } from "./use-command";

describe("describeFailure", () => {
  test("uses the app's own words when it sent a line", () => {
    expect(describeFailure("Start at login is not set from here yet.")).toBe(
      "Start at login is not set from here yet."
    );
  });

  test("does not take a stray object for the app's words", () => {
    expect(describeFailure({ code: "gone" })).toBe("Something went wrong.");
  });

  test("falls back to an error's message, then to a plain apology", () => {
    expect(describeFailure(new Error("socket closed"))).toBe("socket closed");
    expect(describeFailure(undefined)).toBe("Something went wrong.");
  });
});
