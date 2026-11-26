import { describe, expect, it } from "bun:test";
import {
  DEFAULT_PROJECT_POLICY,
  projectPolicy,
  withProjectPolicyForTest,
} from "./project-policy.js";

/**
 * Each default is the value the server behaved by before the policy existed:
 * a column default, a constant, or what a form offered. Moving one changes
 * every project that sets nothing, so a change here has to be deliberate.
 */
describe("DEFAULT_PROJECT_POLICY", () => {
  it("gives a new track and collection the status the columns default to, no labels and no artists", () => {
    expect(DEFAULT_PROJECT_POLICY.defaults).toEqual({
      trackStatusId: 1,
      collectionStatusId: 1,
      labelIds: [],
      artists: [],
      explicit: false,
      newSessionMain: false,
    });
  });

  it("opens a connected share link that never expires, with public comments, no downloads and guest comments on", () => {
    const { sharing } = DEFAULT_PROJECT_POLICY;
    expect(sharing.shareKind).toBe("connected");
    expect(sharing.shareExpiresDays).toBeNull();
    expect(sharing.shareCommentPrivacy).toBe("public");
    expect(sharing.shareDownloads).toBe(false);
    expect(sharing.guestComments).toBe(true);
  });

  it("invites as a viewer for seven days, and only admins and the owner may invite", () => {
    const { sharing } = DEFAULT_PROJECT_POLICY;
    expect(sharing.inviteRole).toBe("viewer");
    expect(sharing.inviteDays).toBe(7);
    expect(sharing.whoMayInvite).toBe("admin");
  });

  it("counts a track quiet after thirty days and a render or save new for a day", () => {
    expect(DEFAULT_PROJECT_POLICY.conventions).toEqual({
      quietAfterDays: 30,
      todayNewHours: 24,
    });
  });

  it("audits against 15 s, -40 LUFS, -1 dBTP, 2 s and 3 s of silence and a 0.3 name similarity", () => {
    const { audio } = DEFAULT_PROJECT_POLICY;
    expect(audio.auditTooShortSeconds).toBe(15);
    expect(audio.auditNearSilentLufs).toBe(-40);
    expect(audio.auditHotPeakDbtp).toBe(-1);
    expect(audio.auditLeadSilenceSeconds).toBe(2);
    expect(audio.auditTailSilenceSeconds).toBe(3);
    expect(audio.auditNameMismatch).toBe(0.3);
  });

  it("corrects tempo and key within 4 %, groups bounces two minutes apart and keeps the largest", () => {
    const { audio } = DEFAULT_PROJECT_POLICY;
    expect(audio.tempoKeyCorrection).toBe(true);
    expect(audio.tempoKeyCorrectionPercent).toBe(4);
    expect(audio.sameBounceWindowMinutes).toBe(2);
    expect(audio.duplicateKeep).toBe("largest");
  });

  it("converts to MP3 at 320 kbps, analyses on link and sets no storage cap of its own", () => {
    const { audio } = DEFAULT_PROJECT_POLICY;
    expect(audio.mp3Kbps).toBe(320);
    expect(audio.autoAnalyse).toBe(true);
    expect(audio.storageCapGb).toBeNull();
  });
});

describe("projectPolicy", () => {
  it("reads the defaults for a project that sets nothing", async () => {
    expect(await projectPolicy(1)).toEqual(DEFAULT_PROJECT_POLICY);
  });

  it("hands each caller its own copy, so one caller's change never reaches the next", async () => {
    const first = await projectPolicy(1);
    first.defaults.labelIds.push(99);
    first.audio.mp3Kbps = 64;

    expect(await projectPolicy(1)).toEqual(DEFAULT_PROJECT_POLICY);
    expect(DEFAULT_PROJECT_POLICY.defaults.labelIds).toEqual([]);
  });
});

describe("withProjectPolicyForTest", () => {
  it("lays the patch over the named project only, field by field, while the callback runs", async () => {
    const seen = await withProjectPolicyForTest(
      7,
      { audio: { autoAnalyse: false }, sharing: { inviteDays: 2 } },
      async () => ({
        patched: await projectPolicy(7),
        other: await projectPolicy(8),
      })
    );

    expect(seen.patched.audio).toEqual({
      ...DEFAULT_PROJECT_POLICY.audio,
      autoAnalyse: false,
    });
    expect(seen.patched.sharing.inviteDays).toBe(2);
    expect(seen.patched.sharing.inviteRole).toBe("viewer");
    expect(seen.other).toEqual(DEFAULT_PROJECT_POLICY);
    expect(await projectPolicy(7)).toEqual(DEFAULT_PROJECT_POLICY);
  });

  it("lifts the patch when the callback throws", async () => {
    await expect(
      withProjectPolicyForTest(7, { conventions: { quietAfterDays: 0 } }, () =>
        Promise.reject(new Error("boom"))
      )
    ).rejects.toThrow("boom");

    expect(await projectPolicy(7)).toEqual(DEFAULT_PROJECT_POLICY);
  });

  it("restores an outer patch when an inner one ends", async () => {
    await withProjectPolicyForTest(
      7,
      { defaults: { explicit: true } },
      async () => {
        await withProjectPolicyForTest(
          7,
          { defaults: { artists: ["B"] } },
          async () => {
            expect((await projectPolicy(7)).defaults.artists).toEqual(["B"]);
          }
        );
        expect((await projectPolicy(7)).defaults.explicit).toBe(true);
      }
    );
  });
});
