import { describe, expect, expectTypeOf, it } from "bun:test";
import { MAX_UPLOAD_CEILING_MB } from "../bounds.js";
import { GROUPS, SETTINGS, type SettingsValues } from "../registry.js";
import type { SettingDefinition } from "../types.js";
import { MCP_AUTH_SCOPES, MCP_SCOPES } from "./instance-integrations.js";
import { AUDIO_EXTENSIONS, IMAGE_TYPES } from "./instance-limits.js";
import { RATE_BUCKET_NAMES, RATE_BUCKETS } from "./instance-rate-limits.js";

const instanceSettings: [string, SettingDefinition][] = Object.entries(
  SETTINGS
).filter(([key]) => key.startsWith("instance-"));

const keysWhere = (test: (definition: SettingDefinition) => boolean) =>
  instanceSettings
    .filter(([, definition]) => test(definition))
    .map(([key]) => key)
    .sort();

describe("the Instance groups", () => {
  it("are the instance section's, and only the rate limits are advanced", () => {
    const instance = GROUPS.filter(({ section }) => section === "instance");

    expect(instance.map(({ id }) => id)).toEqual([
      "instance-access",
      "instance-branding",
      "instance-limits",
      "instance-jobs",
      "instance-integrations",
      "instance-rate-limits",
    ]);
    expect(
      instance.filter(({ advanced }) => advanced).map(({ id }) => id)
    ).toEqual(["instance-rate-limits"]);
  });

  it.each(instanceSettings)(
    "%s takes a value at the instance only, where no lock can pin it",
    (_, definition) => {
      expect(definition.scopes).toEqual(["instance"]);
      expect(definition.lockable).toBe(false);
    }
  );

  it("give signed-out pages exactly the public keys", () => {
    expect(keysWhere(({ audience }) => audience === "public")).toEqual(
      [
        "instance-access.registration",
        "instance-access.guestAccess",
        "instance-access.passwordMax",
        "instance-access.passwordMin",
        "instance-access.selfDeletion",
        "instance-branding.backgroundColour",
        "instance-branding.iconImageId",
        "instance-branding.logoImageId",
        "instance-branding.name",
        "instance-branding.themeColour",
        "instance-branding.updateCheck",
      ].sort()
    );
    expect(keysWhere(({ audience }) => audience === "all")).toEqual([]);
  });

  it("wait on a restart for the session lifetime and the MCP settings read at boot", () => {
    expect(
      keysWhere(({ restartRequired }) => restartRequired === true)
    ).toEqual([
      "instance-access.sessionLifetimeDays",
      "instance-integrations.mcpAccessTokenHours",
      "instance-integrations.mcpEnabled",
      "instance-integrations.mcpRefreshTokenDays",
    ]);
  });

  it("separate MCP resource scopes from authorization-server scopes and bound token lifetimes", () => {
    expect(MCP_SCOPES).toEqual(["read", "write"]);
    expect(MCP_AUTH_SCOPES).toEqual(["read", "write", "offline_access"]);

    const access = SETTINGS["instance-integrations.mcpAccessTokenHours"];
    expect(access.default).toBe(24);
    expect(access.control).toEqual({
      kind: "duration",
      unit: "h",
      min: 1,
      max: 720,
    });
    expect(access.schema.safeParse(0).success).toBe(false);
    expect(access.schema.safeParse(1).success).toBe(true);
    expect(access.schema.safeParse(720).success).toBe(true);
    expect(access.schema.safeParse(721).success).toBe(false);

    const refresh = SETTINGS["instance-integrations.mcpRefreshTokenDays"];
    expect(refresh.default).toBe(90);
    expect(refresh.control).toEqual({
      kind: "duration",
      unit: "d",
      min: 1,
      max: 365,
    });
    expect(refresh.schema.safeParse(0).success).toBe(false);
    expect(refresh.schema.safeParse(1).success).toBe(true);
    expect(refresh.schema.safeParse(365).success).toBe(true);
    expect(refresh.schema.safeParse(366).success).toBe(false);
  });

  it("take the upload ceiling as the largest upload's maximum", () => {
    const { schema } = SETTINGS["instance-limits.maxUploadMb"];

    expect(schema.safeParse(MAX_UPLOAD_CEILING_MB).success).toBe(true);
    expect(schema.safeParse(MAX_UPLOAD_CEILING_MB + 1).success).toBe(false);
    expect(schema.safeParse(0).success).toBe(false);
  });

  it("clear a cap, a retention or an image to null, which is also its default", () => {
    for (const key of [
      "instance-limits.projectCapGb",
      "instance-limits.userCapGb",
      "instance-jobs.activityRetentionDays",
      "instance-branding.logoImageId",
      "instance-branding.iconImageId",
    ] as const) {
      expect(SETTINGS[key].default).toBeNull();
      expect(SETTINGS[key].schema.safeParse(null).success).toBe(true);
    }
    expect(SETTINGS["instance-limits.projectCapGb"].schema.parse(0)).toBe(0);
  });

  it("keep uncommitted save content for 90 days by default and never forever", () => {
    const setting = SETTINGS["instance-jobs.saveContentRetentionDays"];

    expect(setting.default).toBe(90);
    expect(setting.schema.safeParse(null).success).toBe(false);
    expect(setting.schema.safeParse(0).success).toBe(false);
    expect(setting.schema.safeParse(36500).success).toBe(true);
    expect(setting.schema.safeParse(36501).success).toBe(false);
  });

  it("push samples from every repository is a toggle, off by default", () => {
    const setting = SETTINGS["instance-limits.pushSamplesEverywhere"];

    expect(setting.default).toBe(false);
    expect(setting.control.kind).toBe("toggle");
    expect(setting.schema.safeParse(true).success).toBe(true);
    expect(setting.schema.safeParse("yes").success).toBe(false);
  });

  it("refuse a colour that is not six-digit hex", () => {
    const { schema } = SETTINGS["instance-branding.themeColour"];

    expect(schema.safeParse("#1A2b3c").success).toBe(true);
    expect(schema.safeParse("#fff").success).toBe(false);
    expect(schema.safeParse("red").success).toBe(false);
  });
});

describe("the upload types", () => {
  it("are chosen from exactly the formats the server can read", () => {
    expect(SETTINGS["instance-limits.audioTypes"].control).toEqual({
      kind: "multiselect",
      options: AUDIO_EXTENSIONS.map((value) => ({ value, label: value })),
    });
    expect(SETTINGS["instance-limits.imageTypes"].control).toEqual({
      kind: "multiselect",
      options: IMAGE_TYPES.map((value) => ({ value, label: value })),
    });
  });
});

describe("the rate limits", () => {
  it("declare a burst and a per-minute key for every bucket", () => {
    expect(keysWhere(({ group }) => group === "instance-rate-limits")).toEqual(
      RATE_BUCKET_NAMES.flatMap((name) => [
        `instance-rate-limits.${name}.burst`,
        `instance-rate-limits.${name}.perMinute`,
      ]).sort()
    );
  });

  it("type each key's value as a number", () => {
    expectTypeOf<
      SettingsValues["instance-rate-limits.auth-signin.burst"]
    >().toEqualTypeOf<number>();
    // @ts-expect-error a bucket the table does not have has no key
    expectTypeOf<SettingsValues["instance-rate-limits.nope.burst"]>();
  });

  it.each(RATE_BUCKET_NAMES)(
    "%s takes its floor and refuses one below it, naming the floor",
    (name) => {
      const { floor, burst, perMinute } = RATE_BUCKETS[name];
      const allowances = [
        ["burst", floor.burst, burst],
        ["perMinute", floor.perMinute, perMinute],
      ] as const;

      for (const [field, least, fallback] of allowances) {
        const setting = SETTINGS[`instance-rate-limits.${name}.${field}`];
        expect(setting.default).toBe(fallback);
        expect(setting.schema.safeParse(least).success).toBe(true);

        const below = setting.schema.safeParse(least - 1);
        expect(below.success).toBe(false);
        expect(below.error?.issues[0]?.message).toContain(String(least));
      }
    }
  );
});
