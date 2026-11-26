import { describe, expect, it } from "bun:test";
import { shouldUpdateProjectCookie } from "./project-cookie";

describe("shouldUpdateProjectCookie", () => {
  it("is false when the cookie already names the route's project", () => {
    expect(shouldUpdateProjectCookie(4, 4)).toBe(false);
  });

  it("is true when a deep link opens a different project than the cookie", () => {
    expect(shouldUpdateProjectCookie(4, 9)).toBe(true);
  });

  it("is true when there is no cookie yet", () => {
    expect(shouldUpdateProjectCookie(0, 9)).toBe(true);
  });
});
