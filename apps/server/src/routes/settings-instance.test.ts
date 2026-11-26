import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { stubEnv } from "@workspace/test/env";
import { and, eq, inArray } from "drizzle-orm";
import { unlink } from "node:fs/promises";

/**
 * The Instance settings as the server lives by them: the `env` layer a seed
 * variable fills, the policy a write refreshes in the writing process, the
 * value a restart-required setting runs with, and the pairs a write may not
 * leave out of order. Driven through the app with `MAX_UPLOAD_MB` seeding the
 * upload limit, set here before anything reads the policy.
 *
 * This file runs in the serial phase: it writes the instance's own rows.
 */
stubEnv("MAX_UPLOAD_MB", "40");
stubEnv("MAX_PROJECT_GB", undefined);

const { app } = await import("../app.js");
const { db } = await import("../db/index.js");
const { users } = await import("../db/schema/auth.js");
const { instanceSettingValues, settingsAudit } =
  await import("../db/schema/settings.js");
const {
  changedHubRowsSchema,
  forgetInstanceRows,
  hubRowsSchema,
  reloadInstanceSettings,
} = await import("../db/queries/settings.js");
const { DEFAULT_INSTANCE_POLICY, instancePolicy, runningInstancePolicy } =
  await import("../lib/instance-policy.js");
const { redirectLogs } = await import("../lib/log.js");
const { instanceSchema } = await import("./instance.js");
const { restoreInstancePolicy } = await import("../test/instance-policy.js");
const { images } = await import("../db/schema/images.js");
const {
  baseUrl,
  onDiskPath,
  servedAt,
  setupSuite,
  signInAsGuest,
  testImage,
  trustedOrigin,
} = await import("../test/fixtures.js");

const suite = setupSuite("Instance settings");

/** The suite's owner, promoted to instance admin in the row for this file's run. */
const admin = suite.owner;

const INSTANCE = "/settings/instance/instance";

/** Every key this file writes, cleared after each test so the next starts from the defaults. */
const WRITTEN = [
  "instance-limits.maxUploadMb",
  "instance-access.guestAccess",
  "instance-access.passwordMin",
  "instance-access.passwordMax",
  "instance-access.sessionLifetimeDays",
  "instance-rate-limits.auth-signin.burst",
  "instance-branding.name",
  "instance-branding.logoImageId",
];

async function clearWritten() {
  await db
    .delete(instanceSettingValues)
    .where(inArray(instanceSettingValues.key, WRITTEN));
  forgetInstanceRows();
  restoreInstancePolicy();
}

beforeAll(async () => {
  if (suite.setUpFailed) return;
  await db
    .update(users)
    .set({ instanceRole: "admin" })
    .where(eq(users.id, admin.userId));
});

afterEach(clearWritten);

afterAll(async () => {
  await clearWritten();
  await db
    .delete(settingsAudit)
    .where(
      and(
        eq(settingsAudit.scope, "instance"),
        inArray(settingsAudit.key, WRITTEN)
      )
    );
  if (admin.userId !== undefined) {
    await db
      .update(users)
      .set({ instanceRole: "user" })
      .where(eq(users.id, admin.userId));
  }
});

const patch = (body: object) =>
  suite.requestAs(admin, INSTANCE, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

/** Writes a patch, expecting it to land, and returns the rows it answered with. */
async function write(body: object) {
  const res = await patch(body);
  expect(res.status, await res.clone().text()).toBe(200);
  return changedHubRowsSchema.parse(await res.json()) as Record<string, HubRow>;
}

type HubRow = {
  effective: unknown;
  source: string;
  values: Record<string, unknown>;
  running?: unknown;
};

async function hub() {
  const res = await suite.requestAs(admin, "/settings");
  expect(res.status).toBe(200);
  const body = await res.json();
  hubRowsSchema.parse(body);
  return body as Record<string, HubRow>;
}

const storedKeys = async () =>
  (
    await db
      .select({ key: instanceSettingValues.key })
      .from(instanceSettingValues)
      .where(inArray(instanceSettingValues.key, WRITTEN))
  ).map(({ key }) => key);

describe("the env layer", () => {
  it("reports a seeded key with no row as the environment's, and an unseeded one as the default's", async () => {
    suite.requireProject();
    const rows = await hub();

    expect(rows["instance-limits.maxUploadMb"]).toMatchObject({
      effective: 40,
      source: "env",
      values: {},
    });
    expect(rows["instance-limits.projectCapGb"]).toMatchObject({
      effective: null,
      source: "default",
    });
    expect(instancePolicy().limits.maxUploadMb).toBe(40);
  });

  it("lets a stored row win over the environment, and a reset return to it", async () => {
    suite.requireProject();

    const stored = await write({ "instance-limits.maxUploadMb": 64 });
    expect(stored["instance-limits.maxUploadMb"]).toMatchObject({
      effective: 64,
      source: "instance",
    });
    expect(instancePolicy().limits.maxUploadMb).toBe(64);

    const reset = await write({ "instance-limits.maxUploadMb": null });
    expect(reset["instance-limits.maxUploadMb"]).toMatchObject({
      effective: 40,
      source: "env",
      values: {},
    });
    expect(instancePolicy().limits.maxUploadMb).toBe(40);
  });
});

describe("an instance write", () => {
  it("refreshes the writing process's policy before it answers", async () => {
    suite.requireProject();

    await write({
      "instance-access.guestAccess": false,
      "instance-rate-limits.auth-signin.burst": 4,
    });

    expect(instancePolicy().access.guestAccess).toBe(false);
    expect(instancePolicy().rateLimits["auth-signin"].burst).toBe(4);
    const instance = instanceSchema.parse(
      await (await app.request(`${baseUrl}/instance`)).json()
    );
    expect(instance.guestAccess).toBe(false);
    expect(instance.settings["instance-access.guestAccess"]).toBe(false);
  });

  it("refuses a pair out of order with a 400 naming both settings, and writes nothing", async () => {
    suite.requireProject();
    await write({ "instance-access.passwordMax": 20 });

    for (const body of [
      { "instance-access.passwordMin": 30 },
      { "instance-access.passwordMin": 30, "instance-access.passwordMax": 12 },
    ]) {
      const res = await patch(body);
      expect(res.status).toBe(400);
      const error = await res.json();
      expect(error.code).toBe("invalid_request");
      expect(error.error).toBe(
        "Shortest password must not be more than the longest password"
      );
      expect(
        error.details.issues.map(({ path }: { path: string[] }) => path[0])
      ).toEqual(["instance-access.passwordMin", "instance-access.passwordMax"]);
    }

    expect(await storedKeys()).toEqual(["instance-access.passwordMax"]);
    expect(instancePolicy().access).toMatchObject({
      passwordMin: 8,
      passwordMax: 20,
    });
  });

  it("takes a bucket at its floor and refuses one below it, naming the floor", async () => {
    suite.requireProject();

    await write({ "instance-rate-limits.auth-signin.burst": 3 });
    expect(instancePolicy().rateLimits["auth-signin"].burst).toBe(3);

    const res = await patch({ "instance-rate-limits.auth-signin.burst": 2 });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain(
      "At least 3: lower could lock people out"
    );
  });

  it("clears every advanced key it names in one patch of nulls", async () => {
    suite.requireProject();
    await write({ "instance-rate-limits.auth-signin.burst": 4 });

    const rows = await write({
      "instance-rate-limits.auth-signin.burst": null,
      "instance-rate-limits.auth-signin.perMinute": null,
      "instance-rate-limits.mcp.burst": null,
    });

    expect(rows["instance-rate-limits.auth-signin.burst"]).toMatchObject({
      effective: 10,
      source: "default",
    });
    expect(instancePolicy().rateLimits["auth-signin"]).toEqual(
      DEFAULT_INSTANCE_POLICY.rateLimits["auth-signin"]
    );
    expect(await storedKeys()).toEqual([]);
  });
});

describe("a restart-required setting", () => {
  it("reports the value the server runs with, however often it changed since", async () => {
    suite.requireProject();
    const booted = runningInstancePolicy().access.sessionLifetimeDays;

    const before = await hub();
    expect(before["instance-access.sessionLifetimeDays"]).toMatchObject({
      effective: booted,
      running: booted,
    });
    expect(before["instance-integrations.mcpEnabled"]?.running).toBe(
      runningInstancePolicy().integrations.mcpEnabled
    );
    expect(before["instance-integrations.mcpEnabled"]).not.toHaveProperty(
      "deploymentOff"
    );
    expect(before["instance-access.guestAccess"]).not.toHaveProperty("running");

    await write({ "instance-access.sessionLifetimeDays": booted + 7 });
    const rows = await write({
      "instance-access.sessionLifetimeDays": booted + 23,
    });

    expect(rows["instance-access.sessionLifetimeDays"]).toMatchObject({
      effective: booted + 23,
      running: booted,
    });
    expect(instancePolicy().access.sessionLifetimeDays).toBe(booted + 23);
    expect(runningInstancePolicy().access.sessionLifetimeDays).toBe(booted);
  });
});

describe("reloadInstanceSettings", () => {
  it("picks up a row another process wrote", async () => {
    suite.requireProject();
    await db
      .insert(instanceSettingValues)
      .values({ key: "instance-access.guestAccess", value: false });
    expect(instancePolicy().access.guestAccess).toBe(true);

    await reloadInstanceSettings();

    expect(instancePolicy().access.guestAccess).toBe(false);
  });

  it("keeps the policy it has when the stored rows cannot make one, and logs why", async () => {
    suite.requireProject();
    await db.insert(instanceSettingValues).values([
      { key: "instance-access.passwordMin", value: 100 },
      { key: "instance-access.passwordMax", value: 50 },
    ]);
    const before = instancePolicy();
    const lines: string[] = [];
    const restore = redirectLogs((line) => lines.push(line), "error");

    try {
      await reloadInstanceSettings();
    } finally {
      restore();
    }

    expect(instancePolicy()).toBe(before);
    expect(lines.join("")).toContain("could not refresh the instance settings");
  });
});

describe("GET /api/instance", () => {
  it("carries the brand from the settings", async () => {
    suite.requireProject();
    const read = async () =>
      instanceSchema.parse(
        await (await app.request(`${baseUrl}/instance`)).json()
      );

    expect((await read()).brand).toEqual({
      name: "Projammr",
      logoImageId: null,
      iconImageId: null,
      themeColour: "#080808",
      backgroundColour: "#080808",
      logoImagePath: null,
      iconImagePath: null,
    });

    await write({ "instance-branding.name": "Night Shift" });

    const named = await read();
    expect(named.brand.name).toBe("Night Shift");
    expect(named.settings["instance-branding.name"]).toBe("Night Shift");
  });

  it("gives a brand image's path while the image exists, and none once it is gone", async () => {
    suite.requireProject();
    const image = await uploadBrandImage();
    await write({ "instance-branding.logoImageId": image.id });

    const set = instanceSchema.parse(
      await (await app.request(`${baseUrl}/instance`)).json()
    );
    expect(set.brand).toMatchObject({
      logoImageId: image.id,
      logoImagePath: image.assetPath,
      iconImagePath: null,
    });

    await deleteBrandImage(image.id);
    const gone = instanceSchema.parse(
      await (await app.request(`${baseUrl}/instance`)).json()
    );
    expect(gone.brand).toMatchObject({
      logoImageId: image.id,
      logoImagePath: null,
    });
  });
});

/** Uploads an image of the instance's own as `cookie`, the admin's by default. */
function postBrandImage(cookie?: string) {
  return testImage().then((bytes) => {
    const form = new FormData();
    form.append("file", new File([bytes], "mark.jpeg", { type: "image/jpeg" }));
    return app.request(`${baseUrl}/images/instance`, {
      method: "POST",
      headers: {
        Origin: trustedOrigin,
        ...(cookie === undefined ? {} : { Cookie: cookie }),
      },
      body: form,
    });
  });
}

async function uploadBrandImage() {
  const res = await postBrandImage(admin.cookie);
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as {
    id: number;
    assetPath: string;
    scope: string;
    projectId: number | null;
    variantsJobId: number | null;
  };
}

async function deleteBrandImage(id: number) {
  const res = await suite.requestAs(admin, `/images/${id}`, {
    method: "DELETE",
  });
  expect(res.status).toBe(204);
}

describe("brand images", () => {
  it("are uploaded by an instance admin only, and stored as the instance's", async () => {
    suite.requireProject();

    expect((await postBrandImage()).status).toBe(401);
    expect((await postBrandImage(suite.editor.cookie)).status).toBe(404);

    const image = await uploadBrandImage();
    expect(image).toMatchObject({
      scope: "instance",
      projectId: null,
      variantsJobId: null,
    });

    const byMember = await suite.requestAs(
      suite.editor,
      `/images/${image.id}`,
      {
        method: "DELETE",
      }
    );
    expect(byMember.status).toBe(403);
    await deleteBrandImage(image.id);
  });

  it("are served to anyone, while project images and avatars keep their gates", async () => {
    suite.requireProject();
    const brand = await uploadBrandImage();
    const cover = await suite.uploadImage("cover.jpeg");
    const avatar = await suite.uploadAvatar("face.jpeg");
    const guest = await signInAsGuest();
    const read = async (assetPath: string, cookie?: string, query = "") => {
      const res = await app.request(`${servedAt(assetPath)}${query}`, {
        headers: cookie === undefined ? {} : { Cookie: cookie },
      });
      return res.status;
    };

    try {
      expect(await read(brand.assetPath)).toBe(200);
      expect(await read(brand.assetPath, undefined, "?w=256")).toBe(200);
      expect(await read(brand.assetPath, guest)).toBe(200);
      expect(await read(brand.assetPath, suite.outsider.cookie)).toBe(200);

      expect(await read(cover.assetPath)).toBe(401);
      expect(await read(cover.assetPath, guest)).toBe(403);
      expect(await read(cover.assetPath, suite.outsider.cookie)).toBe(403);
      expect(await read(cover.assetPath, suite.viewer.cookie)).toBe(200);

      expect(await read(avatar.assetPath)).toBe(401);
      expect(await read(avatar.assetPath, guest)).toBe(403);
      expect(await read(avatar.assetPath, suite.outsider.cookie)).toBe(200);

      expect(await read("images/no-such-image.jpeg", guest)).toBe(403);
      expect(await read("images/no-such-image.jpeg")).toBe(404);
    } finally {
      await deleteBrandImage(brand.id);
      // An avatar belongs to no project, so no project delete reaps it.
      await db.delete(images).where(eq(images.id, avatar.id));
      await unlink(onDiskPath(avatar.assetPath));
    }
  });
});
