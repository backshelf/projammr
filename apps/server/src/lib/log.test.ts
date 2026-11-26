import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";
import { log } from "./log.js";

afterEach(() => {
  mock.restore();
  restoreInstancePolicy();
});

describe("log", () => {
  it("writes at and above the instance's level, read per line", () => {
    const written = spyOn(process.stdout, "write").mockImplementation(
      () => true
    );
    const logger = log("level-test");

    stubInstancePolicy({ integrations: { logLevel: "warn" } });
    logger.info("line-below-warn");
    logger.warn("line-at-warn");

    stubInstancePolicy({ integrations: { logLevel: "debug" } });
    logger.debug("line-at-debug");

    const lines = written.mock.calls.map(([chunk]) => String(chunk));
    expect(lines.some((line) => line.includes("line-below-warn"))).toBe(false);
    expect(lines.some((line) => line.includes("line-at-warn"))).toBe(true);
    expect(lines.some((line) => line.includes("line-at-debug"))).toBe(true);
  });
});
