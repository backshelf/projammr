import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { stubEnv } from "@workspace/test/env";
import { eq } from "drizzle-orm";

/**
 * The MCP row of the hub in a deployment that keeps MCP off (`MCP_DISABLED=1`,
 * set before anything reads `env.ts`): the row reports what the process
 * serves, not what the running policy allows.
 *
 * This file runs in the serial phase: it promotes the suite's owner to
 * instance admin for its run.
 */
stubEnv("MCP_DISABLED", "1");

const { db } = await import("../db/index.js");
const { users } = await import("../db/schema/auth.js");
const { hubRowsSchema } = await import("../db/queries/settings.js");
const { mcpServed } = await import("../auth.js");
const { setupSuite } = await import("../test/fixtures.js");

const suite = setupSuite("Instance settings, MCP off");
const admin = suite.owner;

beforeAll(async () => {
  if (suite.setUpFailed) return;
  await db
    .update(users)
    .set({ instanceRole: "admin" })
    .where(eq(users.id, admin.userId));
});

afterAll(async () => {
  if (admin.userId === undefined) return;
  await db
    .update(users)
    .set({ instanceRole: "user" })
    .where(eq(users.id, admin.userId));
});

describe("the MCP setting when the deployment disables MCP", () => {
  it("reports MCP as not running, with the reason, whatever the policy holds", async () => {
    suite.requireProject();
    expect(mcpServed).toBe(false);

    const res = await suite.requestAs(admin, "/settings");
    expect(res.status).toBe(200);
    const rows = hubRowsSchema.parse(await res.json());

    expect(rows["instance-integrations.mcpEnabled"]).toMatchObject({
      effective: true,
      running: false,
      deploymentOff: true,
    });
    expect(rows["instance-access.sessionLifetimeDays"]).not.toHaveProperty(
      "deploymentOff"
    );
  });
});
