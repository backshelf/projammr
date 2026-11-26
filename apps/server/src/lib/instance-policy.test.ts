import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { SETTINGS, type SettingDefinition } from "@workspace/settings";
import { MAX_UPLOAD_CEILING_MB } from "@workspace/settings/bounds";
import {
  AUDIO_EXTENSIONS,
  IMAGE_TYPES,
} from "@workspace/settings/groups/instance-limits";
import { stubEnv, unstubAllEnvs } from "@workspace/test/env";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";
import {
  DEFAULT_INSTANCE_POLICY,
  instancePolicy,
  MAX_REQUEST_BODY_BYTES,
  onInstancePolicyChange,
  policySource,
  refreshInstancePolicy,
  SEED_VARIABLES,
  settingsRefusedBy,
  settingValueIn,
  uploadLimitBytes,
} from "./instance-policy.js";

// Each seed case reloads the module against a stubbed environment; letting the
// real `.env` load would put the developer's own values back on every reload.
mock.module("dotenv/config", () => ({}));

const MIB = 1024 * 1024;

/** The variables the policy is seeded from, all unset. */
const SEEDS = [
  "MAX_UPLOAD_MB",
  "MAX_PROJECT_GB",
  "MAX_USER_GB",
  "MEDIA_CONCURRENCY",
  "SAVE_CONTENT_RETENTION_DAYS",
  "LOG_LEVEL",
];

/**
 * A fresh copy of the module, seeded from `vars`. The copy is its own
 * snapshot: the statically imported one the rest of the server reads is left
 * alone.
 */
async function loadPolicy(vars: Record<string, string | undefined>) {
  delete require.cache[require.resolve("./instance-policy.js")];
  for (const [key, value] of Object.entries(vars)) stubEnv(key, value);
  return import("./instance-policy.js");
}

describe("DEFAULT_INSTANCE_POLICY", () => {
  beforeEach(() => {
    for (const name of SEEDS) stubEnv(name, undefined);
  });

  afterEach(() => {
    unstubAllEnvs();
  });

  it("carries today's constants when no seed variable is set", async () => {
    const { DEFAULT_INSTANCE_POLICY: seeded } = await loadPolicy({});

    expect(seeded).toEqual({
      access: {
        closeAfterFirst: true,
        invitesBypass: true,
        requireVerifiedEmail: true,
        sessionLifetimeDays: 7,
        passwordMin: 8,
        passwordMax: 128,
        lockoutFreeFailures: 5,
        lockoutBaseMinutes: 1,
        lockoutMaxMinutes: 60,
        linkLifetimeMinutes: 60,
        guestAccess: true,
        selfDeletion: true,
      },
      limits: {
        maxUploadMb: 128,
        projectCapGb: null,
        userCapGb: null,
        audioTypes: [...AUDIO_EXTENSIONS],
        imageTypes: [...IMAGE_TYPES],
        auditIntervalHours: 24,
        orphanMode: "delete",
        guestRetentionDays: 30,
        longestAudioHours: 6,
        pushSamplesEverywhere: false,
      },
      jobs: {
        analysisWorkers: 2,
        jobRetentionDays: 7,
        activityRetentionDays: null,
        saveContentRetentionDays: 90,
      },
      integrations: {
        mcpEnabled: true,
        mcpToolGroups: ["read", "write"],
        logLevel: "info",
        updateCheck: false,
      },
      rateLimits: {
        moves: { burst: 10, perMinute: 20 },
        "bulk-moves": { burst: 5, perMinute: 10 },
        "session-moves": { burst: 10, perMinute: 20 },
        "audio-backfill": { burst: 5, perMinute: 10 },
        "share-read": { burst: 60, perMinute: 120 },
        "share-stream": { burst: 20, perMinute: 60 },
        "share-comment": { burst: 5, perMinute: 10 },
        "device-heartbeat": { burst: 10, perMinute: 10 },
        "email-change": { burst: 5, perMinute: 10 },
        "notes-save": { burst: 60, perMinute: 120 },
        "lyrics-analyze": { burst: 60, perMinute: 120 },
        "settings-write": { burst: 60, perMinute: 120 },
        "image-upload": { burst: 100, perMinute: 300 },
        upload: { burst: 100, perMinute: 300 },
        "repo-objects": { burst: 100, perMinute: 300 },
        "repo-archive": { burst: 10, perMinute: 10 },
        convert: { burst: 10, perMinute: 10 },
        "oauth-register": { burst: 5, perMinute: 5 },
        "auth-signin": { burst: 10, perMinute: 20 },
        "auth-signup": { burst: 5, perMinute: 5 },
        "guest-signin": { burst: 5, perMinute: 10 },
        "device-signin": { burst: 5, perMinute: 10 },
        mcp: { burst: 60, perMinute: 120 },
      },
    });
  });

  it("is the settings' own defaults when no seed variable is set", async () => {
    const { DEFAULT_INSTANCE_POLICY: seeded, SEEDED_SETTINGS } =
      await loadPolicy({});

    expect(seeded).toEqual(
      policySource((definition) => definition.default) as typeof seeded
    );
    expect(SEEDED_SETTINGS).toEqual({});
  });

  it("names exactly the variables it reads as the settings they seed", () => {
    expect(SEED_VARIABLES.map(({ variable }) => variable).sort()).toEqual(
      [...SEEDS].sort()
    );
    expect(SEED_VARIABLES).toContainEqual({
      variable: "MAX_UPLOAD_MB",
      key: "instance-limits.maxUploadMb",
    });
  });

  it("holds a seeded setting in the env layer only while its variable is set", async () => {
    const { SEEDED_SETTINGS } = await loadPolicy({
      MAX_UPLOAD_MB: "40",
      LOG_LEVEL: "WARN",
    });

    expect(SEEDED_SETTINGS).toEqual({
      "instance-limits.maxUploadMb": 40,
      "instance-integrations.logLevel": "warn",
    });
  });

  it("seeds each env-backed value from its variable", async () => {
    const { DEFAULT_INSTANCE_POLICY: seeded } = await loadPolicy({
      MAX_UPLOAD_MB: "40",
      MAX_PROJECT_GB: "1.5",
      MAX_USER_GB: "0",
      MEDIA_CONCURRENCY: "4",
      SAVE_CONTENT_RETENTION_DAYS: "30",
      LOG_LEVEL: "WARN",
    });

    expect(seeded.jobs.saveContentRetentionDays).toBe(30);
    expect(seeded.limits.maxUploadMb).toBe(40);
    expect(seeded.limits.projectCapGb).toBe(1.5);
    // Zero is a cap of zero, not "unset".
    expect(seeded.limits.userCapGb).toBe(0);
    expect(seeded.jobs.analysisWorkers).toBe(4);
    expect(seeded.integrations.logLevel).toBe("warn");
  });

  it("treats a blank variable as unset", async () => {
    const { DEFAULT_INSTANCE_POLICY: seeded } = await loadPolicy({
      MAX_UPLOAD_MB: "",
      MAX_PROJECT_GB: " ",
    });

    expect(seeded.limits.maxUploadMb).toBe(128);
    expect(seeded.limits.projectCapGb).toBeNull();
  });

  it.each([
    ["MAX_UPLOAD_MB", "forty"],
    ["MAX_UPLOAD_MB", "0"],
    ["MAX_UPLOAD_MB", String(MAX_UPLOAD_CEILING_MB + 1)],
    ["MAX_PROJECT_GB", "-1"],
    ["MAX_USER_GB", "lots"],
    ["MEDIA_CONCURRENCY", "0"],
    ["SAVE_CONTENT_RETENTION_DAYS", "0"],
    ["MEDIA_CONCURRENCY", "1.5"],
    ["LOG_LEVEL", "verbose"],
  ])("refuses to load with %s=%s, naming the variable", async (name, value) => {
    await expect(loadPolicy({ [name]: value })).rejects.toThrow(
      new RegExp(name)
    );
  });
});

describe("MAX_REQUEST_BODY_BYTES", () => {
  it("sits above the upload ceiling by at most a mebibyte", () => {
    expect(MAX_REQUEST_BODY_BYTES).toBeGreaterThan(MAX_UPLOAD_CEILING_MB * MIB);
    expect(MAX_REQUEST_BODY_BYTES).toBeLessThanOrEqual(
      MAX_UPLOAD_CEILING_MB * MIB + MIB
    );
  });

  it("leaves room for the whole upload form around a file at the ceiling", async () => {
    // The fields an upload sends with every render, at their longest, around
    // a small file: what the form adds beyond the file is the same at any size.
    const fileBytes = 1024;
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(fileBytes)], { type: "audio/wav" }),
      `${"r".repeat(250)}.wav`
    );
    form.append("projectId", String(Number.MAX_SAFE_INTEGER));
    form.append("localFileCreatedAt", String(Date.now()));
    form.append("localFileUpdatedAt", String(Date.now()));
    form.append("localFilepath", `/${"folder/".repeat(512)}render.wav`);
    form.append("localFileMachineName", "m".repeat(255));
    form.append("fingerprint", "f".repeat(128));

    const body = await new Request("http://localhost/", {
      method: "POST",
      body: form,
    }).arrayBuffer();
    const envelope = body.byteLength - fileBytes;

    expect(MAX_UPLOAD_CEILING_MB * MIB + envelope).toBeLessThanOrEqual(
      MAX_REQUEST_BODY_BYTES
    );
  });
});

describe("refreshInstancePolicy", () => {
  afterEach(() => {
    restoreInstancePolicy();
  });

  it("starts from the default snapshot", () => {
    expect(instancePolicy()).toEqual(DEFAULT_INSTANCE_POLICY);
  });

  it("replaces the snapshot every reader sees on its next read", () => {
    stubInstancePolicy({ limits: { maxUploadMb: 3 } });

    expect(instancePolicy().limits.maxUploadMb).toBe(3);
    expect(uploadLimitBytes()).toBe(3 * MIB);
    // Everything the source did not change is still the default.
    expect(instancePolicy().access).toEqual(DEFAULT_INSTANCE_POLICY.access);
  });

  it("tells each listener the new snapshot and the one it replaced, until it unsubscribes", () => {
    const seen: [number, number][] = [];
    const unsubscribe = onInstancePolicyChange((next, previous) =>
      seen.push([next.jobs.analysisWorkers, previous.jobs.analysisWorkers])
    );

    stubInstancePolicy({ jobs: { analysisWorkers: 5 } });
    unsubscribe();
    stubInstancePolicy({ jobs: { analysisWorkers: 6 } });

    expect(seen).toEqual([[5, DEFAULT_INSTANCE_POLICY.jobs.analysisWorkers]]);
  });

  it("freezes the snapshot so no reader can change it for the others", () => {
    const policy = stubInstancePolicy({ limits: { maxUploadMb: 3 } });

    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.limits)).toBe(true);
    expect(Object.isFrozen(policy.limits.audioTypes)).toBe(true);
  });

  it.each([
    [
      "an upload limit over the ceiling",
      { limits: { maxUploadMb: MAX_UPLOAD_CEILING_MB + 1 } },
    ],
    [
      "a bucket below its floor",
      { rateLimits: { "auth-signin": { burst: 1, perMinute: 20 } } },
    ],
    [
      "a minimum password longer than the maximum",
      { access: { passwordMin: 20, passwordMax: 12 } },
    ],
    ["a password minimum under the floor", { access: { passwordMin: 4 } }],
    [
      "a lockout base above its maximum",
      { access: { lockoutBaseMinutes: 90 } },
    ],
    ["zero analysis workers", { jobs: { analysisWorkers: 0 } }],
  ] as const)("refuses %s and keeps the snapshot it had", (_, patch) => {
    const before = instancePolicy();

    expect(() => stubInstancePolicy(patch)).toThrow();
    expect(instancePolicy()).toBe(before);
  });

  it("refuses an audio type the server cannot decode", () => {
    expect(() =>
      refreshInstancePolicy({
        ...DEFAULT_INSTANCE_POLICY,
        limits: {
          ...DEFAULT_INSTANCE_POLICY.limits,
          audioTypes: [".exe" as ".wav"],
        },
      })
    ).toThrow();
  });
});

describe("the policy's settings", () => {
  /** Every setting a policy value reads, in the policy's order. */
  const policyKeys: string[] = [];
  policySource((definition) => policyKeys.push(definition.key));

  const definitions: SettingDefinition[] = Object.values(SETTINGS);

  it("reads each value from its own instance setting, no setting twice", () => {
    expect(new Set(policyKeys).size).toBe(policyKeys.length);
    for (const key of policyKeys) {
      expect(SETTINGS[key as keyof typeof SETTINGS].scopes).toEqual([
        "instance",
      ]);
    }
  });

  it("leaves out only registration and the branding the server does not act on", () => {
    const outside = definitions
      .filter(
        ({ key, scopes }) =>
          scopes.length === 1 &&
          scopes[0] === "instance" &&
          !policyKeys.includes(key)
      )
      .map(({ key }) => key)
      .sort();

    expect(outside).toEqual([
      "instance-access.registration",
      "instance-branding.backgroundColour",
      "instance-branding.iconImageId",
      "instance-branding.logoImageId",
      "instance-branding.mailSenderName",
      "instance-branding.name",
      "instance-branding.themeColour",
    ]);
  });

  it("gives every restart-required setting a value the running policy holds", () => {
    const restartRequired = definitions.filter(
      ({ restartRequired }) => restartRequired
    );

    expect(restartRequired.length).toBeGreaterThan(0);
    for (const { key, default: fallback } of restartRequired) {
      expect(settingValueIn(DEFAULT_INSTANCE_POLICY, key)).toEqual(fallback);
    }
    expect(
      settingValueIn(DEFAULT_INSTANCE_POLICY, "instance-branding.name")
    ).toBeUndefined();
  });

  it("names both settings of a pair out of order, and nothing for a policy it takes", () => {
    const source = (access: Partial<typeof DEFAULT_INSTANCE_POLICY.access>) =>
      policySource((definition) => {
        const field = definition.key.replace("instance-access.", "");
        return Object.hasOwn(access, field)
          ? access[field as keyof typeof access]
          : definition.default;
      });

    expect(settingsRefusedBy(source({}))).toEqual([]);
    expect(
      settingsRefusedBy(source({ passwordMin: 20, passwordMax: 12 }))
    ).toEqual([
      {
        key: "instance-access.passwordMin",
        message: "Shortest password must not be more than the longest password",
      },
      {
        key: "instance-access.passwordMax",
        message: "Shortest password must not be more than the longest password",
      },
    ]);
    expect(
      settingsRefusedBy(source({ lockoutBaseMinutes: 90 })).map(
        ({ key }) => key
      )
    ).toEqual([
      "instance-access.lockoutBaseMinutes",
      "instance-access.lockoutMaxMinutes",
    ]);
  });
});

describe(".env.example", () => {
  it("says of each seed variable it documents, and of no other, that it seeds a setting", async () => {
    const text = await Bun.file(
      new URL("../../../../.env.example", import.meta.url)
    ).text();
    const seeds = new Set(SEED_VARIABLES.map(({ variable }) => variable));
    const documented: string[] = [];

    for (const paragraph of text.split(/\n\s*\n/)) {
      const names = [...paragraph.matchAll(/^#? ?([A-Z][A-Z0-9_]*)=/gm)].map(
        ([, name]) => name!
      );
      if (names.length === 0) continue;
      const prose = paragraph.replace(/\n# ?/g, " ");
      expect({
        names,
        seeds: /\bseeds? Settings → Instance\b/.test(prose),
      }).toEqual({ names, seeds: names.some((name) => seeds.has(name)) });
      documented.push(...names.filter((name) => seeds.has(name)));
    }

    expect(documented.length).toBeGreaterThan(0);
  });
});
