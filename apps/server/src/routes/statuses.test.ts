import { eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "bun:test";
import { db } from "../db/index.js";
import { statuses } from "../db/schema/statuses.js";
import { setupSuite } from "../test/fixtures.js";

const suite = setupSuite("Statuses");
const {
  requireProject,
  request,
  expectAccess,
  mkStatus,
  throwawayProject,
  uniqueStatusName,
} = suite;

describe("statuses", () => {
  // A create whose body names no project must not fall through to an
  // authentication-only check: it would write an instance-wide status that
  // every project reads and that could never be changed or deleted. Both
  // requests must be rejected before `createStatus` ever runs, not merely
  // fail inside it.
  it("400s a status create with no projectId, and 404s one naming another project's id", async () => {
    requireProject();

    const noProject = await request("owner", "/statuses", {
      method: "POST",
      body: JSON.stringify({
        name: uniqueStatusName("Regression No Project"),
        percentage: 10,
      }),
    });
    expect(noProject.status).toBe(400);

    const other = await throwawayProject();
    const foreignProject = await request("owner", "/statuses", {
      method: "POST",
      body: JSON.stringify({
        name: uniqueStatusName("Regression Foreign Project"),
        percentage: 10,
        projectId: other.id,
      }),
    });
    expect(foreignProject.status).toBe(404);
  });

  it("lets two projects each have a status of the same name", async () => {
    requireProject();
    const name = uniqueStatusName("Shared Name");

    const mine = await request("owner", "/statuses", {
      method: "POST",
      body: JSON.stringify({
        name,
        percentage: 20,
        projectId: suite.projectId,
      }),
    });
    expect(mine.status).toBe(201);

    // A second project is created just for this assertion — status names are
    // unique per project, so proving it needs two — and removed straight away
    // to keep the run down to the one shared project.
    const otherRes = await request("owner", "/projects", {
      method: "POST",
      body: JSON.stringify({ name: `Second Project ${Date.now()}`, links: [] }),
    });
    expect(otherRes.status).toBe(201);
    const otherProjectId = (await otherRes.json()).id as number;

    try {
      const theirs = await request("owner", "/statuses", {
        method: "POST",
        body: JSON.stringify({
          name,
          percentage: 20,
          projectId: otherProjectId,
        }),
      });
      expect(theirs.status).toBe(201);

      // Within one project the name still has to be unique.
      const duplicate = await request("owner", "/statuses", {
        method: "POST",
        body: JSON.stringify({
          name,
          percentage: 30,
          projectId: suite.projectId,
        }),
      });
      expect(duplicate.status).toBe(500);
    } finally {
      const cleanUp = await request("owner", `/projects/${otherProjectId}`, {
        method: "DELETE",
      });
      expect(cleanUp.ok).toBe(true);
    }
  });

  it("creates, updates, and deletes a project status", async () => {
    requireProject();

    const name = uniqueStatusName("In Progress");
    const created = await request("owner", "/statuses", {
      method: "POST",
      body: JSON.stringify({
        name,
        percentage: 50,
        description: "Halfway",
        colourHex: "#ff8800",
        projectId: suite.projectId,
      }),
    });
    expect(created.status).toBe(201);
    const status = await created.json();
    expect(status.name).toBe(name);
    expect(status.percentage).toBe(50);

    const updated = await request("owner", `/statuses/${status.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: uniqueStatusName("Nearly Done"),
        percentage: 90,
      }),
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()).percentage).toBe(90);

    const deleted = await request("owner", `/statuses/${status.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
  });

  it("PUT /statuses/:id is gone", async () => {
    requireProject();
    const status = await mkStatus("Gone Verb Status", 40);
    const res = await request("owner", `/statuses/${status.id}`, {
      method: "PUT",
      body: JSON.stringify({ percentage: 45 }),
    });
    expect(res.status).toBe(404);
  });

  it("refuses to delete a seeded default status", async () => {
    requireProject();
    const res = await request("owner", "/statuses/1", { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  // The guard is on `suite.projectId is null`, not on an id range, so a global status
  // seeded after the original three is protected in exactly the same way.
  it("refuses to delete a global status seeded beyond the original three", async () => {
    requireProject();

    const [global] = await db
      .insert(statuses)
      .values({ name: uniqueStatusName("Extra Global"), percentage: 15 })
      .returning();
    if (!global) throw new Error("failed to seed a global status");

    try {
      const res = await request("owner", `/statuses/${global.id}`, {
        method: "DELETE",
      });
      expect(res.status).toBe(403);
      expect(global.id).toBeGreaterThan(3);
    } finally {
      await db.delete(statuses).where(eq(statuses.id, global.id));
    }
  });

  it("gives a status inserted without a colour the grey column default", async () => {
    requireProject();

    const [inserted] = await db
      .insert(statuses)
      .values({ name: uniqueStatusName("Default Colour"), percentage: 5 })
      .returning();
    if (!inserted) throw new Error("failed to seed a global status");

    try {
      expect(inserted.colourHex).toBe("#8A8A8A");
    } finally {
      await db.delete(statuses).where(eq(statuses.id, inserted.id));
    }
  });

  it("seeds the three global statuses with their own colours, none of them white", async () => {
    requireProject();

    const globals = await db
      .select({ name: statuses.name, colourHex: statuses.colourHex })
      .from(statuses)
      .where(isNull(statuses.projectId));
    const colours = new Map(globals.map((s) => [s.name, s.colourHex]));

    expect(colours.get("To Do")).toBe("#8A8A8A");
    expect(colours.get("In Progress")).toBe("#4A7FD4");
    expect(colours.get("Complete")).toBe("#4CAF7A");
  });

  it("404s when deleting a status that does not exist", async () => {
    requireProject();
    const res = await request("owner", "/statuses/98765432", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("lists a project's statuses alongside the global ones", async () => {
    requireProject();
    const status = await mkStatus("Project Only Status", 25);

    const rows = (await (
      await request("viewer", `/projects/${suite.projectId}/statuses`)
    ).json()) as { id: number; projectId: number | null }[];
    expect(rows.some((r) => r.id === status.id)).toBe(true);
    expect(rows.some((r) => r.projectId === null)).toBe(true);
  });

  it("reads a project status by id as a viewer", async () => {
    requireProject();
    const status = await mkStatus("Readable Status", 45);

    const res = await request("viewer", `/statuses/${status.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: status.id,
      name: status.name,
      percentage: 45,
      projectId: suite.projectId,
    });
  });

  it("a non-member gets 404 for a project status", async () => {
    requireProject();
    const status = await mkStatus("Unreadable Status", 55);

    // 404, not 403: the read does not confirm to an outsider that the row is
    // there. Signing in at all is still required.
    const outsider = await request("outsider", `/statuses/${status.id}`);
    expect(outsider.status).toBe(404);

    const anonymous = await request("anonymous", `/statuses/${status.id}`);
    expect(anonymous.status).toBe(401);
  });

  it("reads a global status by id as any signed-in caller", async () => {
    requireProject();

    const [global] = await db
      .insert(statuses)
      .values({ name: uniqueStatusName("Readable Global"), percentage: 15 })
      .returning();
    if (!global) throw new Error("failed to seed a global status");

    try {
      // A global status resolves to `{kind:"instance"}`, which no membership
      // gate applies to on a read — the outsider, a member of nothing, reads
      // it exactly as the project's own viewer does.
      for (const caller of ["outsider", "viewer", "owner"] as const) {
        const res = await request(caller, `/statuses/${global.id}`);
        expect(res.status, caller).toBe(200);
        expect((await res.json()).projectId, caller).toBeNull();
      }

      const anonymous = await request("anonymous", `/statuses/${global.id}`);
      expect(anonymous.status).toBe(401);
    } finally {
      await db.delete(statuses).where(eq(statuses.id, global.id));
    }
  });

  it("404s reading a status that does not exist", async () => {
    requireProject();
    const res = await request("owner", "/statuses/98765432");
    expect(res.status).toBe(404);
  });

  it("400s a malformed status id and 404s the id-less read", async () => {
    requireProject();

    // `resolveStatusRoute` passes a segment that is no id through unscoped, so
    // the route's own `idParam()` answers it, as on every id-addressed mount.
    const malformed = await request("owner", "/statuses/not-a-number");
    expect(malformed.status).toBe(400);

    // There is no bare read: `GET /projects/:id/statuses` is the list.
    const bare = await request("owner", "/statuses");
    expect(bare.status).toBe(404);
  });

  it("gates status writes by role", async () => {
    requireProject();
    const status = await mkStatus("Gated Status", 60);

    await expectAccess(
      "POST",
      "/statuses",
      { viewer: 403, editor: 201 },
      {
        name: uniqueStatusName("Editor Status"),
        percentage: 10,
        projectId: suite.projectId,
      }
    );
    await expectAccess(
      "PATCH",
      `/statuses/${status.id}`,
      { viewer: 403, editor: 200 },
      { name: uniqueStatusName("Editor Renamed Status") }
    );
    await expectAccess("DELETE", `/statuses/${status.id}`, {
      viewer: 403,
      editor: 204,
    });
  });
});
