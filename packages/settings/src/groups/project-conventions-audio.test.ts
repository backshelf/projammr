import { describe, expect, it } from "bun:test";
import { GROUPS, SETTINGS } from "../registry.js";
import type { SettingDefinition } from "../types.js";

/** `SETTINGS`, indexable by a key built at runtime rather than a literal. */
const settingsByKey = SETTINGS as Record<string, SettingDefinition>;

/** The `ProjectPolicy` defaults these groups pin, mirroring `DEFAULT_PROJECT_POLICY`. */
const DEFAULT_PROJECT_POLICY = {
  conventions: {
    quietAfterDays: 30,
    todayNewHours: 24,
  },
  audio: {
    auditTooShortSeconds: 15,
    auditNearSilentLufs: -40,
    auditHotPeakDbtp: -1,
    auditLeadSilenceSeconds: 2,
    auditTailSilenceSeconds: 3,
    auditNameMismatch: 0.3,
    tempoKeyCorrection: true,
    tempoKeyCorrectionPercent: 4,
    sameBounceWindowMinutes: 2,
    duplicateKeep: "largest",
    mp3Kbps: "320",
    autoAnalyse: true,
    storageCapGb: null,
  },
} as const;

const projectAudioSettings: [string, SettingDefinition][] = Object.entries(
  SETTINGS
).filter(([key]) => key.startsWith("project-audio."));

const projectConventionsSettings: [string, SettingDefinition][] =
  Object.entries(SETTINGS).filter(([key]) =>
    key.startsWith("project-conventions.")
  );

describe("the Project conventions and audio groups", () => {
  it("are declared in the project section, ordered after project-defaults and project-sharing", () => {
    const project = GROUPS.filter(({ section }) => section === "project");

    expect(project.map(({ id }) => id)).toContain("project-conventions");
    expect(project.map(({ id }) => id)).toContain("project-audio");

    const conventions = project.find(({ id }) => id === "project-conventions");
    const audio = project.find(({ id }) => id === "project-audio");
    expect(conventions?.order).toBe(90);
    expect(audio?.order).toBe(100);
  });

  it.each([...projectConventionsSettings, ...projectAudioSettings])(
    "%s takes a value at project scope over instance, admin-writable and open to every member",
    (_, definition) => {
      expect(definition.scopes).toEqual(["project", "instance"]);
      expect(definition.audience).toBe("all");
    }
  );

  it("gates the storage cap to the owner alone; every other key is admin-writable", () => {
    expect(SETTINGS["project-audio.storageCapGb"]!.minRole).toBe("owner");

    const others = [...projectConventionsSettings, ...projectAudioSettings]
      .map(([key]) => key)
      .filter((key) => key !== "project-audio.storageCapGb");
    for (const key of others) {
      expect(settingsByKey[key]!.minRole).toBe("admin");
    }
  });

  it("has no conventions field beyond quietAfterDays and todayNewHours", () => {
    expect(projectConventionsSettings.map(([key]) => key).sort()).toEqual([
      "project-conventions.quietAfterDays",
      "project-conventions.todayNewHours",
    ]);
  });

  it("takes 0 as a quiet-after value, which counts nothing quiet", () => {
    const { schema } = SETTINGS["project-conventions.quietAfterDays"]!;
    expect(schema.safeParse(0).success).toBe(true);
  });

  it("pins every default to DEFAULT_PROJECT_POLICY's value", () => {
    for (const [key, value] of Object.entries(
      DEFAULT_PROJECT_POLICY.conventions
    )) {
      expect(settingsByKey[`project-conventions.${key}`]!.default).toEqual(
        value
      );
    }
    for (const [key, value] of Object.entries(DEFAULT_PROJECT_POLICY.audio)) {
      expect(settingsByKey[`project-audio.${key}`]!.default).toEqual(value);
    }
  });

  it("clears the storage cap to null, which is also its default", () => {
    const { schema, default: def } = SETTINGS["project-audio.storageCapGb"]!;
    expect(def).toBeNull();
    expect(schema.safeParse(null).success).toBe(true);
  });

  it("takes the MP3 bitrate as a string, not a number", () => {
    const { schema, default: def } = SETTINGS["project-audio.mp3Kbps"]!;
    expect(typeof def).toBe("string");
    expect(schema.safeParse(320).success).toBe(false);
    expect(schema.safeParse("320").success).toBe(true);
  });
});

describe("the project accent", () => {
  it("takes a value at project scope, over instance, under the user's own", () => {
    expect(SETTINGS["appearance.accentFallback"]!.scopes).toEqual([
      "user",
      "project",
      "instance",
    ]);
  });
});
