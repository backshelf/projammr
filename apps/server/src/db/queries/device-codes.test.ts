import { inArray, eq } from "drizzle-orm";
import { describe, expect, it } from "bun:test";
import { db } from "../index.js";
import { deviceCodes } from "../schema/auth.js";
import { reapExpiredDeviceCodes } from "./device-codes.js";

const DAY_MS = 24 * 60 * 60 * 1000;

let counter = 0;

async function mkDeviceCode(status: string, expiresAt: Date): Promise<string> {
  counter++;
  const suffix = `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
  const [row] = await db
    .insert(deviceCodes)
    .values({
      id: `device-code-reaper-${suffix}`,
      deviceCode: `device-code-reaper-device-${suffix}`,
      userCode: `reaper-${suffix}`,
      expiresAt,
      status,
      clientId: "dit",
    })
    .returning({ id: deviceCodes.id });
  return row!.id;
}

async function codeExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: deviceCodes.id })
    .from(deviceCodes)
    .where(eq(deviceCodes.id, id));
  return row != null;
}

describe("reapExpiredDeviceCodes", () => {
  it("deletes a code that expired over a day ago but keeps fresh, just-expired and approved-unredeemed ones", async () => {
    const now = Date.now();
    const stale = await mkDeviceCode("pending", new Date(now - 2 * DAY_MS));
    const staleApproved = await mkDeviceCode(
      "approved",
      new Date(now - 2 * DAY_MS)
    );
    const justExpired = await mkDeviceCode("pending", new Date(now - 60_000));
    const fresh = await mkDeviceCode("pending", new Date(now + 30 * 60_000));
    const approved = await mkDeviceCode(
      "approved",
      new Date(now + 30 * 60_000)
    );

    try {
      const count = await reapExpiredDeviceCodes();

      expect(count).toBeGreaterThanOrEqual(2);
      expect(await codeExists(stale)).toBe(false);
      expect(await codeExists(staleApproved)).toBe(false);
      expect(await codeExists(justExpired)).toBe(true);
      expect(await codeExists(fresh)).toBe(true);
      expect(await codeExists(approved)).toBe(true);
    } finally {
      await db
        .delete(deviceCodes)
        .where(
          inArray(deviceCodes.id, [
            stale,
            staleApproved,
            justExpired,
            fresh,
            approved,
          ])
        );
    }
  });
});
