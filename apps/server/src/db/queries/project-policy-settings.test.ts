import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { eq, like, or } from "drizzle-orm";
import { db } from "../index.js";
import { users } from "../schema/auth.js";
import { instanceSettingValues, projectSettings } from "../schema/settings.js";
import { sharelinks } from "../schema/sharelinks.js";
import { trackAudios } from "../schema/tracks.js";
import {
  setupSuite,
  signUpAndSignIn,
  type Actor,
} from "../../test/fixtures.js";
import { findDuplicateAudio } from "./assets.js";
import { DEFAULT_PROJECT_POLICY, projectPolicy } from "./project-policy.js";
import { forgetInstanceRows } from "./settings.js";

/**
 * A project's policy as its settings give it, read through the consumers that
 * act on it. This file runs in the serial phase: it writes and locks instance
 * rows, which every other file's policy reads would see.
 */

const suite = setupSuite("Project policy settings");
const { owner, requireProject, request, requestAs } = suite;

const admin = {} as Actor;

const project = () => `/settings/project/${suite.projectId}`;
const INSTANCE = "/settings/instance/instance";

/** Writes a patch through the settings route, expecting it to land. */
async function write(actor: Actor, path: string, patch: object) {
  const res = await requestAs(actor, path, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  expect(res.status, `PATCH ${path} ${await res.clone().text()}`).toBe(200);
}

async function lock(path: string, patch: object) {
  const res = await requestAs(admin, `${path}/locks`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
  expect(res.status, `PUT ${path}/locks ${await res.clone().text()}`).toBe(200);
}

const setProject = (patch: object) => write(owner, project(), patch);
const setInstance = (patch: object) => write(admin, INSTANCE, patch);

/** Every row these tests write, so each one starts from the defaults. */
async function clearRows() {
  await db
    .delete(instanceSettingValues)
    .where(
      or(
        like(instanceSettingValues.key, "project-%"),
        eq(instanceSettingValues.key, "instance-limits.projectCapGb")
      )
    );
  if (!suite.setUpFailed) {
    await db
      .delete(projectSettings)
      .where(eq(projectSettings.projectId, suite.projectId));
  }
  forgetInstanceRows();
}

beforeAll(async () => {
  if (suite.setUpFailed) return;
  Object.assign(admin, await signUpAndSignIn("Project Policy Admin"));
  await db
    .update(users)
    .set({ instanceRole: "admin" })
    .where(eq(users.id, admin.userId));
});

beforeEach(clearRows);

afterAll(async () => {
  await clearRows();
  if (admin.userId !== undefined) {
    await db
      .update(users)
      .set({ instanceRole: "user" })
      .where(eq(users.id, admin.userId));
  }
});

describe("the project policy's layers", () => {
  it("is the registry's defaults for a project and an instance that store nothing", async () => {
    requireProject();
    expect(await projectPolicy(suite.projectId)).toEqual(
      DEFAULT_PROJECT_POLICY
    );
  });

  it("takes the instance's value where the project has none, and the project's over it", async () => {
    requireProject();
    await setInstance({ "project-defaults.explicit": true });
    expect((await projectPolicy(suite.projectId)).defaults.explicit).toBe(true);

    await setProject({ "project-defaults.explicit": false });
    expect((await projectPolicy(suite.projectId)).defaults.explicit).toBe(
      false
    );
  });

  it("lets an instance lock beat the project's row", async () => {
    requireProject();
    await setProject({ "project-defaults.explicit": false });
    await setInstance({ "project-defaults.explicit": true });
    await lock(INSTANCE, { "project-defaults.explicit": true });

    expect((await projectPolicy(suite.projectId)).defaults.explicit).toBe(true);
  });

  it("reads the MP3 bitrate, a string in the registry, as a number", async () => {
    requireProject();
    await setProject({ "project-audio.mp3Kbps": "128" });
    expect((await projectPolicy(suite.projectId)).audio.mp3Kbps).toBe(128);
  });

  it("hands each read its own copy of a stored list", async () => {
    requireProject();
    await setProject({ "project-defaults.artists": ["Nova"] });
    const first = await projectPolicy(suite.projectId);
    first.defaults.artists.push("Changed");

    expect((await projectPolicy(suite.projectId)).defaults.artists).toEqual([
      "Nova",
    ]);
  });
});

describe("the consumers of the project policy", () => {
  it("gives a new track the project's default status, artists and explicit flag", async () => {
    requireProject();
    const status = await suite.mkStatus("Policy default");
    await setProject({
      "project-defaults.trackStatusId": status.id,
      "project-defaults.artists": ["Nova", "Kestrel"],
      "project-defaults.explicit": true,
    });

    const res = await request("owner", "/tracks", {
      method: "POST",
      body: JSON.stringify({
        title: "Defaulted",
        projectId: suite.projectId,
      }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      statusId: status.id,
      artists: ["Nova", "Kestrel"],
      explicit: true,
    });
  });

  it("refuses an invite from a role below the project's who-may-invite", async () => {
    requireProject();
    const invite = (email: string) =>
      request("editor", `/projects/${suite.projectId}/invites`, {
        method: "POST",
        body: JSON.stringify({ email }),
      });

    const refused = await invite("below-the-bar@example.com");
    expect(refused.status).toBe(403);

    await setProject({ "project-sharing.whoMayInvite": "editor" });
    const allowed = await invite("at-the-bar@example.com");
    expect(allowed.status).toBe(201);
  });

  it("gives a new share link the project's share defaults", async () => {
    requireProject();
    const trackId = await suite.mkTrack("Shared with defaults");
    const asset = await suite.uploadAsset("Shared with defaults.jpeg");
    await db
      .insert(trackAudios)
      .values({ trackId, assetId: asset.id, version: 1, isPrimary: true });
    await setProject({
      "project-sharing.shareCommentPrivacy": "private",
      "project-sharing.shareDownloads": true,
      "project-sharing.shareExpiresDays": 3,
    });

    const before = Date.now();
    const res = await request("owner", "/share/connected", {
      method: "POST",
      body: JSON.stringify({ entityType: "track", entityId: trackId }),
    });
    expect(res.status).toBe(201);
    const { token } = (await res.json()) as { token: string };

    const [link] = await db
      .select()
      .from(sharelinks)
      .where(eq(sharelinks.token, token));
    expect(link?.isCommentsPrivate).toBe(true);
    expect(link?.isDownloadsEnabled).toBe(true);
    const days = (link!.expiresAt!.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(2.99);
    expect(days).toBeLessThan(3.01);
  });

  it("groups exports as far apart as the project's same-bounce window", async () => {
    requireProject();
    const minute = 60 * 1000;
    const bounceAt = Date.UTC(2026, 0, 1, 12);
    const folder = `/Users/producer/Bounces/policy-${Date.now()}/`;
    const scanned = (name: string, minutesIn: number) =>
      suite.uploadAsset(name, {
        localFilepath: `${folder}${name}`,
        localFileMachineName: "Studio Mac",
        localFileUpdatedAt: String(bounceAt + minutesIn * minute),
      });
    const wav = await scanned("Windowed.wav", 0);
    const mp3 = await scanned("Windowed.mp3", 5);
    const groupOf = async () =>
      (await findDuplicateAudio(suite.projectId)).find((group) =>
        [group.kept, ...group.remove].some((file) => file.id === wav.id)
      );

    expect(await groupOf()).toBeUndefined();

    await setProject({ "project-audio.sameBounceWindowMinutes": 10 });
    expect((await groupOf())?.remove.map((file) => file.id)).toEqual([mp3.id]);
  });
});

describe("a project's storage cap against the instance's", () => {
  const capBody = (gb: number | null) => ({
    "project-audio.storageCapGb": gb,
  });
  const setCap = (gb: number | null) =>
    requestAs(owner, project(), {
      method: "PATCH",
      body: JSON.stringify(capBody(gb)),
    });

  it("refuses a cap above the instance's with a 400 that does not name the instance's cap", async () => {
    requireProject();
    await setInstance({ "instance-limits.projectCapGb": 17 });

    const res = await setCap(18);
    expect(res.status).toBe(400);
    const body: unknown = await res.json();
    expect(body).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [{ path: ["project-audio.storageCapGb"] }],
      },
    });
    // The envelope's random `requestId` holds "17" in about one run in nine,
    // so the cap is looked for in everything but it.
    expect(
      JSON.stringify(body, (key, value: unknown) =>
        key === "requestId" ? undefined : value
      )
    ).not.toContain("17");
    expect(
      await db
        .select()
        .from(projectSettings)
        .where(eq(projectSettings.projectId, suite.projectId))
    ).toHaveLength(0);
  });

  it("takes a cap at or below the instance's", async () => {
    requireProject();
    await setInstance({ "instance-limits.projectCapGb": 17 });

    expect((await setCap(17)).status).toBe(200);
    expect((await setCap(4)).status).toBe(200);
  });

  it("takes any cap while the instance has none", async () => {
    requireProject();
    expect((await setCap(500)).status).toBe(200);
  });

  it("still takes other writes once the instance's cap drops below the project's", async () => {
    requireProject();
    expect((await setCap(40)).status).toBe(200);
    await setInstance({ "instance-limits.projectCapGb": 17 });

    await setProject({ "project-conventions.quietAfterDays": 12 });
    expect((await setCap(18)).status).toBe(400);
  });

  it("takes no cap under an instance that has one", async () => {
    requireProject();
    await setInstance({ "instance-limits.projectCapGb": 17 });
    expect((await setCap(null)).status).toBe(200);
  });
});
