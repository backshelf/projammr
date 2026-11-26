import { describe, expect, it } from "bun:test";
import {
  describeDevice,
  revokeDeviceSession,
  sortByLastActive,
} from "./devices";

describe("describeDevice", () => {
  it("prefers a device name over a User-Agent guess, for a client token", () => {
    expect(
      describeDevice({
        id: "s1",
        token: "t1",
        updatedAt: new Date(),
        userAgent: "Mozilla/5.0",
        deviceName: "Mara's Studio Mac",
      })
    ).toBe("Mara's Studio Mac");
  });

  it("reads a browser and OS out of an ordinary browser's User-Agent", () => {
    const chromeOnMac =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

    expect(
      describeDevice({
        id: "s2",
        token: "t2",
        updatedAt: new Date(),
        userAgent: chromeOnMac,
        deviceName: null,
      })
    ).toBe("Chrome on macOS");
  });

  it("falls back to Unknown device with neither a device name nor a User-Agent", () => {
    expect(
      describeDevice({ id: "s3", token: "t3", updatedAt: new Date() })
    ).toBe("Unknown device");
  });
});

describe("sortByLastActive", () => {
  it("orders the most recently active session first", () => {
    const older = { updatedAt: "2026-01-01T00:00:00Z" };
    const newer = { updatedAt: "2026-06-01T00:00:00Z" };

    expect(sortByLastActive([older, newer])).toEqual([newer, older]);
  });
});

describe("revokeDeviceSession", () => {
  it("revokes the session by its token and reports success", async () => {
    const calls: unknown[] = [];
    const client = {
      revokeSession: async (body: { token: string }) => {
        calls.push(body);
        return { data: { status: true }, error: null };
      },
    };

    const result = await revokeDeviceSession("the-token", client);

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ token: "the-token" }]);
  });

  it("reports the server's message when the revoke fails", async () => {
    const client = {
      revokeSession: async () => ({
        data: null,
        error: { message: "Session not found" },
      }),
    };

    const result = await revokeDeviceSession("gone", client);

    expect(result).toEqual({ ok: false, message: "Session not found" });
  });
});
