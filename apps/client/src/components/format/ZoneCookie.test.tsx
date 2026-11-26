import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { zoneCookie } from "@/lib/zone-cookie";
import { runtimeZone } from "@workspace/ui/lib/formatters";
import { ZoneCookie } from "./ZoneCookie";

// The test document has no origin to keep cookies for, so each write is
// recorded on the way in instead.
let writes: string[] = [];

beforeEach(() => {
  writes = [];
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => "",
    set: (value: string) => writes.push(value),
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "cookie");
});

describe("ZoneCookie", () => {
  it("writes the browser's zone into the zone cookie once and draws nothing", () => {
    const { container, rerender } = render(<ZoneCookie />);
    rerender(<ZoneCookie />);

    expect(writes).toEqual([zoneCookie(runtimeZone())]);
    expect(container.innerHTML).toBe("");
  });
});
