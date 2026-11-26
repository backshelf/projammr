import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { and, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";
import {
  FIXTURE_ENV,
  registerFixtureSettings,
} from "../test/settings-fixture.js";

/**
 * The settings routes, driven through the app with the fixture group
 * registered beside the real ones (`test/settings-fixture.ts`), since no real
 * key yet takes a project value, needs an owner, is for admins' eyes only or
 * reads the environment.
 *
 * This file runs in the serial phase: it writes and locks instance rows, and
 * it replaces modules for its own run.
 */
await registerFixtureSettings();

const { SETTINGS } = await import("@workspace/settings");
const { app } = await import("../app.js");
const { db } = await import("../db/index.js");
const { users } = await import("../db/schema/auth.js");
const { instanceSettingValues, projectSettings, settingsAudit, userSettings } =
  await import("../db/schema/settings.js");
const {
  changedHubRowsSchema,
  effectiveSettingsSchema,
  forgetInstanceRows,
  hubRowsSchema,
  importReportSchema,
  settingsAuditPageSchema,
  settingsExportSchema,
} = await import("../db/queries/settings.js");
const { instanceSchema } = await import("./instance.js");
const { baseUrl, setupSuite, signUpAndSignIn } =
  await import("../test/fixtures.js");

type Actor = Awaited<ReturnType<typeof signUpAndSignIn>>;

const suite = setupSuite("Settings");
const { owner, editor, viewer, outsider } = suite;

/** An instance admin of the suite's own, promoted in the row. */
const admin = {} as Actor;

const actors = () =>
  [owner, editor, viewer, outsider, admin]
    .map((actor) => actor.userId)
    .filter((id): id is string => id !== undefined);

/** Every row the fixture keys hold, so each test starts from the defaults. */
async function clearFixtureRows() {
  await db
    .delete(instanceSettingValues)
    .where(like(instanceSettingValues.key, "fixture.%"));
  if (!suite.setUpFailed && suite.projectId !== undefined) {
    await db
      .delete(projectSettings)
      .where(eq(projectSettings.projectId, suite.projectId));
  }
  if (actors().length > 0) {
    await db.delete(userSettings).where(inArray(userSettings.userId, actors()));
  }
  forgetInstanceRows();
}

beforeAll(async () => {
  if (suite.setUpFailed) return;
  Object.assign(admin, await signUpAndSignIn("Settings Admin"));
  await db
    .update(users)
    .set({ instanceRole: "admin" })
    .where(eq(users.id, admin.userId));
});

beforeEach(clearFixtureRows);

afterAll(async () => {
  await clearFixtureRows();
  await db
    .delete(settingsAudit)
    .where(
      and(
        eq(settingsAudit.scope, "instance"),
        like(settingsAudit.key, "fixture.%")
      )
    );
  if (admin.userId !== undefined) {
    await db
      .update(users)
      .set({ instanceRole: "user" })
      .where(eq(users.id, admin.userId));
  }
});

const send = (actor: Actor, method: string, path: string, body?: unknown) =>
  suite.requestAs(actor, path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const project = () => `/settings/project/${suite.projectId}`;
const mine = (actor: Actor) => `/settings/user/${actor.userId}`;
const INSTANCE = "/settings/instance/instance";

/** Writes a patch, expecting it to land. */
async function write(actor: Actor, path: string, patch: object) {
  const res = await send(actor, "PATCH", path, patch);
  expect(res.status, `PATCH ${path} ${await res.clone().text()}`).toBe(200);
  return changedHubRowsSchema.parse(await res.json());
}

async function lock(actor: Actor, path: string, patch: object) {
  const res = await send(actor, "PUT", `${path}/locks`, patch);
  expect(res.status, `PUT ${path}/locks ${await res.clone().text()}`).toBe(200);
  return changedHubRowsSchema.parse(await res.json());
}

async function effective(actor: Actor, projectId?: number) {
  const res = await send(
    actor,
    "GET",
    `/settings/effective${projectId === undefined ? "" : `?project=${projectId}`}`
  );
  expect(res.status).toBe(200);
  return effectiveSettingsSchema.parse(await res.json());
}

type HubRow = {
  effective: unknown;
  source: string;
  lockedBy?: string;
  writable: Record<string, boolean | undefined>;
  lockable: Record<string, boolean | undefined>;
  values: Record<string, unknown>;
  updatedAt?: Record<string, string>;
};

async function hub(actor: Actor, projectId?: number) {
  const res = await send(
    actor,
    "GET",
    `/settings${projectId === undefined ? "" : `?project=${projectId}`}`
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  hubRowsSchema.parse(body);
  return body as Record<string, HubRow>;
}

/** The audit page's own schema, reading its timestamps back from the wire. */
const auditPageSchema = z.array(
  settingsAuditPageSchema.element.extend({ at: z.coerce.date() })
);

async function auditRows(actor: Actor, query: string) {
  const res = await send(actor, "GET", `/settings/audit?${query}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return auditPageSchema.parse(await res.json());
}

describe("GET /settings/effective", () => {
  it("resolves user over project over instance over env over the default", async () => {
    suite.requireProject();

    const sourceOf = async () =>
      (await hub(editor, suite.projectId))["fixture.layered"]!;

    expect(await sourceOf()).toMatchObject({
      effective: FIXTURE_ENV["fixture.layered"],
      source: "env",
    });

    await write(admin, INSTANCE, { "fixture.layered": "instance's" });
    expect(await sourceOf()).toMatchObject({
      effective: "instance's",
      source: "instance",
    });

    await write(owner, project(), { "fixture.layered": "project's" });
    expect(await sourceOf()).toMatchObject({
      effective: "project's",
      source: "project",
    });

    await write(editor, mine(editor), { "fixture.layered": "mine" });
    expect(
      (await effective(editor, suite.projectId)).values["fixture.layered"]
    ).toBe("mine");
    expect(await sourceOf()).toMatchObject({
      effective: "mine",
      source: "user",
    });

    // Without the project in view, its layer drops out.
    await write(editor, mine(editor), { "fixture.layered": null });
    expect((await effective(editor)).values["fixture.layered"]).toBe(
      "instance's"
    );

    // A key nothing sets and the environment does not seed.
    expect(
      (await hub(editor, suite.projectId))["fixture.projectOnly"]
    ).toMatchObject({ effective: 0, source: "default" });
  });

  it("changes its version when a value changes, and when a reset clears one", async () => {
    suite.requireProject();

    const before = await effective(editor);
    await write(editor, mine(editor), { "fixture.layered": "mine" });
    const written = await effective(editor);
    expect(written.version).not.toBe(before.version);

    await write(editor, mine(editor), { "fixture.layered": null });
    const reset = await effective(editor);
    expect(reset.version).not.toBe(written.version);
    expect(reset.version).toBe(before.version);
  });

  it("changes its version when a key's source moves without its value changing", async () => {
    suite.requireProject();

    await write(admin, INSTANCE, { "fixture.layered": "same" });
    const fromInstance = await effective(editor, suite.projectId);
    expect(fromInstance.values["fixture.layered"]).toBe("same");

    await write(owner, project(), { "fixture.layered": "same" });
    const fromProject = await effective(editor, suite.projectId);

    expect(fromProject.values["fixture.layered"]).toBe("same");
    expect(fromProject.version).not.toBe(fromInstance.version);
  });

  it("keeps the same version across reads when neither value nor source moves", async () => {
    suite.requireProject();
    await write(admin, INSTANCE, { "fixture.layered": "steady" });

    const first = await effective(editor, suite.projectId);
    const second = await effective(editor, suite.projectId);

    expect(second.version).toBe(first.version);
  });

  it("leaves admin-only settings out of a member's read", async () => {
    suite.requireProject();
    await write(admin, INSTANCE, { "fixture.adminOnly": true });

    expect((await effective(editor)).values).not.toHaveProperty(
      "fixture.adminOnly"
    );
    expect(await hub(editor)).not.toHaveProperty("fixture.adminOnly");
    expect((await effective(admin)).values["fixture.adminOnly"]).toBe(true);
    expect((await hub(admin))["fixture.adminOnly"]).toMatchObject({
      effective: true,
      source: "instance",
    });
  });

  it("gates the project it layers on membership", async () => {
    suite.requireProject();

    expect(
      (
        await send(
          outsider,
          "GET",
          `/settings/effective?project=${suite.projectId}`
        )
      ).status
    ).toBe(404);
    expect(
      (
        await send(
          viewer,
          "GET",
          `/settings/effective?project=${suite.projectId}`
        )
      ).status
    ).toBe(200);
    expect(
      (await suite.request("anonymous", "/settings/effective")).status
    ).toBe(401);
  });
});

describe("GET /settings", () => {
  it("says where each value comes from, what each scope holds, and where the caller may write", async () => {
    suite.requireProject();
    await write(admin, INSTANCE, { "fixture.layered": "instance's" });
    await write(owner, project(), { "fixture.layered": "project's" });
    await write(viewer, mine(viewer), { "fixture.layered": "mine" });

    const asViewer = await hub(viewer, suite.projectId);
    expect(asViewer["fixture.layered"]).toEqual({
      effective: "mine",
      source: "user",
      writable: { user: true, project: false, instance: false },
      lockable: { user: false, project: false, instance: false },
      values: { user: "mine", project: "project's", instance: "instance's" },
      updatedAt: {
        user: expect.any(String),
        project: expect.any(String),
        instance: expect.any(String),
      },
    });
    // An admin-role key: below the viewer's reach, and below an editor's.
    expect(asViewer["fixture.projectOnly"]!.writable).toEqual({
      project: false,
      instance: false,
    });

    const asEditor = await hub(editor, suite.projectId);
    expect(asEditor["fixture.layered"]!.writable).toEqual({
      user: true,
      project: true,
      instance: false,
    });
    expect(asEditor["fixture.projectOnly"]!.writable.project).toBe(false);

    expect(
      (await hub(owner, suite.projectId))["fixture.projectOnly"]!.writable
        .project
    ).toBe(true);
    // With no project named, the project scope is not addressable at all.
    expect((await hub(admin))["fixture.layered"]!.writable).toEqual({
      user: true,
      instance: true,
    });
  });

  it("offers a lock only to a role the scope's target lets lock, whatever the key's minRole", async () => {
    suite.requireProject();

    // An editor may write the layered key at the project, but only an admin or
    // owner may lock it there; nobody locks at the user scope.
    const asEditor = (await hub(editor, suite.projectId))["fixture.layered"]!;
    expect(asEditor.writable.project).toBe(true);
    expect(asEditor.lockable).toEqual({
      user: false,
      project: false,
      instance: false,
    });

    const asOwner = (await hub(owner, suite.projectId))["fixture.layered"]!;
    expect(asOwner.lockable).toEqual({
      user: false,
      project: true,
      instance: false,
    });

    // With no project named, only the scopes the read can address are stated;
    // an instance admin locks at the instance.
    expect((await hub(admin))["fixture.layered"]!.lockable).toEqual({
      user: false,
      instance: true,
    });
  });
});

describe("PATCH /settings/:scope/:id", () => {
  it("upserts a value and clears it with null", async () => {
    suite.requireProject();

    const written = await write(owner, project(), { "fixture.projectOnly": 3 });
    expect(written).toEqual({
      "fixture.projectOnly": {
        effective: 3,
        source: "project",
        writable: { project: true, instance: false },
        lockable: { project: true, instance: false },
        values: { project: 3 },
        updatedAt: { project: expect.any(String) },
      },
    });

    const rewritten = await write(owner, project(), {
      "fixture.projectOnly": 4,
    });
    expect(rewritten["fixture.projectOnly"]).toMatchObject({ effective: 4 });

    const cleared = await write(owner, project(), {
      "fixture.projectOnly": null,
    });
    expect(cleared["fixture.projectOnly"]).toMatchObject({
      effective: 0,
      source: "default",
      values: {},
    });
    const rows = await db
      .select()
      .from(projectSettings)
      .where(eq(projectSettings.projectId, suite.projectId));
    expect(rows).toHaveLength(0);
  });

  it("refuses a key the scope does not accept, an unknown key and an invalid value", async () => {
    suite.requireProject();

    for (const [path, patch] of [
      [mine(editor), { "fixture.projectOnly": 1 }],
      [project(), { "editor.rhymePrefix": "/" }],
      [INSTANCE, { "fixture.unknown": 1 }],
      [mine(editor), { "editor.rhymePrefix": "too long" }],
      [mine(editor), { "keybindings.client": { search: ["shift+1"] } }],
    ] as const) {
      const actor =
        path === INSTANCE ? admin : path === project() ? owner : editor;
      const res = await send(actor, "PATCH", path, patch);
      expect(res.status, JSON.stringify(patch)).toBe(400);
      expect(await res.json()).toMatchObject({ code: "invalid_request" });
    }
  });

  it("refuses a member below a key's minimum role with 403", async () => {
    suite.requireProject();

    expect(
      (await send(viewer, "PATCH", project(), { "fixture.layered": "x" }))
        .status
    ).toBe(403);
    expect(
      (await send(editor, "PATCH", project(), { "fixture.projectOnly": 1 }))
        .status
    ).toBe(403);
    // The editor clears `fixture.layered`'s bar, so the same write lands.
    await write(editor, project(), { "fixture.layered": "x" });
  });

  it("refuses a write the instance locks with 409, writing nothing", async () => {
    suite.requireProject();
    await lock(admin, INSTANCE, { "fixture.layered": true });
    const auditBefore = await auditRows(
      owner,
      `scope=project&id=${suite.projectId}`
    );

    for (const [actor, path, scope] of [
      [editor, mine(editor), "user"],
      [owner, project(), "project"],
    ] as const) {
      const res = await send(actor, "PATCH", path, {
        "fixture.layered": "over",
        "fixture.unlockable": "also",
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: "setting_locked",
        details: { scope, by: "instance", key: "fixture.layered" },
      });
    }

    expect(
      await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, editor.userId))
    ).toHaveLength(0);
    expect(
      await auditRows(owner, `scope=project&id=${suite.projectId}`)
    ).toEqual(auditBefore);

    // The admin still writes the locked key at the instance.
    await write(admin, INSTANCE, { "fixture.layered": "pinned" });
    expect(
      (await hub(editor, suite.projectId))["fixture.layered"]
    ).toMatchObject({
      effective: "pinned",
      lockedBy: "instance",
      writable: { user: false, project: false, instance: false },
    });
  });

  it("clears a value the instance's lock leaves inert, and still refuses a new one", async () => {
    suite.requireProject();
    await write(editor, mine(editor), { "fixture.layered": "mine" });
    await lock(admin, INSTANCE, { "fixture.layered": true });

    await write(editor, mine(editor), { "fixture.layered": null });
    expect(
      await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, editor.userId))
    ).toHaveLength(0);

    const res = await send(editor, "PATCH", mine(editor), {
      "fixture.layered": "again",
    });
    expect(res.status).toBe(409);
  });

  it("answers 404 for a scope the caller cannot address", async () => {
    suite.requireProject();

    const patch = { "fixture.layered": "x" };
    expect((await send(editor, "PATCH", mine(owner), patch)).status).toBe(404);
    expect((await send(outsider, "PATCH", project(), patch)).status).toBe(404);
    expect((await send(owner, "PATCH", INSTANCE, patch)).status).toBe(404);
    expect(
      (await send(admin, "PATCH", "/settings/instance/other", patch)).status
    ).toBe(404);
    expect(
      (
        await suite.request("anonymous", mine(editor), {
          method: "PATCH",
          body: JSON.stringify(patch),
        })
      ).status
    ).toBe(401);
  });

  it("lets the last of two concurrent writes win, recording each", async () => {
    suite.requireProject();

    const [first, second] = await Promise.all([
      send(owner, "PATCH", project(), { "fixture.projectOnly": 1 }),
      send(owner, "PATCH", project(), { "fixture.projectOnly": 2 }),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);

    const [latest, earlier] = await auditRows(
      owner,
      `scope=project&id=${suite.projectId}&limit=2`
    );
    expect(earlier).toMatchObject({ key: "fixture.projectOnly", old: null });
    expect(latest).toMatchObject({
      key: "fixture.projectOnly",
      old: earlier!.new,
    });
    expect(
      (await hub(owner, suite.projectId))["fixture.projectOnly"]!.effective
    ).toBe(latest!.new);
  });
});

describe("PUT /settings/:scope/:id/locks", () => {
  it("writes the effective value as the row when locking a key with none", async () => {
    suite.requireProject();
    await write(admin, INSTANCE, { "fixture.projectOnly": 7 });

    const locked = await lock(owner, project(), {
      "fixture.projectOnly": true,
    });
    expect(locked["fixture.projectOnly"]).toMatchObject({
      effective: 7,
      source: "project",
      lockedBy: "project",
      values: { project: 7, instance: 7 },
    });

    const [row] = await auditRows(owner, `scope=project&id=${suite.projectId}`);
    expect(row).toMatchObject({
      key: "fixture.projectOnly",
      old: null,
      new: 7,
      lockedBefore: false,
      lockedAfter: true,
      actor: { id: owner.userId },
    });

    // The locked row follows a later write at the locking scope.
    await write(owner, project(), { "fixture.projectOnly": 8 });
    expect(
      (await hub(editor, suite.projectId))["fixture.projectOnly"]
    ).toMatchObject({ effective: 8, lockedBy: "project" });
  });

  it("pins members' values inside the project and lets them go when unlocked", async () => {
    suite.requireProject();
    await write(editor, mine(editor), { "fixture.layered": "mine" });
    await write(owner, project(), { "fixture.layered": "house" });
    await lock(owner, project(), { "fixture.layered": true });

    expect(
      (await hub(editor, suite.projectId))["fixture.layered"]
    ).toMatchObject({
      effective: "house",
      source: "project",
      lockedBy: "project",
      writable: { user: false, project: true },
      values: { user: "mine", project: "house" },
    });
    // Outside the project the lock reaches nothing, so the write still lands.
    expect((await effective(editor)).values["fixture.layered"]).toBe("mine");
    await write(editor, mine(editor), { "fixture.layered": "still mine" });

    await lock(owner, project(), { "fixture.layered": false });
    expect(
      (await effective(editor, suite.projectId)).values["fixture.layered"]
    ).toBe("still mine");

    const [unlocked] = await auditRows(
      owner,
      `scope=project&id=${suite.projectId}`
    );
    expect(unlocked).toMatchObject({
      key: "fixture.layered",
      old: "house",
      new: "house",
      lockedBefore: true,
      lockedAfter: false,
    });
  });

  it("lets only a role that may lock clear a locked row, which lifts the lock", async () => {
    suite.requireProject();
    await write(owner, project(), { "fixture.layered": "house" });
    await lock(owner, project(), { "fixture.layered": true });

    // The key's minRole lets an editor write the locked row, never clear it.
    const refused = await send(editor, "PATCH", project(), {
      "fixture.layered": null,
    });
    expect(refused.status).toBe(403);
    await write(editor, project(), { "fixture.layered": "house, again" });
    expect(
      (await hub(editor, suite.projectId))["fixture.layered"]
    ).toMatchObject({ effective: "house, again", lockedBy: "project" });

    await write(owner, project(), { "fixture.layered": null });
    const cleared = (await hub(editor, suite.projectId))["fixture.layered"];
    expect(cleared?.lockedBy).toBeUndefined();
    expect(cleared?.values.project).toBeUndefined();
  });

  it("lets the instance's lock beat the project's", async () => {
    suite.requireProject();
    await write(owner, project(), { "fixture.layered": "house" });
    await lock(owner, project(), { "fixture.layered": true });
    await write(admin, INSTANCE, { "fixture.layered": "everyone's" });
    await lock(admin, INSTANCE, { "fixture.layered": true });

    expect(
      (await hub(owner, suite.projectId))["fixture.layered"]
    ).toMatchObject({
      effective: "everyone's",
      source: "instance",
      lockedBy: "instance",
    });
    // Under the instance's lock, the project cannot lift or set its own.
    const res = await send(owner, "PUT", `${project()}/locks`, {
      "fixture.layered": false,
    });
    expect(res.status).toBe(409);
  });

  it("refuses an unlockable key, a key the scope does not accept, and a member below admin", async () => {
    suite.requireProject();

    expect(
      (
        await send(owner, "PUT", `${project()}/locks`, {
          "fixture.unlockable": true,
        })
      ).status
    ).toBe(400);
    expect(
      (
        await send(admin, "PUT", `${INSTANCE}/locks`, {
          "instance-access.registration": true,
        })
      ).status
    ).toBe(400);
    expect(
      (
        await send(owner, "PUT", `${project()}/locks`, {
          "editor.rhymePrefix": true,
        })
      ).status
    ).toBe(400);
    expect(
      (
        await send(editor, "PUT", `${project()}/locks`, {
          "fixture.layered": true,
        })
      ).status
    ).toBe(403);
    expect(
      (
        await send(editor, "PUT", `${mine(editor)}/locks`, {
          "fixture.layered": true,
        })
      ).status
    ).toBe(404);
  });
});

describe("export and import", () => {
  it("round-trips a user's settings and reports every key it skips", async () => {
    suite.requireProject();
    await write(editor, mine(editor), {
      "editor.rhymePrefix": "/",
      "fixture.layered": "mine",
    });

    const exported = await send(editor, "GET", `${mine(editor)}/export`);
    expect(exported.status).toBe(200);
    const file = settingsExportSchema.parse(await exported.json());
    expect(file.values).toEqual({
      "editor.rhymePrefix": "/",
      "fixture.layered": "mine",
    });
    expect((await send(viewer, "GET", `${mine(editor)}/export`)).status).toBe(
      404
    );

    await write(admin, INSTANCE, { "fixture.unlockable": "x" });
    await write(admin, INSTANCE, { "fixture.layered": "pinned" });
    await lock(admin, INSTANCE, { "fixture.layered": true });
    const withExtras = {
      ...file,
      values: {
        ...file.values,
        "nobody.knows": 1,
        "fixture.projectOnly": 2,
        "editor.synonymPrefix": "much too long",
      },
    };
    // Skipped in the file's own order, which an export writes in the
    // registry's.
    const expected: ReturnType<typeof importReportSchema.parse> = {
      applied: ["editor.rhymePrefix"],
      skipped: [
        { key: "fixture.layered", reason: "locked" },
        { key: "nobody.knows", reason: "unknown" },
        { key: "fixture.projectOnly", reason: "scope" },
        { key: "editor.synonymPrefix", reason: "invalid" },
      ],
    };

    const dryRun = await send(
      viewer,
      "POST",
      `${mine(viewer)}/import?dryRun=1`,
      withExtras
    );
    expect(dryRun.status).toBe(200);
    expect(importReportSchema.parse(await dryRun.json())).toEqual(expected);
    expect((await effective(viewer)).values["editor.rhymePrefix"]).toBe("\\");

    const applied = await send(
      viewer,
      "POST",
      `${mine(viewer)}/import`,
      withExtras
    );
    expect(await applied.json()).toEqual(expected);
    expect((await effective(viewer)).values["editor.rhymePrefix"]).toBe("/");

    expect(
      (await send(viewer, "POST", `${mine(editor)}/import`, withExtras)).status
    ).toBe(404);
    expect(
      (
        await send(viewer, "POST", `${mine(viewer)}/import`, {
          values: {},
        })
      ).status
    ).toBe(400);
  });
});

describe("GET /settings/audit", () => {
  it("records a project's writes newest first, a page at a time", async () => {
    suite.requireProject();
    for (const value of [1, 2, 3]) {
      await write(owner, project(), { "fixture.projectOnly": value });
    }
    // Writing the value already stored changes nothing and records nothing.
    await write(owner, project(), { "fixture.projectOnly": 3 });

    const first = await auditRows(
      owner,
      `scope=project&id=${suite.projectId}&limit=2`
    );
    expect(first.map(({ old, new: to }) => [old, to])).toEqual([
      [2, 3],
      [1, 2],
    ]);
    expect(first[0]).toMatchObject({
      scope: "project",
      scopeId: String(suite.projectId),
      actor: { id: owner.userId, name: owner.name },
    });

    const next = await auditRows(
      owner,
      `scope=project&id=${suite.projectId}&limit=2&before=${first[1]!.id}`
    );
    expect(next[0]).toMatchObject({ old: null, new: 1 });
  });

  it("records an instance write and a lock change", async () => {
    suite.requireProject();
    await write(admin, INSTANCE, { "fixture.adminOnly": true });
    await lock(admin, INSTANCE, { "fixture.adminOnly": true });

    const [locked, written] = await auditRows(admin, "scope=instance&limit=2");
    expect(written).toMatchObject({
      scope: "instance",
      scopeId: null,
      key: "fixture.adminOnly",
      old: null,
      new: true,
      lockedBefore: false,
      lockedAfter: false,
      actor: { id: admin.userId },
    });
    expect(locked).toMatchObject({
      key: "fixture.adminOnly",
      old: true,
      new: true,
      lockedBefore: false,
      lockedAfter: true,
    });
  });

  it("is for a project's owner and admins, and the instance's admins", async () => {
    suite.requireProject();
    const query = `/settings/audit?scope=project&id=${suite.projectId}`;
    expect((await send(editor, "GET", query)).status).toBe(403);
    expect((await send(outsider, "GET", query)).status).toBe(404);
    expect(
      (await send(owner, "GET", "/settings/audit?scope=instance")).status
    ).toBe(404);
    expect((await send(owner, "GET", "/settings/audit")).status).toBe(400);
  });
});

describe("GET /api/instance", () => {
  it("carries the public settings and nothing else", async () => {
    suite.requireProject();
    await write(admin, INSTANCE, { "fixture.layered": "not public" });

    const res = await app.request(`${baseUrl}/instance`);
    const body = instanceSchema.parse(await res.json());
    const publicDefaults = Object.fromEntries(
      Object.values(SETTINGS)
        .filter(({ audience }) => audience === "public")
        .map((definition) => [definition.key, definition.default])
    );
    expect(body.settings).toEqual({
      ...publicDefaults,
      "instance-access.registration": body.registration,
    });
  });
});
