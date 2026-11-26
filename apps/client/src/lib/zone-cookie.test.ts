import { describe, expect, it } from "bun:test";
import { ZONE_COOKIE, zoneCookie, zoneFromCookie } from "./zone-cookie";

describe("zoneFromCookie", () => {
  it("reads an IANA zone", () => {
    expect(zoneFromCookie("Europe/London")).toBe("Europe/London");
    expect(zoneFromCookie("Etc/GMT+10")).toBe("Etc/GMT+10");
  });

  it("has nothing for a missing, empty or unknown value", () => {
    expect(zoneFromCookie(undefined)).toBeNull();
    expect(zoneFromCookie("")).toBeNull();
    expect(zoneFromCookie("Mars/Olympus")).toBeNull();
    expect(zoneFromCookie("Europe/London; path=/")).toBeNull();
  });
});

describe("zoneCookie", () => {
  it("keeps the zone site-wide for a year", () => {
    expect(zoneCookie("America/Los_Angeles")).toBe(
      `${ZONE_COOKIE}=America/Los_Angeles; path=/; max-age=31536000; samesite=lax`
    );
  });

  it("round-trips through the reader", () => {
    const value = zoneCookie("Etc/GMT-10").split(";")[0]!.split("=")[1];
    expect(zoneFromCookie(value)).toBe("Etc/GMT-10");
  });
});
